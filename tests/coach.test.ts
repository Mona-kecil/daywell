import { describe, expect, it } from "vitest";
import { coachSuggestions, type CoachInput } from "../lib/coach";
const base: CoachInput = {
  now: Date.UTC(2026, 9, 14, 12),
  localMinutes: 12 * 60,
  waterMl: 0,
  waterGoal: 2500,
  macros: { kcal: 0, protein: 0, carbs: 0, fat: 0 },
  targets: {},
  mealCount: 1,
  muscles: [],
};
const suggest = (changes: Partial<CoachInput> = {}) =>
  coachSuggestions({ ...base, ...changes });
describe("coach rules", () => {
  it("paces water within the waking window and rounds the deficit to 50 ml", () => {
    expect(suggest()[0]).toMatchObject({
      id: "water:pace",
      title: "Drink 850 ml of water",
    });
    for (const localMinutes of [0, 7 * 60])
      expect(suggest({ localMinutes })).toEqual([]);
    expect(suggest({ localMinutes: 22 * 60 })[0].title).toBe(
      "Drink 2500 ml of water",
    );
    expect(suggest({ localMinutes: 23 * 60, waterMl: 2500 })).toEqual([]);
    expect(suggest({ waterGoal: 0 })).toEqual([]);
    expect(suggest({ localMinutes: 16 * 60, waterMl: 1125 })).toEqual([]); // exactly 15% behind
  });
  it("nudges protein and calories at both meal checkpoints with portion ideas", () => {
    const targets = { kcalTarget: 2000, proteinTarget: 100 };
    expect(suggest({ localMinutes: 779, waterMl: 2500, targets })).toEqual([]);
    const food = suggest({ localMinutes: 780, waterMl: 2500, targets })[0];
    expect(food.kind).toBe("food");
    expect(food.body).toContain("100 g protein left");
    expect(food.body).toContain("Greek yogurt 200 g ≈ 20 g");
    expect(food.body).toContain("chicken 100 g ≈ 31 g");
    const macros = { kcal: 1000, protein: 50, carbs: 0, fat: 0 };
    expect(
      suggest({ localMinutes: 1139, waterMl: 2500, targets, macros }),
    ).toEqual([]);
    expect(
      suggest({ localMinutes: 1140, waterMl: 2500, targets, macros })[0].body,
    ).toContain("50 g protein left");
    expect(
      suggest({
        localMinutes: 1140,
        waterMl: 2500,
        targets: { kcalTarget: 2000 },
        macros: { ...macros, kcal: 100 },
      })[0].title,
    ).toBe("Make time for your next meal");
    expect(
      suggest({
        localMinutes: 1140,
        waterMl: 2500,
        targets,
        macros: { ...macros, kcal: 2000, protein: 100 },
      }),
    ).toEqual([]);
  });
  it("asks to log lunch from 14:00 when no meals exist", () => {
    expect(suggest({ localMinutes: 839, waterMl: 2500, mealCount: 0 })).toEqual(
      [],
    );
    expect(
      suggest({ localMinutes: 840, waterMl: 2500, mealCount: 0 })[0].id,
    ).toBe("food:log-lunch");
  });
  it("chooses never-trained groups, then the longest-ready group, with stable ties", () => {
    const muscles = [
      {
        name: "chest",
        cooldownHours: 24,
        lastTrainedAt: base.now - 48 * 3_600_000,
      },
      { name: "back", cooldownHours: 24, lastTrainedAt: null },
    ];
    expect(suggest({ muscles }).at(-1)).toMatchObject({
      title: "Train back today",
      body: "You have not logged training for this group.",
    });
    const trained = muscles.map((m) => ({
      ...m,
      lastTrainedAt: base.now - (m.name === "back" ? 72 : 48) * 3_600_000,
    }));
    expect(suggest({ muscles: trained }).at(-1)?.body).toContain(
      "Ready since Mon",
    );
    expect(suggest({ muscles: trained }).at(-1)?.title).toBe(
      "Train back today",
    );
    expect(suggest({ muscles: [...trained].reverse() })).toEqual(
      suggest({ muscles: trained }),
    );
  });
  it("rests when all groups are recovering and names the soonest-ready group", () => {
    const muscles = [
      { name: "chest", cooldownHours: 48, lastTrainedAt: base.now },
      { name: "back", cooldownHours: 24, lastTrainedAt: base.now },
    ];
    expect(suggest({ muscles }).at(-1)).toMatchObject({
      kind: "rest",
      body: "Your trained groups are recovering. back is ready Thu 12:00.",
    });
    expect(
      suggest({
        muscles: [{ ...muscles[1], lastTrainedAt: base.now - 24 * 3_600_000 }],
      }).at(-1)?.kind,
    ).toBe("train");
  });
  it("caps results, sorts priority, keeps text bounds, and repeats deterministically", () => {
    const input = {
      localMinutes: 1200,
      targets: { kcalTarget: 2000, proteinTarget: 150 },
      mealCount: 0,
      muscles: [{ name: "back", cooldownHours: 24, lastTrainedAt: null }],
    };
    const results = suggest(input);
    expect(results).toHaveLength(3);
    expect(results).toEqual(suggest(input));
    expect(results.map((s) => s.priority)).toEqual([1, 1, 2]);
    for (const s of results) {
      expect(s.title.length).toBeLessThanOrEqual(60);
      expect(s.body.length).toBeLessThanOrEqual(140);
    }
  });
});
