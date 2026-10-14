import { describe, expect, it } from "vitest";
import { localClock } from "../lib/coach-time";
import {
  parseQuickLog,
  quickLogProposalSchema,
  textMealSchema,
} from "../lib/quick-log";
import { MUSCLE_DEFAULTS } from "../lib/recovery";

const now = Date.UTC(2026, 9, 14, 12);
const context = {
  now,
  timeZone: "Asia/Jakarta",
  muscles: MUSCLE_DEFAULTS.map((m) => ({ id: `id:${m.name}`, name: m.name })),
};
const parse = (text: string) => parseQuickLog(text, context);

describe("quick log parser", () => {
  it("proposes the whole example without writing anything", () => {
    const result = parse(
      "drank 500 ml of water, trained back and biceps at 7am, had 2 eggs and toast for breakfast, slept 7.5 hours",
    );
    expect(result).toEqual({
      proposals: [
        { kind: "water", amountMl: 500, at: now },
        {
          kind: "workout",
          muscleIds: ["id:back", "id:biceps"],
          muscles: ["back", "biceps"],
          at: Date.UTC(2026, 9, 14, 0),
          note: "trained back and biceps at 7am",
        },
        {
          kind: "meal",
          description: "2 eggs and toast",
          at: Date.UTC(2026, 9, 14, 1),
          items: [
            { name: "eggs", grams: 100, searchQuery: "egg whole cooked" },
            { name: "toast", grams: 30, searchQuery: "bread wheat toasted" },
          ],
        },
        { kind: "checkin", day: "2026-10-14", sleepHours: 7.5 },
      ],
      leftover: [],
    });
    expect(parse("drank 500 ml of water")).toEqual(
      parse("drank 500 ml of water"),
    );
  });
  it.each([
    ["500 ml", 500],
    ["0.5 l", 500],
    ["2 glasses", 500],
    ["a bottle", 500],
    ["a cup", 250],
    ["drank two glasses of water", 500],
    ["I drank 1 liter water", 1000],
    ["10000 ml", 10000],
  ])("reads water: %s", (text, amountMl) => {
    expect(parse(text)).toEqual({
      proposals: [{ kind: "water", amountMl, at: now }],
      leftover: [],
    });
  });
  it.each([
    ["trained BIS and Tris", ["biceps", "triceps"]],
    ["trained shoulders and lats", ["back", "shoulders"]],
    ["trained quad and calves", ["quads", "calves"]],
    ["trained pecs and core", ["chest", "abs"]],
    ["push day", ["chest", "shoulders", "triceps"]],
    ["worked out pull", ["back", "biceps", "forearms"]],
    ["legs", ["quads", "hamstrings", "glutes", "calves"]],
    ["trained back, biceps at 7am", ["back", "biceps"]],
  ])("maps muscles and splits: %s", (text, muscles) => {
    expect(parse(text).proposals[0]).toMatchObject({
      kind: "workout",
      muscles,
      muscleIds: muscles.map((m) => `id:${m}`),
    });
  });
  it("uses lats rather than back when the user owns lats", () => {
    expect(
      parseQuickLog("trained lats", {
        ...context,
        muscles: [...context.muscles, { id: "lats-id", name: "lats" }],
      }).proposals[0],
    ).toMatchObject({ muscles: ["lats"], muscleIds: ["lats-id"] });
  });
  it("leaves rest day empty and exposes unknown muscles and clauses", () => {
    expect(parse("rest day")).toEqual({ proposals: [], leftover: [] });
    expect(
      parse("trained back and yoga; went for a walk; drank 250 ml"),
    ).toMatchObject({
      proposals: [
        { kind: "workout", muscles: ["back"] },
        { kind: "water", amountMl: 250 },
      ],
      leftover: ["yoga", "went for a walk"],
    });
    expect(parse("drank 500 ml and wrote a poem").leftover).toEqual([
      "wrote a poem",
    ]);
    expect(parse("trained yoga")).toEqual({
      proposals: [],
      leftover: ["yoga"],
    });
  });
  it.each([
    ["at 7am", "07:00"],
    ["at 12pm", "12:00"],
    ["at 12am", "00:00"],
    ["this morning", "08:00"],
    ["for breakfast", "08:00"],
    ["for lunch", "12:30"],
    ["for dinner", "19:00"],
  ])("uses local clock %s", (time, slot) => {
    const entry = parse(`drank 250 ml ${time}`).proposals[0];
    if (entry.kind !== "water") throw new Error("Expected water");
    expect(localClock(entry.at, context.timeZone)).toMatchObject({
      localDay: "2026-10-14",
      slot,
    });
  });
  it.each(["Asia/Jakarta", "America/New_York"])(
    "clamps future times in %s",
    (timeZone) => {
      const result = parseQuickLog("drank 500 ml at 19:30", {
        ...context,
        timeZone,
      });
      expect(result.proposals[0]).toEqual({
        kind: "water",
        amountMl: 500,
        at: now,
      });
    },
  );
  it("gives explicit times precedence over meal slots and reads past 24-hour times", () => {
    expect(parse("had eggs for breakfast at 7am").proposals[0]).toMatchObject({
      at: Date.UTC(2026, 9, 14, 0),
    });
    expect(
      parseQuickLog("500 ml at 19:30", {
        ...context,
        now: Date.UTC(2026, 9, 14, 14),
      }).proposals[0],
    ).toMatchObject({ at: Date.UTC(2026, 9, 14, 12, 30) });
  });
  it("keeps a separate unknown activity after a meal", () => {
    expect(parse("had 2 eggs and wrote a poem")).toMatchObject({
      proposals: [{ kind: "meal", items: [{ grams: 100 }] }],
      leftover: ["wrote a poem"],
    });
  });
  it("uses New York's local day and DST offset rather than the host clock", () => {
    const result = parseQuickLog("drank 250 ml at 7am; slept 7h", {
      ...context,
      now: Date.UTC(2026, 9, 14, 15),
      timeZone: "America/New_York",
    });
    expect(result.proposals).toEqual([
      { kind: "water", amountMl: 250, at: Date.UTC(2026, 9, 14, 11) },
      { kind: "checkin", day: "2026-10-14", sleepHours: 7 },
    ]);
    expect(
      parseQuickLog("7h sleep", {
        ...context,
        now: Date.UTC(2026, 9, 14, 2),
        timeZone: "America/New_York",
      }).proposals[0],
    ).toMatchObject({ day: "2026-10-13" });
  });
  it("handles DST gap and fold without a future time", () => {
    const gap = parseQuickLog("500 ml at 2:30", {
      ...context,
      now: Date.UTC(2026, 2, 8, 15),
      timeZone: "America/New_York",
    });
    expect(gap.proposals[0]).toMatchObject({ at: Date.UTC(2026, 2, 8, 15) });
    const fold = parseQuickLog("500 ml at 1:30", {
      ...context,
      now: Date.UTC(2026, 10, 1, 15),
      timeZone: "America/New_York",
    });
    expect(fold.proposals[0]).toMatchObject({
      at: Date.UTC(2026, 10, 1, 5, 30),
    });
  });
  it("keeps hard clause boundaries and separates bare water after a meal", () => {
    expect(parse("ate eggs; the weather changed; 500 ml")).toMatchObject({
      proposals: [{ kind: "meal" }, { kind: "water", amountMl: 500 }],
      leftover: ["the weather changed"],
    });
    expect(parse("had eggs, 500 ml, pull day")).toMatchObject({
      proposals: [
        { kind: "meal" },
        { kind: "water" },
        { kind: "workout", muscles: ["back", "biceps", "forearms"] },
      ],
      leftover: [],
    });
  });
  it("reads all check-in fields including compact weight and ratings", () => {
    expect(
      parse("I weigh 72.4 kg, 7h sleep, mood 4 and energy 3/5").proposals,
    ).toEqual([
      { kind: "checkin", day: "2026-10-14", weightKg: 72.4 },
      { kind: "checkin", day: "2026-10-14", sleepHours: 7 },
      { kind: "checkin", day: "2026-10-14", mood: 4 },
      { kind: "checkin", day: "2026-10-14", energy: 3 },
    ]);
    expect(parse("72.4kg").proposals[0]).toMatchObject({ weightKg: 72.4 });
  });
  it("splits meal lists and multiplies quantity words and numbers", () => {
    const entry = parse(
      "ate two eggs, 2 slices of bread and a banana and an apple and 2 rice bowls and coffee and tofu for lunch",
    ).proposals[0];
    expect(entry).toMatchObject({
      kind: "meal",
      at: Date.UTC(2026, 9, 14, 5, 30),
      items: [
        { name: "eggs", grams: 100 },
        { name: "slices of bread", grams: 60 },
        { name: "banana", grams: 120 },
        { name: "apple", grams: 180 },
        { name: "rice bowls", grams: 400 },
        { name: "coffee", grams: 240 },
        { name: "tofu", grams: 150 },
      ],
    });
  });
  it.each([
    "10001 ml",
    "0 ml",
    "-1 ml",
    "weigh 19 kg",
    "401kg",
    "slept 25 hours",
    "slept -1 hours",
    "mood 0",
    "energy 6/5",
    "mood 2.5",
    "ate 0 eggs",
    "ate 201 eggs",
    "ate",
    "500 ml at 25:30",
    "500 ml at 7:60",
    "500 ml at 0am",
  ])("rejects limits or invalid values: %s", (text) => {
    expect(parse(text)).toEqual({ proposals: [], leftover: [text] });
  });
  it.each([
    "20kg",
    "400kg",
    "slept 0 hours",
    "slept 24 hours",
    "mood 1",
    "energy 5/5",
    "ate 200 eggs",
  ])("accepts boundary %s", (text) => {
    expect(parse(text).leftover).toEqual([]);
    expect(parse(text).proposals).toHaveLength(1);
  });
  it("rejects more than 30 food items and validates the exported schema", () => {
    const text = `ate ${Array.from({ length: 31 }, () => "egg").join(" and ")}`;
    expect(parse(text)).toEqual({ proposals: [], leftover: [text] });
    expect(
      quickLogProposalSchema.safeParse({
        kind: "checkin",
        day: "2026-02-30",
        mood: 4,
      }).success,
    ).toBe(false);
    expect(
      quickLogProposalSchema.safeParse({ kind: "checkin", day: "2026-10-14" })
        .success,
    ).toBe(false);
    expect(
      quickLogProposalSchema.safeParse({
        kind: "workout",
        muscleIds: ["id"],
        muscles: [],
        at: now,
        note: "",
      }).success,
    ).toBe(false);
    expect(
      textMealSchema.safeParse({ description: "Meal", at: now, items: [] })
        .success,
    ).toBe(false);
  });
});
