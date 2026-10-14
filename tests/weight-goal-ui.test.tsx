// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { getFunctionName } from "convex/server";
import {
  WeightChart,
  WeightGoalCard,
  goalLine,
  rateLine,
} from "../components/weight-goal";

type Ref = Parameters<typeof getFunctionName>[0];
const state = vi.hoisted(() => ({
  trend: undefined as unknown,
  args: [] as unknown[],
  calls: [] as [string, unknown][],
  fail: "",
}));
vi.mock("convex/react", () => ({
  useQuery: (_ref: Ref, args: unknown) => {
    state.args.push(args);
    return state.trend;
  },
  useMutation: (ref: Ref) => {
    const name = getFunctionName(ref);
    return (args: unknown) => {
      state.calls.push([name, args]);
      if (state.fail === name) return Promise.reject(new Error("Nope."));
      return Promise.resolve(null);
    };
  },
}));

// jsdom has no modal dialogs.
HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
  this.open = false;
  this.dispatchEvent(new Event("close"));
};

const now = new Date(2026, 9, 15, 9, 0).getTime();
const day = (m: number, d: number) =>
  new Date(2026, m - 1, d).toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
const points = [
  { day: "2026-10-12", weightKg: 81.2, trendKg: 81 },
  { day: "2026-10-13", weightKg: null, trendKg: 80.9 },
  { day: "2026-10-14", weightKg: 80.1, trendKg: 80.8 },
  { day: "2026-10-15", weightKg: 80.4, trendKg: 80.76 },
];
const full = {
  points,
  latestKg: 80.4,
  trendKg: 80.76,
  ratePerWeek: -0.43,
  goalKg: 79,
  eta: { kind: "eta", day: "2027-01-12", weeks: 12.9 },
  waist: [
    { day: "2026-09-01", waistCm: 88 },
    { day: "2026-10-14", waistCm: 85.5 },
  ],
};
const none = { kind: "none" } as const;

beforeEach(() => {
  state.trend = undefined;
  state.args = [];
  state.calls = [];
  state.fail = "";
});
afterEach(cleanup);

describe("weight trend card", () => {
  it("asks for today's window and stays out of the way while loading", () => {
    const { container } = render(<WeightGoalCard now={now} />);
    expect(container.innerHTML).toBe("");
    expect(state.args[0]).toEqual({ today: "2026-10-15" });
  });

  it("invites a first weigh-in", () => {
    state.trend = {
      points: [],
      latestKg: null,
      trendKg: null,
      ratePerWeek: null,
      goalKg: null,
      eta: none,
      waist: [],
    };
    render(<WeightGoalCard now={now} />);
    expect(
      screen.getByText("Log your weight in a check-in to see the trend."),
    ).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
    expect(screen.getByRole("button", { name: "Set a goal" })).toBeTruthy();
  });

  it("leads with the trend, its pace and the goal date", () => {
    state.trend = full;
    render(<WeightGoalCard now={now} />);
    const card = screen.getByRole("region", { name: "Weight trend" });
    expect(
      within(card).getByText("Smoothed from 3 weigh-ins in the last 120 days."),
    ).toBeTruthy();
    expect(card.querySelector(".weight-hero strong")!.textContent).toBe(
      "80.8 kg",
    );
    expect(within(card).getByText(/last 80\.4 kg/)).toBeTruthy();
    expect(within(card).getByText("−0.4 kg a week.")).toBeTruthy();
    expect(
      within(card).getByText(
        `Goal 79.0 kg around ${new Date(2027, 0, 12).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })} at this pace.`,
      ),
    ).toBeTruthy();
    expect(
      within(card).getByText(`Waist 85.5 cm, −2.5 cm since ${day(9, 1)}.`),
    ).toBeTruthy();
    expect(
      within(card).getByRole("button", { name: "Change goal" }),
    ).toBeTruthy();
  });

  it("draws weigh-ins as dots and steps through days by key", () => {
    state.trend = full;
    render(<WeightGoalCard now={now} />);
    const chart = screen.getByRole("img");
    expect(chart.getAttribute("aria-label")).toBe(
      `Weight trend from 81.0 kg on ${day(10, 12)} to 80.8 kg on ${day(10, 15)}. Goal 79.0 kg. Use arrow keys to step through days.`,
    );
    // A missed day has no dot but the trend line still crosses it.
    expect(chart.querySelectorAll(".weight-dot")).toHaveLength(3);
    expect(chart.querySelector(".weight-goal-line")).toBeTruthy();
    const readout = document.querySelector(".chart-readout")!;
    expect(readout.textContent).toBe(`−0.2 kg since ${day(10, 12)}`);

    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(readout.textContent).toBe(
      `${day(10, 12)} · 81.2 kg · trend 81.0 kg`,
    );
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(readout.textContent).toBe(
      `${day(10, 13)} · no weigh-in · trend 80.9 kg`,
    );
    fireEvent.keyDown(chart, { key: "ArrowLeft" });
    fireEvent.keyDown(chart, { key: "ArrowLeft" });
    expect(readout.textContent).toContain(day(10, 12));
    fireEvent.blur(chart);
    expect(readout.textContent).toBe(`−0.2 kg since ${day(10, 12)}`);
    fireEvent.keyDown(chart, { key: "ArrowLeft" });
    expect(readout.textContent).toContain(day(10, 15));
  });

  it("draws nothing without points", () => {
    const { container } = render(<WeightChart points={[]} goalKg={79} />);
    expect(container.innerHTML).toBe("");
  });

  it("leaves a far-off goal out of the chart", () => {
    state.trend = { ...full, goalKg: 60, eta: { kind: "far" } };
    render(<WeightGoalCard now={now} />);
    expect(document.querySelector(".weight-goal-line")).toBeNull();
    expect(
      screen.getByText("Goal 60.0 kg. More than two years at this pace."),
    ).toBeTruthy();
  });

  it("saves a goal rounded to 0.1 kg and can remove it", async () => {
    state.trend = full;
    render(<WeightGoalCard now={now} />);
    fireEvent.click(screen.getByRole("button", { name: "Change goal" }));
    const sheet = screen.getByRole("dialog", { name: "Weight goal" });
    const input = within(sheet).getByLabelText(
      /Goal weight/,
    ) as HTMLInputElement;
    expect(input.value).toBe("79");
    fireEvent.change(input, { target: { value: "76.44" } });
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Save goal" }));
    });
    expect(state.calls).toEqual([
      ["coach:setGoalWeight", { goalWeightKg: 76.4 }],
    ]);
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Change goal" }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Remove goal" }));
    });
    expect(state.calls[1]).toEqual([
      "coach:setGoalWeight",
      { goalWeightKg: null },
    ]);
  });

  it("starts a new goal from the rounded trend and keeps the sheet on failure", async () => {
    state.trend = { ...full, goalKg: null, eta: none };
    state.fail = "coach:setGoalWeight";
    render(<WeightGoalCard now={now} />);
    fireEvent.click(screen.getByRole("button", { name: "Set a goal" }));
    const sheet = screen.getByRole("dialog", { name: "Weight goal" });
    expect(
      (within(sheet).getByLabelText(/Goal weight/) as HTMLInputElement).value,
    ).toBe("81");
    expect(
      within(sheet).queryByRole("button", { name: "Remove goal" }),
    ).toBeNull();
    await act(async () => {
      fireEvent.click(within(sheet).getByRole("button", { name: "Save goal" }));
    });
    expect(state.calls).toHaveLength(1);
    expect(screen.getByRole("dialog", { name: "Weight goal" })).toBeTruthy();
  });
});

describe("weight copy", () => {
  it("rounds the weekly rate and calls tiny rates steady", () => {
    expect(rateLine(null)).toBe("Two weeks of weigh-ins show a weekly rate.");
    expect(rateLine(0.04)).toBe("Holding steady.");
    expect(rateLine(-0.04)).toBe("Holding steady.");
    expect(rateLine(0.26)).toBe("+0.3 kg a week.");
    expect(rateLine(-1.04)).toBe("−1.0 kg a week.");
  });

  it("says where the goal stands", () => {
    const g = (eta: object, ratePerWeek: number | null = 0.01) =>
      goalLine(
        { goalKg: 75, eta, ratePerWeek } as Parameters<typeof goalLine>[0],
        "2026-10-15",
      );
    expect(g({ kind: "none" })).toBeNull();
    expect(g({ kind: "reached" })).toBe("You're at your goal of 75.0 kg.");
    expect(g({ kind: "flat" })).toBe(
      "Goal 75.0 kg. No date yet while the trend is flat.",
    );
    // Too little data reads as waiting, not as flat.
    expect(g({ kind: "flat" }, null)).toBe(
      "Goal 75.0 kg. A date shows after two weeks of weigh-ins.",
    );
    expect(g({ kind: "away" })).toBe(
      "Goal 75.0 kg. The trend is moving away from it.",
    );
    // This year's dates skip the year.
    expect(g({ kind: "eta", day: "2026-12-01", weeks: 6.7 })).toBe(
      `Goal 75.0 kg around ${new Date(2026, 11, 1).toLocaleDateString([], { month: "short", day: "numeric" })} at this pace.`,
    );
  });
});
