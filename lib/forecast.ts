export const FORECAST_MS = 48 * 3_600_000;

// A classic three-way split, matched by muscle name.
export const SPLITS = [
  { id: "push", label: "Push", muscles: ["chest", "shoulders", "triceps"] },
  { id: "pull", label: "Pull", muscles: ["back", "biceps", "forearms"] },
  {
    id: "legs",
    label: "Legs",
    muscles: ["quads", "hamstrings", "glutes", "calves"],
  },
] as const;

type ForecastMuscle = {
  name: string;
  lastTrainedAt: number | null;
  cooldownHours: number;
};

export const readyAt = (m: ForecastMuscle) =>
  m.lastTrainedAt === null
    ? null
    : m.lastTrainedAt + m.cooldownHours * 3_600_000;

// Recovering muscles soonest first, plus when each split is fully ready.
// Splits ready at the same time favour the one rested longest.
export function forecast<M extends ForecastMuscle>(muscles: M[], now: number) {
  const recovering = muscles
    .flatMap((muscle) => {
      const at = readyAt(muscle);
      return at !== null && at > now ? [{ muscle, at }] : [];
    })
    .sort((a, b) => a.at - b.at);
  const splits = SPLITS.flatMap((split) => {
    const members = muscles.filter((m) =>
      (split.muscles as readonly string[]).includes(m.name),
    );
    if (!members.length) return [];
    return [
      {
        id: split.id,
        label: split.label,
        members,
        at: Math.max(now, ...members.map((m) => readyAt(m) ?? now)),
        lastTrainedAt: Math.max(0, ...members.map((m) => m.lastTrainedAt ?? 0)),
      },
    ];
  });
  const next =
    [...splits].sort(
      (a, b) => a.at - b.at || a.lastTrainedAt - b.lastTrainedAt,
    )[0] ?? null;
  return { recovering, splits, next };
}

// Local midnights strictly inside the forecast window.
export function midnights(now: number, spanMs = FORECAST_MS) {
  const out: number[] = [];
  const d = new Date(now);
  d.setHours(24, 0, 0, 0);
  while (d.getTime() < now + spanMs) {
    out.push(d.getTime());
    d.setDate(d.getDate() + 1);
  }
  return out;
}
