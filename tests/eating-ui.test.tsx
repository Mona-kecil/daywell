// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EatingWindowCard } from "../components/eating";
import { dayWindow } from "../lib/insights";

const zone = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "America/New_York";
});
afterAll(() => {
  if (zone === undefined) delete process.env.TZ;
  else process.env.TZ = zone;
});
afterEach(cleanup);

const at = (day: string, time: string) =>
  new Date(`${day}T${time}:00`).getTime();
const days = () => dayWindow(new Date(at("2026-10-14", "12:00")), 91).days;
const card = (times: number[]) =>
  render(
    <EatingWindowCard
      meals={times.map((t) => ({ at: t }))}
      days={days()}
      today="2026-10-14"
    />,
  );
const readout = () => document.querySelector("figcaption")!.textContent;

describe("Eating window card", () => {
  it("waits for the first meal", () => {
    card([at("2026-09-01", "08:00")]);
    expect(
      screen.getByText("Meal times show here once you log meals."),
    ).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("shows the chart before there are enough days for usual times", () => {
    card([at("2026-10-13", "08:00"), at("2026-10-13", "19:30")]);
    expect(
      screen.getByText("Usual times appear after meals on 3 days."),
    ).toBeTruthy();
    expect(readout()).toBe(
      "Tue, Oct 13 · 2 meals · 8:00 AM–7:30 PM, 11 h 30 min",
    );
  });

  it("summarises the usual day and steps through days by keyboard", () => {
    card([
      at("2026-10-11", "08:00"),
      at("2026-10-11", "18:00"),
      at("2026-10-12", "09:00"),
      at("2026-10-12", "21:00"),
      at("2026-10-13", "07:00"),
      at("2026-10-14", "10:00"),
    ]);
    const stat = (label: string) =>
      screen.getByText(label).nextElementSibling!.textContent;
    expect(stat("Usual window")).toBe("11 h");
    expect(stat("First meal")).toBe("8:30 AM");
    expect(stat("Last meal")).toBe("6:00 PM");
    expect(stat("Overnight gap")).toBe("15 h");

    expect(readout()).toBe("Today · 1 meal at 10:00 AM");
    const chart = screen.getByRole("img", {
      name: /Meal times for the last 14 days/,
    });
    fireEvent.keyDown(chart, { key: "ArrowUp" });
    expect(readout()).toBe("Tue, Oct 13 · 1 meal at 7:00 AM");
    fireEvent.keyDown(chart, { key: "ArrowUp" });
    fireEvent.keyDown(chart, { key: "ArrowUp" });
    expect(readout()).toBe("Sun, Oct 11 · 2 meals · 8:00 AM–6:00 PM, 10 h");
    fireEvent.keyDown(chart, { key: "ArrowUp" });
    expect(readout()).toBe("Sat, Oct 10 · No meals logged");
    // Stops at today.
    for (let i = 0; i < 6; i++) fireEvent.keyDown(chart, { key: "ArrowDown" });
    expect(readout()).toBe("Today · 1 meal at 10:00 AM");
    // Fourteen rows, one per day.
    expect(document.querySelectorAll(".eating-row")).toHaveLength(14);
    expect(document.querySelector(".eating-day")!.textContent).toBe("Thu 1");
  });
});
