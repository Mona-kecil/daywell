import type { QueryCtx } from "./_generated/server";

export const MAX_SESSIONS_PER_DAY = 50;

// Read all owned history in batches without truncating all-time bests or exports.
// Finish each batch's last day before advancing past it in the day index.
export async function* cardioHistory(
  ctx: Pick<QueryCtx, "db">,
  userId: string,
) {
  let after: string | undefined;
  while (true) {
    const rows = await ctx.db
      .query("cardioSessions")
      .withIndex("by_user_day", (q) => {
        const owned = q.eq("userId", userId);
        return after === undefined ? owned : owned.gt("day", after);
      })
      .take(400);
    if (rows.length < 400) {
      yield rows;
      return;
    }
    const lastDay = rows[rows.length - 1].day;
    yield rows.filter((row) => row.day < lastDay);
    yield await ctx.db
      .query("cardioSessions")
      .withIndex("by_user_day", (q) =>
        q.eq("userId", userId).eq("day", lastDay),
      )
      .take(MAX_SESSIONS_PER_DAY);
    after = lastDay;
  }
}
