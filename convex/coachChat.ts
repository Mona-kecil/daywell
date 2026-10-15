import { ConvexError, v } from "convex/values";
import {
  query,
  mutation,
  internalQuery,
  internalMutation,
  internalAction,
  type MutationCtx,
} from "./_generated/server";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireUser } from "./model";
import { validHistoryClock } from "./historyData";
import { readinessForCoach, suggestionsFor } from "./coachData";
import { localClock, normalizeTimeZone } from "../lib/coach-time";
import { shiftDay } from "../lib/history";
import {
  buildCoachSnapshot,
  COACH_HISTORY_WINDOW_MS,
  COACH_PENDING_MS as PENDING_MS,
  COACH_STALE_ERROR as STALE_ERROR,
} from "../lib/coach-chat";
import { loadSavedMeals } from "./savedMeals";
import { stepDays } from "./stepsModel";
import { DEFAULT_STEP_GOAL } from "../lib/steps";
import { coachChatProvider } from "./coachChatProviders";
import {
  CoachChatError,
  type CoachChatInput,
} from "./coachChatProviders/types";

export type CoachMessage = Pick<
  Doc<"coachMessages">,
  "_id" | "role" | "text" | "at" | "status"
> & { error?: string };

export const list = query({
  args: {},
  handler: async (ctx): Promise<CoachMessage[]> => {
    const userId = await requireUser(ctx);
    const messages = await ctx.db
      .query("coachMessages")
      .withIndex("by_user_time", (q) => q.eq("userId", userId))
      .order("desc")
      .take(50);
    return messages.reverse().map((m) => ({
      _id: m._id,
      role: m.role,
      text: m.text,
      at: m.at,
      status: m.status,
      ...(m.role === "assistant" && m.error !== undefined
        ? { error: m.error }
        : {}),
    }));
  },
});

// The server's clock, so the client can judge stalled replies the same way
// the server does even before it has sent anything.
export const clock = mutation({
  args: {},
  handler: async (ctx) => {
    await requireUser(ctx);
    return Date.now();
  },
});

export const send = mutation({
  args: { text: v.string(), timeZone: v.string() },
  handler: async (ctx, args): Promise<Id<"coachMessages">> => {
    const userId = await requireUser(ctx);
    const text = args.text.trim();
    if (!text) throw new ConvexError("Enter a question for your coach.");
    if (text.length > 1000)
      throw new ConvexError("Keep your question under 1,000 characters.");
    const now = Date.now();
    validHistoryClock(now, args.timeZone);
    const timeZone = normalizeTimeZone(args.timeZone);
    const pending = await ctx.db
      .query("coachMessages")
      .withIndex("by_user_time", (q) => q.eq("userId", userId))
      .filter((q) => q.eq(q.field("status"), "pending"))
      .collect();
    if (pending.some((m) => m.at > now - PENDING_MS))
      throw new ConvexError("The coach is still answering.");
    // Keep usage separate from chat text so clearing cannot reset the limit.
    const limit = await ctx.db
      .query("coachChatLimits")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    const sentAt = limit
      ? limit.sentAt.filter((at) => at > now - 3_600_000)
      : (
          await ctx.db
            .query("coachMessages")
            .withIndex("by_user_time", (q) =>
              q.eq("userId", userId).gt("at", now - 3_600_000),
            )
            .filter((q) => q.eq(q.field("role"), "user"))
            .take(30)
        ).map((m) => m.at);
    if (sentAt.length >= 30)
      throw new ConvexError(
        "You can send 30 questions per hour. Please try again later.",
      );
    sentAt.push(now);
    if (limit) await ctx.db.patch(limit._id, { sentAt });
    else await ctx.db.insert("coachChatLimits", { userId, sentAt });
    for (const m of pending)
      await ctx.db.patch(m._id, { status: "error", error: STALE_ERROR });
    await ctx.db.insert("coachMessages", {
      userId,
      role: "user",
      text,
      at: now,
      status: "done",
    });
    const id = await ctx.db.insert("coachMessages", {
      userId,
      role: "assistant",
      text: "",
      at: now,
      status: "pending",
    });
    await ctx.scheduler.runAfter(0, internal.coachChat.reply, { id, timeZone });
    return id;
  },
});

async function deleteMessages(
  ctx: MutationCtx,
  userId: string,
  ids: Id<"coachMessages">[],
) {
  for (const id of ids.slice(0, 500)) {
    const message = await ctx.db.get(id);
    if (message?.userId === userId) await ctx.db.delete(id);
  }
  if (ids.length > 500)
    await ctx.scheduler.runAfter(0, internal.coachChat.clearBatch, {
      userId,
      ids: ids.slice(500),
    });
}

export const clear = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUser(ctx);
    // Capture the deletion set so continued batches cannot erase new questions.
    const messages = await ctx.db
      .query("coachMessages")
      .withIndex("by_user_time", (q) => q.eq("userId", userId))
      .collect();
    await deleteMessages(
      ctx,
      userId,
      messages.map((m) => m._id),
    );
    return null;
  },
});

export const clearBatch = internalMutation({
  args: { userId: v.string(), ids: v.array(v.id("coachMessages")) },
  handler: async (ctx, args): Promise<void> =>
    deleteMessages(ctx, args.userId, args.ids),
});

type ReplySource =
  { kind: "stale" } | { kind: "ready"; input: CoachChatInput } | null;

export const readReply = internalQuery({
  args: { id: v.id("coachMessages"), timeZone: v.string() },
  handler: async (ctx, args): Promise<ReplySource> => {
    const message = await ctx.db.get(args.id);
    if (
      !message ||
      message.role !== "assistant" ||
      message.status !== "pending"
    )
      return null;
    const now = Date.now();
    if (now - message.at >= PENDING_MS) return { kind: "stale" };
    const userId = message.userId;
    const start = Math.max(0, now - COACH_HISTORY_WINDOW_MS);
    const today = localClock(now, args.timeZone).localDay;
    const fromDay = shiftDay(today, -6);
    const [storedSettings, water, meals, workouts, groups, checkin, recent] =
      await Promise.all([
        ctx.db
          .query("settings")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .unique(),
        ctx.db
          .query("water")
          .withIndex("by_user_time", (q) =>
            q.eq("userId", userId).gte("at", start).lte("at", now),
          )
          .collect(),
        ctx.db
          .query("meals")
          .withIndex("by_user_time", (q) =>
            q.eq("userId", userId).gte("at", start).lte("at", now),
          )
          .collect(),
        ctx.db
          .query("workouts")
          .withIndex("by_user_time", (q) =>
            q
              .eq("userId", userId)
              .gte("trainedAt", start)
              .lte("trainedAt", now),
          )
          .collect(),
        ctx.db
          .query("muscles")
          .withIndex("by_user", (q) => q.eq("userId", userId))
          .collect(),
        ctx.db
          .query("bodyCheckins")
          .withIndex("by_user_day", (q) =>
            q.eq("userId", userId).gte("day", fromDay).lte("day", today),
          )
          .order("desc")
          .first(),
        ctx.db
          .query("coachMessages")
          .withIndex("by_user_time", (q) =>
            q.eq("userId", userId).lte("at", message.at),
          )
          .order("desc")
          .take(12),
      ]);
    const settings = storedSettings ?? { userId, waterGoal: 2500 };
    const loading = readinessForCoach(ctx, userId, now, args.timeZone);
    const recipes = loadSavedMeals(ctx, userId);
    const [muscles, suggestions, readiness, steps, savedMeals] =
      await Promise.all([
        Promise.all(
          groups.map(async (m) => {
            const last = await ctx.db
              .query("workoutMuscles")
              .withIndex("by_user_muscle_time", (q) =>
                q
                  .eq("userId", userId)
                  .eq("muscleId", m._id)
                  .lte("trainedAt", now),
              )
              .order("desc")
              .first();
            return {
              name: m.name,
              cooldownHours: m.cooldownHours,
              soreUntil: m.soreUntil ?? null,
              lastTrainedAt: last?.trainedAt ?? null,
            };
          }),
        ),
        suggestionsFor(
          ctx,
          settings,
          now,
          args.timeZone,
          loading,
          () => recipes,
        ),
        loading,
        stepDays(ctx, userId, today, today, now, 1),
        recipes,
      ]);
    return {
      kind: "ready",
      input: {
        snapshot: buildCoachSnapshot({
          now,
          timeZone: args.timeZone,
          waterGoal: settings.waterGoal,
          targets: {
            kcalTarget: storedSettings?.kcalTarget,
            proteinTarget: storedSettings?.proteinTarget,
          },
          water,
          meals,
          workouts,
          muscles,
          checkin,
          suggestions,
          savedMealRecipes: savedMeals,
          readiness,
          steps: {
            today: steps[0]?.count ?? null,
            goal: storedSettings?.stepGoal ?? DEFAULT_STEP_GOAL,
          },
        }),
        messages: recent
          .reverse()
          .filter((m) => m.status === "done")
          .map((m) => ({ role: m.role, text: m.text })),
      },
    };
  },
});

export const complete = internalMutation({
  args: {
    id: v.id("coachMessages"),
    result: v.union(
      v.object({ status: v.literal("done"), text: v.string() }),
      v.object({ status: v.literal("error"), error: v.string() }),
    ),
  },
  handler: async (ctx, args) => {
    const message = await ctx.db.get(args.id);
    if (
      !message ||
      message.role !== "assistant" ||
      message.status !== "pending"
    )
      return;
    if (Date.now() - message.at >= PENDING_MS)
      await ctx.db.patch(args.id, { status: "error", error: STALE_ERROR });
    else await ctx.db.patch(args.id, args.result);
  },
});

export const reply = internalAction({
  args: { id: v.id("coachMessages"), timeZone: v.string() },
  handler: async (ctx, args): Promise<void> => {
    try {
      const source = await ctx.runQuery(internal.coachChat.readReply, args);
      if (!source) return;
      if (source.kind === "stale") {
        await ctx.runMutation(internal.coachChat.complete, {
          id: args.id,
          result: { status: "error", error: STALE_ERROR },
        });
        return;
      }
      const text = await coachChatProvider().answer(source.input);
      await ctx.runMutation(internal.coachChat.complete, {
        id: args.id,
        result: { status: "done", text },
      });
    } catch (error) {
      await ctx.runMutation(internal.coachChat.complete, {
        id: args.id,
        result: {
          status: "error",
          error:
            error instanceof CoachChatError
              ? error.message
              : "The coach could not answer. Please try again.",
        },
      });
    }
  },
});
