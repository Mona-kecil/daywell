import { afterEach, describe, expect, it } from "vitest";
import { FORECAST_MS, ceilHour, forecast, midnights } from "../lib/forecast";

const h = 3_600_000;
const now = new Date(2026, 9, 14, 9, 30).getTime();
const muscle = (name: string, hoursAgo: number | null, cooldownHours = 48) => ({
  name,
  lastTrainedAt: hoursAgo === null ? null : now - hoursAgo * h,
  cooldownHours,
});

describe("recovery forecast", () => {
  it("lists only recovering muscles, soonest first", () => {
    const { recovering } = forecast(
      [
        muscle("chest", 10, 72),
        muscle("abs", 30, 24),
        muscle("biceps", 40),
        muscle("calves", null),
      ],
      now,
    );
    expect(recovering.map((r) => [r.muscle.name, (r.at - now) / h])).toEqual([
      ["biceps", 8],
      ["chest", 62],
    ]);
  });

  it("dates a split by its slowest muscle and skips missing splits", () => {
    const { splits } = forecast(
      [muscle("chest", 10, 72), muscle("shoulders", 47), muscle("back", 60)],
      now,
    );
    expect(splits.map((s) => [s.id, (s.at - now) / h])).toEqual([
      ["push", 62],
      ["pull", 0],
    ]);
  });

  it("suggests the earliest split, then the one rested longest", () => {
    const { next } = forecast(
      [muscle("chest", 50), muscle("back", 80), muscle("quads", 10, 72)],
      now,
    );
    expect(next?.id).toBe("pull");
  });

  it("treats never-trained muscles as ready now", () => {
    const { next } = forecast([muscle("quads", null)], now);
    expect(next).toMatchObject({ id: "legs", at: now });
  });

  it("returns no suggestion without split muscles", () => {
    expect(forecast([muscle("neck", 1)], now).next).toBeNull();
  });

  it("finds the local midnights inside the window", () => {
    expect(midnights(now)).toEqual([
      new Date(2026, 9, 15).getTime(),
      new Date(2026, 9, 16).getTime(),
    ]);
    expect(midnights(new Date(2026, 9, 14).getTime(), FORECAST_MS)).toEqual([
      new Date(2026, 9, 15).getTime(),
    ]);
  });
});

describe("ceilHour", () => {
  const tz = process.env.TZ;
  afterEach(() => {
    process.env.TZ = tz;
  });
  it("rounds up to the local hour in a half-hour time zone", () => {
    process.env.TZ = "Asia/Kolkata";
    // 09:20 IST rounds to 10:00 IST, not 09:30 (the next UTC hour).
    const by = new Date(ceilHour(Date.UTC(2026, 0, 1, 3, 50)));
    expect([by.getHours(), by.getMinutes()]).toEqual([10, 0]);
    // 10:00 IST is already on the hour.
    const exact = Date.UTC(2026, 0, 1, 4, 30);
    expect(ceilHour(exact)).toBe(exact);
  });
});
