// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WeekPlanCard } from "../components/week-plan";
import type { Id } from "../convex/_generated/dataModel";
import type { PlanDay, WeekPlan } from "../lib/week-plan";

const mocks = vi.hoisted(() => ({ data: undefined as unknown }));
vi.mock("convex/react", () => ({ useQuery: () => mocks.data }));

// Wednesday 2 PM local.
const NOW = new Date(2026, 9, 14, 14).getTime();
const at = (date: number) => new Date(2026, 9, date, 18).getTime();
const key = (date: number) => `2026-10-${date}`;
const muscle = (name: string) => ({
  _id: name as Id<"muscles">,
  name,
});
const muscles = ["chest", "shoulders", "triceps", "back", "abs", "calves"].map(
  muscle,
);
const session = (
  date: number,
  split: PlanDay["split"],
  names: string[],
): PlanDay => ({
  day: key(date),
  at: at(date),
  split,
  muscles: names.map((name) => ({ id: name, name })),
  rest: null,
});
const rest = (date: number, why: PlanDay["rest"]): PlanDay => ({
  day: key(date),
  at: at(date),
  split: null,
  muscles: [],
  rest: why,
});
const plan = (
  days: PlanDay[],
  projected: Record<string, number>,
): WeekPlan => ({
  days,
  projected,
  onTarget: Object.values(projected).filter((n) => n >= 10).length,
  total: Object.keys(projected).length,
});
const rows = () =>
  within(screen.getByRole("list"))
    .getAllByRole("listitem")
    .map((li) => li.textContent);

afterEach(() => {
  cleanup();
  mocks.data = undefined;
});

describe("Rest of the week", () => {
  it("lists each remaining day with its split or why it rests", () => {
    mocks.data = plan(
      [
        session(14, "push", ["chest", "shoulders", "triceps", "abs"]),
        session(15, "pull", ["back"]),
        rest(16, "recovering"),
        session(17, "push", ["chest", "shoulders", "triceps"]),
        rest(18, "on-target"),
      ],
      { chest: 11, shoulders: 12, triceps: 10, back: 10, abs: 8, calves: 3 },
    );
    render(<WeekPlanCard muscles={muscles} now={NOW} onStart={vi.fn()} />);
    expect(screen.getByText(/by Sunday with this plan/).textContent).toBe(
      "4 of 6 muscles reach 10 sets by Sunday with this plan",
    );
    const six = new Date(at(14)).toLocaleTimeString([], {
      hour: "numeric",
      minute: "2-digit",
    });
    expect(rows()).toEqual([
      `Today${six}Pushchest, shoulders, triceps, absSelect`,
      `Tomorrow${six}Pullback`,
      "FridayRestNothing that needs sets is off cooldown",
      `Saturday${six}Pushchest, shoulders, triceps`,
      "SundayRestEvery muscle is at 10+ sets",
    ]);
    expect(screen.getByText(/Still under 10 by Sunday/).textContent).toBe(
      "Still under 10 by Sunday: abs 8, calves 3",
    );
  });

  it("selects today's split for the log form", async () => {
    mocks.data = plan([session(14, "legs", ["calves"])], { calves: 4 });
    const onStart = vi.fn();
    render(<WeekPlanCard muscles={muscles} now={NOW} onStart={onStart} />);
    await userEvent.click(
      screen.getByRole("button", {
        name: "Select legs muscles for today's workout",
      }),
    );
    expect(onStart).toHaveBeenCalledWith(["calves"], "Legs");
  });

  it("offers Select only for today", () => {
    mocks.data = plan([session(15, "pull", ["back"])], { back: 4 });
    render(<WeekPlanCard muscles={muscles} now={NOW} onStart={vi.fn()} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("says when the week is done", () => {
    mocks.data = plan([], { back: 12 });
    render(<WeekPlanCard muscles={muscles} now={NOW} onStart={vi.fn()} />);
    expect(screen.getByText(/A new plan starts Monday/)).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("renders nothing while loading or without muscles", () => {
    const { container, rerender } = render(
      <WeekPlanCard muscles={muscles} now={NOW} onStart={vi.fn()} />,
    );
    expect(container.innerHTML).toBe("");
    mocks.data = plan([], {});
    rerender(<WeekPlanCard muscles={[]} now={NOW} onStart={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });
});
