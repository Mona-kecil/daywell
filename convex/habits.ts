import { ConvexError, v } from "convex/values";
import {
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { requireUser } from "./model";
import { habitIcon } from "./validators";
import {
  cleanHabitName,
  habitStreak,
  isDay,
  lastDays,
  MAX_HABITS,
  NAME_MAX,
} from "../lib/habits";

async function activeHabits(ctx: QueryCtx | MutationCtx, userId: string) {
  const habits = await ctx.db
    .query("habits")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .collect();
  return habits
    .filter((habit) => habit.archivedAt === undefined)
    .sort((a, b) => a.order - b.order);
}

async function ownedHabit(
  ctx: QueryCtx | MutationCtx,
  userId: string,
  id: Id<"habits">,
) {
  const habit = await ctx.db.get(id);
  if (!habit || habit.userId !== userId)
    throw new ConvexError("Habit not found.");
  return habit;
}

function validName(raw: string) {
  const name = cleanHabitName(raw);
  if (name === null)
    throw new ConvexError(`Enter a habit name of 1–${NAME_MAX} characters.`);
  return name;
}

function validDay(day: string) {
  if (!isDay(day)) throw new ConvexError("Use a valid YYYY-MM-DD day.");
}

export const history = query({
  args: { id: v.id("habits"), today: v.string() },
  handler: async (ctx, { id, today }) => {
    const userId = await requireUser(ctx);
    await ownedHabit(ctx, userId, id);
    validDay(today);
    const days = lastDays(today, 84);
    const logs = await ctx.db
      .query("habitLogs")
      .withIndex("by_user_habit_day", (q) =>
        q
          .eq("userId", userId)
          .eq("habitId", id)
          .gte("day", days[0])
          .lte("day", today),
      )
      .collect();
    return { days: [...new Set(logs.map((log) => log.day))].sort() };
  },
});

export const list = query({
  args: { today: v.string() },
  handler: async (ctx, { today }) => {
    const userId = await requireUser(ctx);
    validDay(today);
    const habits = await activeHabits(ctx, userId);
    const days = lastDays(today, 400);
    const last7 = days.slice(-7);
    const logs = await ctx.db
      .query("habitLogs")
      .withIndex("by_user_day", (q) =>
        q.eq("userId", userId).gte("day", days[0]).lte("day", today),
      )
      .collect();
    const doneByHabit = new Map<Id<"habits">, Set<string>>();
    for (const log of logs) {
      const done = doneByHabit.get(log.habitId) ?? new Set<string>();
      done.add(log.day);
      doneByHabit.set(log.habitId, done);
    }
    return Promise.all(
      habits.map(async (habit) => {
        const done = doneByHabit.get(habit._id) ?? new Set<string>();
        let run = 0;
        let best = 0;
        for (const day of days) {
          run = done.has(day) ? run + 1 : 0;
          best = Math.max(best, run);
        }
        let streak = habitStreak(done, today);
        // Only read older history when the live streak reaches the window's start.
        if (streak > 0 && streak === days.length - (done.has(today) ? 0 : 1)) {
          const older = await ctx.db
            .query("habitLogs")
            .withIndex("by_user_habit_day", (q) =>
              q
                .eq("userId", userId)
                .eq("habitId", habit._id)
                .lt("day", days[0]),
            )
            .collect();
          for (const log of older) done.add(log.day);
          streak = habitStreak(done, today);
        }
        return {
          id: habit._id,
          name: habit.name,
          icon: habit.icon,
          doneToday: done.has(today),
          streak,
          last7: last7.map((day) => done.has(day)),
          best,
        };
      }),
    );
  },
});

export const create = mutation({
  args: { name: v.string(), icon: habitIcon },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    const name = validName(args.name);
    const habits = await activeHabits(ctx, userId);
    if (habits.length >= MAX_HABITS)
      throw new ConvexError(`You can have up to ${MAX_HABITS} active habits.`);
    if (habits.some((habit) => habit.name.toLowerCase() === name.toLowerCase()))
      throw new ConvexError("An active habit with that name already exists.");
    return ctx.db.insert("habits", {
      userId,
      name,
      icon: args.icon,
      order: habits.length ? habits[habits.length - 1].order + 1 : 0,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("habits"),
    name: v.optional(v.string()),
    icon: v.optional(habitIcon),
  },
  handler: async (ctx, args) => {
    const userId = await requireUser(ctx);
    await ownedHabit(ctx, userId, args.id);
    const name = args.name === undefined ? undefined : validName(args.name);
    if (name !== undefined) {
      const habits = await activeHabits(ctx, userId);
      if (
        habits.some(
          (habit) =>
            habit._id !== args.id &&
            habit.name.toLowerCase() === name.toLowerCase(),
        )
      )
        throw new ConvexError("An active habit with that name already exists.");
    }
    await ctx.db.patch(args.id, {
      ...(name === undefined ? {} : { name }),
      ...(args.icon === undefined ? {} : { icon: args.icon }),
    });
    return null;
  },
});

export const archive = mutation({
  args: { id: v.id("habits") },
  handler: async (ctx, { id }) => {
    const userId = await requireUser(ctx);
    const habit = await ownedHabit(ctx, userId, id);
    if (habit.archivedAt === undefined)
      await ctx.db.patch(id, { archivedAt: Date.now() });
    return null;
  },
});

export const move = mutation({
  args: {
    id: v.id("habits"),
    direction: v.union(v.literal("up"), v.literal("down")),
  },
  handler: async (ctx, { id, direction }) => {
    const userId = await requireUser(ctx);
    await ownedHabit(ctx, userId, id);
    const habits = await activeHabits(ctx, userId);
    const index = habits.findIndex((habit) => habit._id === id);
    if (index === -1) return null;
    const neighbour = habits[index + (direction === "up" ? -1 : 1)];
    if (!neighbour) return null;
    await ctx.db.patch(id, { order: neighbour.order });
    await ctx.db.patch(neighbour._id, { order: habits[index].order });
    return null;
  },
});

export const toggle = mutation({
  args: { id: v.id("habits"), day: v.string() },
  handler: async (ctx, { id, day }) => {
    const userId = await requireUser(ctx);
    const habit = await ownedHabit(ctx, userId, id);
    if (habit.archivedAt !== undefined)
      throw new ConvexError("This habit is archived.");
    validDay(day);
    const now = new Date(Date.now());
    now.setUTCHours(0, 0, 0, 0);
    now.setUTCDate(now.getUTCDate() - 400);
    const earliest = now.toISOString().slice(0, 10);
    now.setUTCDate(now.getUTCDate() + 401);
    const latest = now.toISOString().slice(0, 10);
    if (day < earliest || day > latest)
      throw new ConvexError(
        "Use a day within the past 400 days or tomorrow (UTC).",
      );
    const log = await ctx.db
      .query("habitLogs")
      .withIndex("by_user_habit_day", (q) =>
        q.eq("userId", userId).eq("habitId", id).eq("day", day),
      )
      .unique();
    if (log) {
      await ctx.db.delete(log._id);
      return false;
    }
    await ctx.db.insert("habitLogs", { userId, habitId: id, day });
    return true;
  },
});
