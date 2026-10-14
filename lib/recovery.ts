export const MUSCLE_DEFAULTS = [
  { name: "chest", cooldownHours: 72 },
  { name: "back", cooldownHours: 72 },
  { name: "shoulders", cooldownHours: 48 },
  { name: "biceps", cooldownHours: 48 },
  { name: "triceps", cooldownHours: 48 },
  { name: "forearms", cooldownHours: 24 },
  { name: "abs", cooldownHours: 24 },
  { name: "quads", cooldownHours: 72 },
  { name: "hamstrings", cooldownHours: 72 },
  { name: "glutes", cooldownHours: 72 },
  { name: "calves", cooldownHours: 48 },
] satisfies { name: string; cooldownHours: number }[];

export const SORE_EXTEND_HOURS = 12;
export const SORE_MAX_HOURS = 72;

export type Recovery = {
  kind: "never" | "ready" | "recovering";
  fraction: number;
  label: string;
  sore: boolean;
};
export function recovery(
  now: number,
  lastTrainedAt: number | null,
  cooldownHours: number,
  soreUntil?: number | null,
): Recovery {
  const cooldownEnd =
    lastTrainedAt === null ? null : lastTrainedAt + cooldownHours * 3_600_000;
  if (
    soreUntil != null &&
    soreUntil > now &&
    (cooldownEnd === null || soreUntil > cooldownEnd)
  ) {
    const minutes = Math.ceil((soreUntil - now) / 60_000);
    return {
      kind: "recovering",
      fraction:
        lastTrainedAt === null
          ? 0
          : Math.max(
              0,
              Math.min(1, (now - lastTrainedAt) / (soreUntil - lastTrainedAt)),
            ),
      label: `Sore · ready in ${Math.floor(minutes / 60)}h ${minutes % 60}m`,
      sore: true,
    };
  }
  if (lastTrainedAt === null)
    return { kind: "never", fraction: 1, label: "Never trained", sore: false };
  const cooldownMs = cooldownHours * 3_600_000;
  const elapsed = now - lastTrainedAt;
  const fraction = Math.max(0, Math.min(1, elapsed / cooldownMs));
  if (fraction >= 1)
    return { kind: "ready", fraction, label: "Ready", sore: false };
  const minutes = Math.ceil((cooldownMs - elapsed) / 60_000);
  return {
    kind: "recovering",
    sore: false,
    fraction,
    label: `Ready in ${Math.floor(minutes / 60)}h ${minutes % 60}m`,
  };
}
