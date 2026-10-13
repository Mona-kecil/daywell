import { afterEach, describe, expect, it } from "vitest";
import { recovery, MUSCLE_DEFAULTS } from "../lib/recovery";
import { localDateTimeValue, localDayRange } from "../lib/day";
import { extractPer100g, mealTotals, scaleNutrients, type FdcFood } from "../lib/nutrients";
import { fake } from "../convex/mealVision/fake";

const hour = 3_600_000;
describe("muscle recovery", () => {
  it("seeds the requested defaults", () => expect(MUSCLE_DEFAULTS.map(m => m.cooldownHours)).toEqual([72, 72, 48, 48, 48, 24, 24, 72, 72, 72, 48]));
  it("starts at 0%", () => expect(recovery(0, 0, 72)).toMatchObject({ fraction: 0, label: "Ready in 72h 0m" }));
  it("reaches 50%", () => expect(recovery(36 * hour, 0, 72)).toMatchObject({ fraction: .5, label: "Ready in 36h 0m" }));
  it.each([72, 100])("caps at 100%% after %i hours", hours => expect(recovery(hours * hour, 0, 72)).toMatchObject({ fraction: 1, label: "Ready" }));
  it("marks never trained", () => expect(recovery(0, null, 72)).toMatchObject({ kind: "never", label: "Never trained" }));
  it("clamps future workouts to zero", () => expect(recovery(0, hour, 72).fraction).toBe(0));
  it("rounds remaining partial minutes up", () => expect(recovery(59_999, 0, 1).label).toBe("Ready in 1h 0m"));
});
const food = (energies: { nutrientId: number; value: number; unitName: string }[]): FdcFood => ({ fdcId: 1, description: "Rice", foodNutrients: [
  { nutrientId: 1003, value: 2.5, unitName: "G" }, { nutrientId: 1004, value: .3, unitName: "G" }, { nutrientId: 1005, value: 28, unitName: "G" }, ...energies,
] });
describe("nutrients", () => {
  it("scales per-100g nutrients", () => expect(scaleNutrients({ kcal: 130, protein: 2.5, carbs: 28, fat: .3 }, 150)).toEqual({ kcal: 195, protein: 3.75, carbs: 42, fat: .45 }));
  it("prefers 1008", () => expect(extractPer100g(food([1008, 2047, 2048].map((nutrientId, index) => ({ nutrientId, value: 130 + index, unitName: "KCAL" }))))?.kcal).toBe(130));
  it("falls back to 2047", () => expect(extractPer100g(food([{ nutrientId: 2047, value: 131, unitName: "KCAL" }, { nutrientId: 2048, value: 132, unitName: "KCAL" }]))?.kcal).toBe(131));
  it("falls back to 2048", () => expect(extractPer100g(food([{ nutrientId: 2048, value: 132, unitName: "KCAL" }]))?.kcal).toBe(132));
  it("does not treat kJ as kcal", () => expect(extractPer100g(food([{ nutrientId: 1008, value: 544, unitName: "KJ" }]))).toBeNull());
  it("rejects incomplete foods", () => expect(extractPer100g(food([]))).toBeNull());
  it("excludes unmatched foods from totals", () => expect(mealTotals([{ id: "1", name: "Mystery", grams: 150, searchQuery: "unknown", status: "unmatched" }])).toEqual({ kcal: 0, protein: 0, carbs: 0, fat: 0 }));
  it("recomputes totals from edited grams", () => expect(mealTotals([{ id: "1", name: "Rice", grams: 200, searchQuery: "rice", status: "matched", fdcId: 1, foodDescription: "Rice", per100g: { kcal: 130, protein: 2.5, carbs: 28, fat: .3 } }]).kcal).toBe(260));
});
const originalTz = process.env.TZ;
afterEach(() => { process.env.TZ = originalTz; });
describe("local days", () => {
  it("rolls over at local midnight, not UTC midnight", () => {
    process.env.TZ = "Asia/Jakarta";
    const before = localDayRange(new Date("2026-10-13T16:59:59Z"));
    const after = localDayRange(new Date("2026-10-13T17:00:00Z"));
    expect(new Date(before.startMs).toISOString()).toBe("2026-10-12T17:00:00.000Z");
    expect(before.endMs).toBe(after.startMs);
  });
  it.each([["2026-03-08T12:00:00Z", 23], ["2026-11-01T12:00:00Z", 25]])("uses calendar days across DST: %s", (date, hours) => {
    process.env.TZ = "America/New_York";
    const range = localDayRange(new Date(date));
    expect(range.endMs - range.startMs).toBe(Number(hours) * hour);
  });
  it("formats workout input in device local time", () => {
    process.env.TZ = "Asia/Jakarta";
    expect(localDateTimeValue(new Date("2026-10-13T17:00:00Z"))).toBe("2026-10-14T00:00");
  });
});
it("fake provider honors corrected description", async () => {
  const result = await fake.analyze({ imageUrl: "https://example.test/photo", description: "Tofu and rice" });
  expect(result.description).toBe("Tofu and rice");
  expect(result.items.map(item => item.name)).toEqual(["Rice", "Tofu"]);
});
