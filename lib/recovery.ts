export const MUSCLE_DEFAULTS = [
  { name: "chest", cooldownHours: 72 }, { name: "back", cooldownHours: 72 },
  { name: "shoulders", cooldownHours: 48 }, { name: "biceps", cooldownHours: 48 },
  { name: "triceps", cooldownHours: 48 }, { name: "forearms", cooldownHours: 24 },
  { name: "abs", cooldownHours: 24 }, { name: "quads", cooldownHours: 72 },
  { name: "hamstrings", cooldownHours: 72 }, { name: "glutes", cooldownHours: 72 },
  { name: "calves", cooldownHours: 48 },
] satisfies { name: string; cooldownHours: number }[];

export function recovery(now: number, lastTrainedAt: number | null, cooldownHours: number) {
  if (lastTrainedAt === null) return { kind: "never" as const, fraction: 1, label: "Never trained" };
  const cooldownMs = cooldownHours * 3_600_000;
  const elapsed = Math.max(0, now - lastTrainedAt);
  const fraction = Math.min(1, elapsed / cooldownMs);
  if (fraction >= 1) return { kind: "ready" as const, fraction, label: "Ready" };
  const minutes = Math.ceil((cooldownMs - elapsed) / 60_000);
  return { kind: "recovering" as const, fraction, label: `Ready in ${Math.floor(minutes / 60)}h ${minutes % 60}m` };
}
