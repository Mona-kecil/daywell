import { ConvexError, v } from "convex/values";
import { z } from "zod";
import { internalMutation, mutation, query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { createWater, requireUser } from "./model";
import { upsertCheckin } from "./checkinModel";
import { todayDataFor } from "./coachData";
import { localClock, normalizeTimeZone } from "../lib/coach-time";
import { recovery } from "../lib/recovery";

export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export const createToken = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    const secret = btoa(String.fromCharCode(...bytes))
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replaceAll("=", "");
    const token = `dw_${secret}`;
    const hash = await hashToken(token);
    const existing = await ctx.db
      .query("shortcutTokens")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (existing) await ctx.db.delete(existing._id);
    await ctx.db.insert("shortcutTokens", {
      userId,
      hash,
      prefix: secret.slice(0, 7),
      createdAt: Date.now(),
    });
    return token;
  },
});

export const revokeToken = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const token = await ctx.db
      .query("shortcutTokens")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    if (token) await ctx.db.delete(token._id);
  },
});

export const tokenStatus = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const token = await ctx.db
      .query("shortcutTokens")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    return token
      ? {
          prefix: token.prefix,
          createdAt: token.createdAt,
          lastUsedAt: token.lastUsedAt,
        }
      : null;
  },
});

const waterInput = z.strictObject({
  amountMl: z.number(),
  at: z.number().optional(),
});
const checkinInput = z.strictObject({
  day: z.string().optional(),
  timeZone: z.string().optional(),
  weightKg: z.number().nullable().optional(),
  sleepHours: z.number().nullable().optional(),
  mood: z.number().nullable().optional(),
  energy: z.number().nullable().optional(),
  note: z.string().nullable().optional(),
});

function validTimeZone(value: string | undefined) {
  if (value === undefined) throw new ConvexError("Provide an IANA timeZone.");
  try {
    return normalizeTimeZone(value);
  } catch {
    throw new ConvexError("Choose a valid IANA time zone.");
  }
}

type ShortcutResponse = {
  status: number;
  body:
    | { error: string }
    | { ok: true; id: Id<"water"> | Id<"bodyCheckins"> }
    | {
        day: string;
        waterMl: number;
        waterGoalMl: number;
        kcal: number;
        proteinG: number;
        mealsLogged: number;
        readyMuscles: string[];
      };
};

// Authentication, quota consumption, and the operation share a transaction.
export const request = internalMutation({
  args: {
    hash: v.string(),
    kind: v.union(v.literal("water"), v.literal("checkin"), v.literal("today")),
    body: v.string(),
    timeZone: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<ShortcutResponse> => {
    const token = await ctx.db
      .query("shortcutTokens")
      .withIndex("by_hash", (q) => q.eq("hash", args.hash))
      .unique();
    if (!token)
      return { status: 401, body: { error: "Invalid or missing token." } };
    const now = Date.now();
    const userId = token.userId;
    const limit = await ctx.db
      .query("shortcutLimits")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const requestedAt = (limit?.requestedAt ?? []).filter(
      (at) => at > now - 3_600_000,
    );
    if (requestedAt.length >= 60)
      return {
        status: 429,
        body: { error: "You can make 60 requests per hour. Try again later." },
      };
    requestedAt.push(now);
    if (limit) await ctx.db.patch(limit._id, { requestedAt });
    else await ctx.db.insert("shortcutLimits", { userId, requestedAt });
    if (token.lastUsedAt === undefined || now - token.lastUsedAt >= 60_000)
      await ctx.db.patch(token._id, { lastUsedAt: now });

    try {
      switch (args.kind) {
        case "water": {
          const input = waterInput.parse(JSON.parse(args.body));
          const id = await createWater(ctx, userId, {
            amountMl: input.amountMl,
            at: input.at ?? now,
          });
          return { status: 200, body: { ok: true, id } };
        }
        case "checkin": {
          const { day, timeZone, ...fields } = checkinInput.parse(
            JSON.parse(args.body),
          );
          if (day === undefined && timeZone === undefined)
            throw new ConvexError("Provide a day or an IANA timeZone.");
          const zone =
            timeZone === undefined ? undefined : validTimeZone(timeZone);
          const id = await upsertCheckin(ctx, userId, {
            ...fields,
            day: day ?? localClock(now, zone ?? "UTC").localDay,
          });
          return { status: 200, body: { ok: true, id } };
        }
        case "today": {
          const timeZone = validTimeZone(args.timeZone);
          const [today, settings] = await Promise.all([
            todayDataFor(ctx, userId, now, timeZone),
            ctx.db
              .query("settings")
              .withIndex("by_user", (q) => q.eq("userId", userId))
              .unique(),
          ]);
          return {
            status: 200,
            body: {
              day: today.day,
              waterMl: today.waterMl,
              waterGoalMl: settings?.waterGoal ?? 2500,
              // Whole numbers read well when Siri speaks the result.
              kcal: Math.round(today.macros.kcal),
              proteinG: Math.round(today.macros.protein),
              mealsLogged: today.mealCount,
              readyMuscles: today.muscles
                .filter(
                  (m) =>
                    recovery(now, m.lastTrainedAt, m.cooldownHours).kind !==
                    "recovering",
                )
                .map((m) => m.name),
            },
          };
        }
      }
    } catch (error) {
      if (error instanceof SyntaxError)
        return { status: 400, body: { error: "Invalid JSON body." } };
      if (error instanceof z.ZodError)
        return { status: 400, body: { error: error.issues[0].message } };
      if (error instanceof ConvexError && typeof error.data === "string")
        return { status: 400, body: { error: error.data } };
      throw error;
    }
  },
});
