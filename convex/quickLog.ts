import { z } from "zod";
import { ConvexError, v } from "convex/values";
import {
  action,
  mutation,
  internalQuery,
  internalMutation,
} from "./_generated/server";
import { internal } from "./_generated/api";
import { loadSavedMeals, logSavedMeal } from "./savedMeals";
import { requireUser } from "./model";
import { validHistoryClock } from "./historyData";
import { localClock, normalizeTimeZone } from "../lib/coach-time";
import {
  quickLogProposalSchema,
  normalizedLogName,
  quickLogResultSchema,
  type QuickLogResult,
} from "../lib/quick-log";
import { quickLogProvider } from "./quickLogProviders";
import { QuickLogError } from "./quickLogProviders/types";

export const readMuscles = internalQuery({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const muscles = await ctx.db
      .query("muscles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return muscles.map((m) => ({ id: m._id, name: m.name }));
  },
});
export const readSavedMeals = internalQuery({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    return (await loadSavedMeals(ctx, userId)).map((row) => ({
      id: row._id,
      name: row.name,
    }));
  },
});

export const applySavedMeal = mutation({
  args: {
    savedMealId: v.id("savedMeals"),
    at: v.number(),
    servings: v.number(),
  },
  handler: async (ctx, args) =>
    logSavedMeal(ctx, await requireUser(ctx), {
      id: args.savedMealId,
      at: args.at,
      servings: args.servings,
    }),
});

export const reserveParse = internalMutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    const now = Date.now();
    const limit = await ctx.db
      .query("quickLogLimits")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const sentAt = (limit?.sentAt ?? []).filter((at) => at > now - 3_600_000);
    if (sentAt.length >= 60)
      throw new ConvexError(
        "You can parse 60 quick logs per hour. Please try again later.",
      );
    sentAt.push(now);
    if (limit) await ctx.db.patch(limit._id, { sentAt });
    else await ctx.db.insert("quickLogLimits", { userId, sentAt });
    return now;
  },
});
const envelopeSchema = z.object({
  proposals: z.array(z.unknown()).max(100),
  leftover: z.array(z.string().max(500)).max(100),
});
const entrySchema = z.looseObject({ kind: z.string() });
const namesSchema = z.array(z.string().min(1).max(200)).max(100);

export const parse = action({
  args: { text: v.string(), timeZone: v.string() },
  handler: async (ctx, args): Promise<QuickLogResult> => {
    await requireUser(ctx);
    const text = args.text.trim();
    if (!text) throw new ConvexError("Enter a sentence to log.");
    if (text.length > 500)
      throw new ConvexError("Keep your quick log to 500 characters.");
    validHistoryClock(Date.now(), args.timeZone);
    const timeZone = normalizeTimeZone(args.timeZone);
    const now = await ctx.runMutation(internal.quickLog.reserveParse, {});
    const [muscles, savedMeals] = await Promise.all([
      ctx.runQuery(internal.quickLog.readMuscles, {}),
      ctx.runQuery(internal.quickLog.readSavedMeals, {}),
    ]);
    const clock = localClock(now, timeZone);
    try {
      const result = envelopeSchema.parse(
        await quickLogProvider().parse({
          text,
          now,
          timeZone,
          localClock: `${clock.localDay} ${clock.slot}`,
          muscles: muscles.map((m) => m.name),
          savedMeals: savedMeals.map((m) => m.name),
        }),
      );
      const proposals: QuickLogResult["proposals"] = [];
      const leftover = [...result.leftover];
      const rejected = () => {
        if (!leftover.includes(text)) leftover.push(text);
      };
      for (const raw of result.proposals) {
        const entry = entrySchema.safeParse(raw);
        if (!entry.success) {
          rejected();
          continue;
        }
        const value = { ...entry.data };
        if (value.kind === "workout") {
          const names = namesSchema.safeParse(value.muscles);
          if (!names.success || !names.data.length) {
            rejected();
            continue;
          }
          const found = muscles.filter((m) =>
            names.data.some(
              (name) => name.trim().toLowerCase() === m.name.toLowerCase(),
            ),
          );
          for (const name of names.data) {
            if (
              !muscles.some(
                (m) => m.name.toLowerCase() === name.trim().toLowerCase(),
              )
            )
              leftover.push(`Unknown muscle: ${name}`);
          }
          value.muscleIds = found.map((m) => m.id);
          value.muscles = found.map((m) => m.name);
          if (!found.length) continue;
        }
        if (value.kind === "savedMeal") {
          const name = z.string().trim().min(1).max(80).safeParse(value.name);
          if (!name.success) {
            rejected();
            continue;
          }
          const meal = savedMeals.find(
            (m) => normalizedLogName(m.name) === normalizedLogName(name.data),
          );
          if (!meal) {
            leftover.push(`Unknown saved meal: ${name.data}`);
            continue;
          }
          value.savedMealId = meal.id;
          value.name = meal.name;
        }
        if (value.kind === "checkin") {
          for (const key of ["weightKg", "sleepHours", "mood", "energy"])
            if (value[key] === null) delete value[key];
          value.day = clock.localDay;
        }
        // Validate before repairing timestamps; invalid numbers must not become valid logs.
        const checked = quickLogProposalSchema.safeParse(value);
        if (!checked.success) {
          rejected();
          continue;
        }
        const proposal = checked.data;
        if (proposal.kind !== "checkin") {
          proposal.at = Math.min(proposal.at, now);
          if (localClock(proposal.at, timeZone).localDay !== clock.localDay)
            proposal.at = now;
        }
        proposals.push(proposal);
      }
      return quickLogResultSchema.parse({
        proposals,
        leftover: [...new Set(leftover)].slice(0, 100),
      });
    } catch (error) {
      throw new ConvexError(
        error instanceof QuickLogError
          ? error.message
          : "Could not parse your quick log. Please try again.",
      );
    }
  },
});
