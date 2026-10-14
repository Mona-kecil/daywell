import { z } from "zod";
import { localClock, normalizeTimeZone } from "./coach-time";
import { SPLITS } from "./forecast";

export const quickLogTimestampSchema = z
  .number()
  .min(0)
  .max(8_640_000_000_000_000);
export const quickLogItemSchema = z.object({
  name: z.string().max(200).trim().min(1),
  grams: z.number().positive().max(10_000),
  searchQuery: z.string().max(200).trim().min(1),
});
export const textMealSchema = z.object({
  description: z.string().max(4000).trim().min(1),
  at: quickLogTimestampSchema,
  items: z.array(quickLogItemSchema).min(1).max(30),
});
export const quickLogCheckinSchema = z.object({
  kind: z.literal("checkin"),
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .refine((day) => {
      const at = Date.parse(`${day}T00:00:00Z`);
      return (
        Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === day
      );
    }),
  weightKg: z.number().min(20).max(400).optional(),
  sleepHours: z.number().min(0).max(24).optional(),
  mood: z.number().int().min(1).max(5).optional(),
  energy: z.number().int().min(1).max(5).optional(),
});
export const quickLogProposalSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("water"),
    amountMl: z.number().positive().max(10_000),
    at: quickLogTimestampSchema,
  }),
  z
    .object({
      kind: z.literal("workout"),
      // IDs remain strings in this shared module; the action resolves owned Convex IDs.
      muscleIds: z.array(z.string().min(1)).min(1).max(11),
      muscles: z.array(z.string().min(1).max(200)).min(1).max(11),
      at: quickLogTimestampSchema,
      note: z.string().max(2000),
    })
    .refine((entry) => entry.muscleIds.length === entry.muscles.length),
  textMealSchema.extend({ kind: z.literal("meal") }),
  quickLogCheckinSchema.refine((entry) =>
    [entry.weightKg, entry.sleepHours, entry.mood, entry.energy].some(
      (value) => value !== undefined,
    ),
  ),
]);
export type QuickLogProposal = z.infer<typeof quickLogProposalSchema>;
export const quickLogResultSchema = z.object({
  proposals: z.array(quickLogProposalSchema).max(100),
  leftover: z.array(z.string().max(500)).max(100),
});
export type QuickLogResult = z.infer<typeof quickLogResultSchema>;
export type QuickLogContext = {
  now: number;
  timeZone: string;
  muscles: { id: string; name: string }[];
};

const quantities: Readonly<Record<string, number>> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  half: 0.5,
};
const number =
  "(?:-?\\d+(?:\\.\\d+)?|a|an|one|two|three|four|five|six|seven|eight|nine|ten|half)";
const waterPattern = new RegExp(
  `^(?:(?:drank|drink|had)\\s+)?(${number})\\s*(ml|millilit(?:er|re)s?|l|lit(?:er|re)s?|glasses|glass|bottles?|cups?)(?:\\s+(?:of\\s+)?water)?$`,
  "i",
);
const quantity = (text: string) =>
  quantities[text.toLowerCase()] ?? Number(text);
const aliases: Readonly<Record<string, readonly string[]>> = {
  chest: ["pec", "pecs", "pectorals"],
  back: ["backs"],
  shoulders: ["shoulder", "delt", "delts", "deltoids"],
  biceps: ["bicep", "bis"],
  triceps: ["tricep", "tris"],
  forearms: ["forearm"],
  abs: ["ab", "abdominals", "core"],
  quads: ["quad", "quadriceps"],
  hamstrings: ["hamstring", "hams"],
  glutes: ["glute"],
  calves: ["calf"],
  lats: ["lat", "latissimus"],
};
function mentions(text: string, word: string) {
  const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}
function workoutMuscles(text: string, muscles: QuickLogContext["muscles"]) {
  const splits = SPLITS.filter((split) => mentions(text, split.id));
  const hasLats = muscles.some((m) => m.name.toLowerCase() === "lats");
  return muscles.filter((m) => {
    const name = m.name.toLowerCase();
    const words = [
      name,
      ...(aliases[name] ?? []),
      ...(name === "back" && !hasLats ? ["lats", "lat"] : []),
    ];
    return (
      words.some((word) => mentions(text, word)) ||
      splits.some((split) => split.muscles.some((muscle) => muscle === name))
    );
  });
}
const timePattern =
  /\bat\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b|\bthis morning\b|\bfor (breakfast|lunch|dinner)\b/gi;
function resolveTime(
  text: string,
  { now, timeZone }: QuickLogContext,
): number | null {
  const times = [...text.matchAll(timePattern)];
  const match = times.find((time) => time[1]) ?? times[0];
  if (!match) return now;
  let minutes: number;
  if (match[1]) {
    let hour = Number(match[1]);
    const minute = Number(match[2] ?? 0);
    const meridiem = match[3]?.toLowerCase();
    if (minute > 59 || (meridiem ? hour < 1 || hour > 12 : hour > 23))
      return null;
    if (meridiem) hour = (hour % 12) + (meridiem === "pm" ? 12 : 0);
    minutes = hour * 60 + minute;
  } else
    minutes =
      match[4]?.toLowerCase() === "lunch"
        ? 750
        : match[4]?.toLowerCase() === "dinner"
          ? 1140
          : 480;
  const today = localClock(now, timeZone).localDay;
  const wall = Date.parse(`${today}T00:00:00Z`) + minutes * 60_000;
  let candidate = wall;
  // Solve the zone offset at the target time, including DST, without the host zone.
  for (let i = 0; i < 4; i++) {
    const clock = localClock(candidate, timeZone);
    const actualWall =
      Date.parse(`${clock.localDay}T00:00:00Z`) + clock.localMinutes * 60_000;
    if (actualWall === wall) return Math.min(candidate, now);
    candidate += wall - actualWall;
  }
  // A skipped DST wall time has no instant; ask the user to confirm the current time.
  return now;
}
function foodItem(text: string) {
  const match = text.trim().match(new RegExp(`^(${number})\\s+(.+)$`, "i"));
  const count = match ? quantity(match[1]) : 1;
  const name = (match?.[2] ?? text).trim();
  let grams = 150;
  let searchQuery = name;
  if (/\beggs?\b/i.test(name)) {
    grams = 50;
    searchQuery = "egg whole cooked";
  } else if (/\btoast\b|\bslices? of bread\b/i.test(name)) {
    grams = 30;
    searchQuery = "bread wheat toasted";
  } else if (/\bbananas?\b/i.test(name)) {
    grams = 120;
    searchQuery = "banana raw";
  } else if (/\bapples?\b/i.test(name)) {
    grams = 180;
    searchQuery = "apple raw";
  } else if (/\brice bowls?\b|\bbowls? of rice\b/i.test(name)) {
    grams = 200;
    searchQuery = "rice white cooked";
  } else if (/\bcoffee\b/i.test(name)) {
    grams = 240;
    searchQuery = "coffee brewed";
  }
  return { name, grams: grams * count, searchQuery };
}

export function parseQuickLog(
  text: string,
  context: QuickLogContext,
): QuickLogResult {
  normalizeTimeZone(context.timeZone);
  quickLogTimestampSchema.parse(context.now);
  const proposals: QuickLogProposal[] = [];
  const leftover: string[] = [];
  const day = localClock(context.now, context.timeZone).localDay;
  const start =
    /^(?:i\s+)?(?:drank|drink|trained|train|worked out|workout|had|ate|slept|sleep|weigh|weight|mood|energy|rest day|walked|went|ran|wrote)\b|^-?\d+(?:\.\d+)?\s*(?:kg|h\b)/i;
  const segments = text.split(
    /[;\n]+|[.!?](?!\d)|\band\s+(?=(?:i\s+)?(?:drank|drink|trained|train|worked out|workout|had|ate|slept|sleep|weigh|weight|mood|energy|rest|walked|went|ran|wrote)\b)/i,
  );
  const clauses: string[] = [];
  for (const segment of segments) {
    const grouped: string[] = [];
    for (const fragment of segment
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)) {
      const previous = grouped.at(-1);
      const bareWater = waterPattern.test(
        fragment.replace(timePattern, "").trim(),
      );
      if (
        previous &&
        !start.test(fragment) &&
        !bareWater &&
        !/^(?:push|pull|legs)(?: day)?$/i.test(fragment) &&
        (/^(?:i\s+)?(?:had|ate)\b/i.test(previous) ||
          (/\b(?:train|trained|workout|worked out)\b/i.test(previous) &&
            workoutMuscles(fragment, context.muscles).length))
      )
        grouped[grouped.length - 1] = `${previous}, ${fragment}`;
      else grouped.push(fragment);
    }
    clauses.push(...grouped);
  }
  const add = (entry: unknown, clause: string) => {
    const parsed = quickLogProposalSchema.safeParse(entry);
    if (parsed.success) proposals.push(parsed.data);
    else leftover.push(clause);
  };
  for (const clause of clauses) {
    const at = resolveTime(clause, context);
    if (at === null) {
      leftover.push(clause);
      continue;
    }
    const content = clause
      .replace(timePattern, "")
      .replace(/^i\s+/i, "")
      .trim();
    if (/\brest day\b/i.test(content)) continue;
    const water = content.match(waterPattern);
    if (water) {
      const unit = water[2].toLowerCase();
      const size = /^(?:l|lit)/.test(unit)
        ? 1000
        : unit.startsWith("bottle")
          ? 500
          : /^(?:glass|cup)/.test(unit)
            ? 250
            : 1;
      add({ kind: "water", amountMl: quantity(water[1]) * size, at }, clause);
      continue;
    }
    const sleep = content.match(
      /^(?:slept|sleep)\s+(-?\d+(?:\.\d+)?)\s*(?:hours?|h)$|^(-?\d+(?:\.\d+)?)\s*h(?:ours?)?\s+sleep$/i,
    );
    const weight = content.match(
      /^(?:(?:weigh|weight)(?:\s+is)?\s+)?(-?\d+(?:\.\d+)?)\s*kg$/i,
    );
    const rating = content.match(
      /^(mood|energy)\s+(-?\d+(?:\.\d+)?)(?:\/5)?$/i,
    );
    if (sleep || weight || rating) {
      add(
        {
          kind: "checkin",
          day,
          ...(sleep ? { sleepHours: Number(sleep[1] ?? sleep[2]) } : {}),
          ...(weight ? { weightKg: Number(weight[1]) } : {}),
          ...(rating ? { [rating[1].toLowerCase()]: Number(rating[2]) } : {}),
        },
        clause,
      );
      continue;
    }
    if (
      /^(?:train|trained|workout|worked out)\b/i.test(content) ||
      /^(?:push|pull|legs)(?: day)?$/i.test(content)
    ) {
      const found = workoutMuscles(content, context.muscles);
      const unknown = content
        .replace(/^(?:trained|train|workout|worked out)\b\s*/i, "")
        .split(/\s+and\s+|,/i)
        .map((part) => part.trim())
        .filter(
          (part) => part && !workoutMuscles(part, context.muscles).length,
        );
      leftover.push(...unknown);
      if (found.length)
        add(
          {
            kind: "workout",
            muscleIds: found.map((m) => m.id),
            muscles: found.map((m) => m.name),
            at,
            note: clause,
          },
          clause,
        );
      else if (!unknown.length) leftover.push(clause);
      continue;
    }
    if (/^(?:had|ate)\b/i.test(content)) {
      const description = content.replace(/^(?:had|ate)\s*/i, "").trim();
      add(
        {
          kind: "meal",
          description,
          at,
          items: description
            .split(/\s+and\s+|,/i)
            .map((part) => foodItem(part.trim())),
        },
        clause,
      );
      continue;
    }
    leftover.push(clause);
  }
  return quickLogResultSchema.parse({ proposals, leftover });
}
