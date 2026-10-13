export type TimelineEvent =
  | { kind: "water"; at: number; ml: number; drinks: number }
  | { kind: "meal"; at: number; id: string; title: string; kcal: number | null }
  | {
      kind: "workout";
      at: number;
      id: string;
      muscles: string[];
      note: string;
    };

// Drinks this close to the previous one read as one sitting, not a new row.
export const DRINK_GAP_MS = 30 * 60_000;

type Sip = { at: number; amountMl: number };

// Newest first: water grouped into sittings, then meals and workouts as-is.
export function dayTimeline({
  water,
  meals,
  workouts,
}: {
  water: Sip[];
  meals: { id: string; at: number; title: string; kcal: number | null }[];
  workouts: { id: string; at: number; muscles: string[]; note: string }[];
}): TimelineEvent[] {
  const sittings = [...water]
    .sort((a, b) => a.at - b.at)
    .reduce<Sip[][]>((groups, sip) => {
      const last = groups.at(-1);
      if (last && sip.at - last[last.length - 1].at <= DRINK_GAP_MS)
        return [...groups.slice(0, -1), [...last, sip]];
      return [...groups, [sip]];
    }, []);
  return [
    ...sittings.map((g) => ({
      kind: "water" as const,
      at: g[0].at,
      ml: g.reduce((sum, s) => sum + s.amountMl, 0),
      drinks: g.length,
    })),
    ...meals.map((m) => ({ kind: "meal" as const, ...m })),
    ...workouts.map((w) => ({ kind: "workout" as const, ...w })),
  ].sort((a, b) => b.at - a.at);
}
