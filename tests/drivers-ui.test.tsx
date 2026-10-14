// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DriversCard } from "../components/drivers";
import type { Finding } from "../lib/drivers";

const mocks = vi.hoisted(() => ({ data: undefined as unknown }));
vi.mock("convex/react", () => ({ useQuery: () => mocks.data }));

const finding = (over: Partial<Finding>): Finding => ({
  factor: "sleepHours",
  outcome: "energy",
  lag: 0,
  n: 40,
  rho: 0.6,
  highMean: 4.1,
  lowMean: 3.2,
  split: 7,
  strength: "strong",
  confidence: "steady",
  ...over,
});
const items = () =>
  within(screen.getByRole("list"))
    .getAllByRole("listitem")
    .map((li) => li.querySelector("p")!.textContent);

afterEach(() => {
  cleanup();
  mocks.data = undefined;
});

describe("What goes with your energy", () => {
  it("counts down to the first patterns", () => {
    mocks.data = { days: 90, checkInDays: 7, needed: 3, findings: [] };
    render(<DriversCard />);
    expect(screen.getByText(/on 3 more days to see/)).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.queryByRole("group", { name: "Compare with" })).toBeNull();
  });

  it("lists clear patterns for the chosen outcome, weak ones on request", async () => {
    mocks.data = {
      days: 90,
      checkInDays: 40,
      needed: 0,
      findings: [
        finding({}),
        finding({
          factor: "lateCaffeineMg",
          lag: 1,
          rho: -0.47,
          highMean: 2.9,
          lowMean: 3.6,
          split: 0,
          strength: "moderate",
          n: 20,
          confidence: "early",
        }),
        finding({ factor: "waterMl", rho: 0.1, split: 2000, strength: "weak" }),
        finding({
          factor: "trained",
          outcome: "mood",
          highMean: 4,
          lowMean: 3.5,
        }),
      ],
    };
    render(<DriversCard />);
    expect(
      screen.getByRole("heading", { name: "What goes with your energy" }),
    ).toBeTruthy();
    expect(items()).toEqual([
      "On days with more than 7.0 h of sleep, your energy averages 4.1 vs 3.2 on other days.",
      "The day after any caffeine from 2 PM, your energy averages 2.9 vs 3.6 on other days.",
    ]);
    expect(screen.getByText("Clear dip · 20 days · early")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Show all 3" }));
    expect(items()).toHaveLength(3);
    expect(screen.getByText("Uncertain lift · 40 days")).toBeTruthy();

    await userEvent.click(screen.getByRole("button", { name: "Mood" }));
    expect(
      screen.getByRole("heading", { name: "What goes with your mood" }),
    ).toBeTruthy();
    expect(items()).toEqual([
      "On days you train, your mood averages 4.0 vs 3.5 on other days.",
    ]);
    expect(screen.queryByRole("button", { name: /Show all/ })).toBeNull();
    expect(screen.getByText(/not proof of cause/)).toBeTruthy();
  });

  it("says when nothing moves the outcome by much", async () => {
    mocks.data = {
      days: 90,
      checkInDays: 30,
      needed: 0,
      findings: [
        finding({ rho: 0.2, strength: "weak", highMean: 4, lowMean: 4.04 }),
        // Moderate, but within noise on 12 days.
        finding({
          factor: "kcal",
          rho: 0.45,
          n: 12,
          strength: "moderate",
          confidence: "early",
        }),
      ],
    };
    render(<DriversCard />);
    expect(
      screen.getByText("No habit moves your energy by much yet."),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Show all 2" }));
    // Averages that round to the same tenth are no lift at all.
    expect(screen.getByText("No difference · 40 days")).toBeTruthy();
    // A moderate correlation on 12 days is not called clear.
    expect(screen.getByText("Uncertain lift · 12 days · early")).toBeTruthy();
  });
});
