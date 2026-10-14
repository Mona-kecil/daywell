// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LiftTrendsCard } from "../components/lift-trends";

const mocks = vi.hoisted(() => ({
  lifts: [] as unknown[],
  args: [] as unknown[],
}));
vi.mock("convex/react", () => ({
  useQuery: (_: unknown, args: unknown) => {
    mocks.args.push(args);
    return { lifts: mocks.lifts };
  },
}));
afterEach(() => {
  cleanup();
  mocks.lifts = [];
  mocks.args = [];
});

const day = 86_400_000;
const lift = (
  name: string,
  status: string,
  values: number[],
  over: Record<string, unknown> = {},
) => ({
  id: `e-${name}`,
  name,
  status,
  unit: "kg",
  points: values.map((value, i) => ({ at: i * day, value })),
  best: Math.max(...values),
  bestAt: 0,
  sessionsSinceBest: 0,
  changePct: null,
  lastAt: values.length * day,
  ...over,
});

describe("Lift trends card", () => {
  it("leads with stalled lifts and opens their history", async () => {
    mocks.lifts = [
      lift("Crunch", "stalled", [10, 10, 9, 10, 10], {
        unit: "reps",
        sessionsSinceBest: 4,
        changePct: 0,
      }),
      lift("Bench press", "slipping", [80, 76.04], {
        best: 80.04,
        changePct: -2.46,
      }),
      lift("Squat", "climbing", [100, 105, 110.26], { changePct: 3.1 }),
      lift("Row", "early", [60]),
      lift("Dips", "lapsed", [20]),
    ];
    const onOpen = vi.fn();
    render(<LiftTrendsCard now={1_000} onOpen={onOpen} />);
    // The query only changes every 5 minutes.
    expect(mocks.args[0]).toEqual({ now: 300_000 });

    expect(screen.getByText(/of 3 lifts have stalled/).textContent).toBe(
      "1 of 3 lifts have stalled",
    );
    const rows = screen.getAllByRole("button", { name: /Open history$/ });
    expect(rows.map((r) => r.getAttribute("aria-label"))).toEqual([
      "Crunch: stalled, best set 10 reps, flat. No new best in 4 sessions. A new rep range or a lighter week often restarts progress. Open history",
      "Bench press: slipping, estimated max 76 kg, −2.5% a week. 5% under your best of 80 kg. Open history",
      "Squat: climbing, estimated max 110.3 kg, +3.1% a week. Open history",
    ]);
    expect(
      screen.getByText("Too new to call (under 3 sessions): Row"),
    ).toBeTruthy();
    expect(screen.getByText("Not done in 3 weeks: Dips")).toBeTruthy();

    await userEvent.click(rows[1]);
    expect(onOpen).toHaveBeenCalledWith("e-Bench press");
  });

  it.each([
    {
      unit: "kg",
      values: [100, 97, 94.5],
      best: 99.96,
      latest: "94.5 kg",
      hint: "6% under your best of 100 kg.",
    },
    {
      unit: "kg",
      values: [100, 97, 94.5],
      best: 100,
      latest: "94.5 kg",
      hint: "6% under your best of 100 kg.",
    },
    {
      unit: "reps",
      values: [20, 19, 18],
      best: 20,
      latest: "18 reps",
      hint: "10% under your best of 20 reps.",
    },
  ])(
    "rounds the slipping percentage from displayed $unit values (best $best)",
    ({ unit, values, best, latest, hint }) => {
      mocks.lifts = [lift("Press", "slipping", values, { unit, best })];
      render(<LiftTrendsCard now={0} onOpen={() => {}} />);
      expect(screen.getByText(latest)).toBeTruthy();
      expect(screen.getByText(/under your best/).textContent).toBe(hint);
      expect(
        screen
          .getByRole("button", { name: /Open history$/ })
          .getAttribute("aria-label"),
      ).toContain(hint);
    },
  );

  it("omits the slipping percentage when the displayed best rounds to zero", () => {
    mocks.lifts = [lift("Press", "slipping", [0.04, 0.01])];
    render(<LiftTrendsCard now={0} onOpen={() => {}} />);
    expect(screen.getByText("0 kg")).toBeTruthy();
    expect(screen.queryByText(/under your best/)).toBeNull();
  });

  it("shows five lifts until asked for the rest", async () => {
    mocks.lifts = ["A", "B", "C", "D", "E", "F", "G"].map((n) =>
      lift(n, "climbing", [50, 55], { changePct: 1 }),
    );
    render(<LiftTrendsCard now={0} onOpen={() => {}} />);
    expect(screen.getByText("None of your 7 lifts have stalled")).toBeTruthy();
    const rows = () => screen.getAllByRole("button", { name: /Open history$/ });
    expect(rows()).toHaveLength(5);
    await userEvent.click(screen.getByRole("button", { name: "Show all 7" }));
    expect(rows()).toHaveLength(7);
    expect(
      screen
        .getByRole("button", { name: "Show fewer" })
        .getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("stays hidden with no lifts", () => {
    const { container } = render(<LiftTrendsCard now={0} />);
    expect(container.innerHTML).toBe("");
  });
});
