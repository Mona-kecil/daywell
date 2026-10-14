import { v } from "convex/values";
import { query } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireUser, validTimestamp } from "./model";
import { liftTrend, type LiftSession, type LiftTrend } from "../lib/trends";

const STATUS_ORDER = {
  stalled: 0,
  slipping: 1,
  climbing: 2,
  steady: 3,
  early: 4,
  lapsed: 5,
} satisfies Record<LiftTrend["status"], number>;

export const list = query({
  args: { now: v.number() },
  handler: async (ctx, { now }) => {
    const userId = await requireUser(ctx);
    validTimestamp(now);
    const [rows, exercises] = await Promise.all([
      ctx.db
        .query("strengthSets")
        .withIndex("by_user_time", (q) =>
          q.eq("userId", userId).lte("trainedAt", now),
        )
        .order("desc")
        .take(5000),
      ctx.db
        .query("exercises")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect(),
    ]);
    const byExercise = new Map<
      Id<"exercises">,
      Map<Id<"workouts">, LiftSession>
    >();
    for (const row of rows.sort(
      (a, b) => a.trainedAt - b.trainedAt || a.order - b.order,
    )) {
      let sessions = byExercise.get(row.exerciseId);
      if (!sessions) {
        sessions = new Map();
        byExercise.set(row.exerciseId, sessions);
      }
      let session = sessions.get(row.workoutId);
      if (!session) {
        session = { trainedAt: row.trainedAt, sets: [] };
        sessions.set(row.workoutId, session);
      }
      session.sets.push({ reps: row.reps, weightKg: row.weightKg });
    }
    const lifts = exercises.flatMap((exercise) => {
      const sessions = byExercise.get(exercise._id);
      return sessions
        ? [
            {
              id: exercise._id,
              name: exercise.name,
              ...liftTrend([...sessions.values()], now),
            },
          ]
        : [];
    });
    lifts.sort(
      (a, b) =>
        STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
        (b.lastAt ?? 0) - (a.lastAt ?? 0),
    );
    return { lifts };
  },
});
