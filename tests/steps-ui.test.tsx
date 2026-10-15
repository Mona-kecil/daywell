// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { StepsCard, syncLine, todayLine } from "../components/steps";

type Ref = Parameters<typeof getFunctionName>[0];
const state = vi.hoisted(() => ({
  week: undefined as unknown,
  args: undefined as unknown,
  calls: [] as [string, unknown][],
}));
vi.mock("convex/react", () => ({
  useQuery: (_ref: Ref, args: unknown) => {
    state.args = args;
    return state.week;
  },
  useMutation: (ref: Ref) => {
    const name = getFunctionName(ref);
    return (args: unknown) => {
      state.calls.push([name, args]);
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

// Thursday morning.
const now = new Date(2026, 9, 15, 9, 0).getTime();
const week = {
  goal: 8000,
  today: { day: "2026-10-15", count: 4210 },
  days: [
    { day: "2026-10-12", count: 9120 },
    { day: "2026-10-13", count: null },
    { day: "2026-10-14", count: 8000 },
    { day: "2026-10-15", count: 4210 },
    { day: "2026-10-16", count: null },
    { day: "2026-10-17", count: null },
    { day: "2026-10-18", count: null },
  ],
  weekTotal: 21330,
  daysAtGoal: 2,
  streak: 1,
  average28: 7420,
  best: { day: "2026-09-27", count: 18450 },
  lastSync: now - 25 * 60_000,
};

beforeEach(() => {
  state.week = structuredClone(week);
  state.calls = [];
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const card = () => screen.getByRole("region", { name: "Steps" });
const stat = (name: string) =>
  within(card()).getByText(name).nextElementSibling?.textContent;

describe("steps card", () => {
  it("shows today against the goal, each day and the week's stats", () => {
    render(<StepsCard now={now} />);
    expect(
      within(card()).getByText("4,210 of 8,000 today, 3,790 to go."),
    ).toBeTruthy();
    expect(
      within(card())
        .getByRole("progressbar", { name: "Steps today, of 8,000" })
        .getAttribute("aria-valuenow"),
    ).toBe("53");
    const days = within(
      within(card()).getByRole("list", { name: "Steps each day this week" }),
    );
    expect(
      days.getByRole("button", {
        name: "Monday: 9,120 steps, goal reached. Edit",
      }),
    ).toBeTruthy();
    expect(
      days.getByRole("button", { name: "Tuesday: no steps. Edit" }),
    ).toBeTruthy();
    expect(
      days.getByRole("button", {
        name: "Wednesday: 8,000 steps, goal reached. Edit",
      }),
    ).toBeTruthy();
    expect(
      days.getByRole("button", { name: "Thursday: 4,210 steps. Edit" }),
    ).toBeTruthy();
    // Days still to come can't be edited.
    expect(days.getByRole("img", { name: "Friday: no steps" })).toBeTruthy();
    expect(days.queryByRole("button", { name: /Friday/ })).toBeNull();
    expect(stat("This week")).toBe("21k");
    expect(stat("At goal")).toBe("2 of 7");
    expect(stat("Streak")).toBe("1 day");
    expect(stat("28-day avg")).toBe("7.4k");
    expect(
      within(card()).getByText(
        "Synced from Apple Health 25 min ago. Best 18,450 on Sep 27.",
      ),
    ).toBeTruthy();
    expect(state.args).toMatchObject({ now: expect.any(Number) });
  });

  it("says when the goal is reached or nothing is logged yet", () => {
    expect(todayLine({ goal: 8000, today: { day: "d", count: 8000 } })).toBe(
      "8,000 today. Goal reached.",
    );
    state.week = { ...week, today: { day: "2026-10-15", count: null } };
    render(<StepsCard now={now} />);
    expect(within(card()).getByText("No steps yet today.")).toBeTruthy();
    expect(within(card()).queryByRole("progressbar")).toBeNull();
  });

  it("explains how to start when there are no steps at all", () => {
    state.week = {
      ...week,
      today: { day: "2026-10-15", count: null },
      days: week.days.map((d) => ({ ...d, count: null })),
      weekTotal: 0,
      daysAtGoal: 0,
      streak: 0,
      average28: null,
      best: null,
      lastSync: null,
    };
    render(<StepsCard now={now} />);
    expect(within(card()).queryByText("This week")).toBeNull();
    expect(
      within(card()).getByText(/send them from Apple Health with a Shortcut/),
    ).toBeTruthy();
  });

  it("shows a capped streak as a lower bound", () => {
    state.week = { ...week, streak: 365 };
    render(<StepsCard now={now} />);
    expect(stat("Streak")).toBe("365+ days");
  });

  it("dates the last sync", () => {
    expect(syncLine(null, now)).toBeNull();
    expect(syncLine(now - 30_000, now)).toBe(
      "Synced from Apple Health just now.",
    );
    expect(syncLine(now - 59 * 60_000, now)).toBe(
      "Synced from Apple Health 59 min ago.",
    );
    expect(syncLine(new Date(2026, 9, 15, 7, 40).getTime(), now)).toMatch(
      /^Synced from Apple Health at .*7:40/,
    );
    expect(syncLine(new Date(2026, 9, 13, 21, 0).getTime(), now)).toBe(
      "Last synced from Apple Health on Oct 13.",
    );
  });

  it("edits a past day and removes it with a second tap", async () => {
    render(<StepsCard now={now} />);
    await userEvent.click(
      screen.getByRole("button", { name: /^Monday: 9,120 steps/ }),
    );
    const sheet = screen.getByRole("dialog", { name: "Steps on Monday" });
    const field = within(sheet).getByLabelText(/^Steps/);
    expect((field as HTMLInputElement).value).toBe("9120");
    expect(
      (within(sheet).getByLabelText("Day") as HTMLInputElement).value,
    ).toBe("2026-10-12");
    await userEvent.clear(field);
    await userEvent.type(field, "10250");
    await userEvent.click(
      within(sheet).getByRole("button", { name: "Save steps" }),
    );
    expect(state.calls).toEqual([
      [
        "steps:set",
        { day: "2026-10-12", count: 10250, timeZone: expect.any(String) },
      ],
    ]);

    await userEvent.click(
      screen.getByRole("button", { name: /^Monday: 9,120 steps/ }),
    );
    const again = screen.getByRole("dialog", { name: "Steps on Monday" });
    await userEvent.click(
      within(again).getByRole("button", { name: "Remove this day" }),
    );
    expect(state.calls).toHaveLength(1);
    await userEvent.click(
      within(again).getByRole("button", { name: "Tap again to remove" }),
    );
    expect(state.calls[1]).toEqual(["steps:remove", { day: "2026-10-12" }]);
  });

  it("enters today's steps and refuses impossible counts", async () => {
    state.week = { ...week, today: { day: "2026-10-15", count: null } };
    render(<StepsCard now={now} />);
    await userEvent.click(screen.getByRole("button", { name: "Enter steps" }));
    const sheet = screen.getByRole("dialog", { name: "Steps today" });
    const save = within(sheet).getByRole("button", { name: "Save steps" });
    expect(within(sheet).queryByRole("button", { name: /Remove/ })).toBeNull();
    const field = within(sheet).getByLabelText(/^Steps/);
    for (const bad of ["100001", "100000.1", "6500.5", "-1"]) {
      await userEvent.clear(field);
      await userEvent.type(field, bad);
      expect((save as HTMLButtonElement).disabled, bad).toBe(true);
    }
    await userEvent.clear(field);
    await userEvent.type(field, "6500");
    await userEvent.click(save);
    expect(state.calls).toEqual([
      [
        "steps:set",
        { day: "2026-10-15", count: 6500, timeZone: expect.any(String) },
      ],
    ]);
  });

  it("sets the daily goal and goes back to the default", async () => {
    state.week = { ...week, goal: 10000 };
    render(<StepsCard now={now} />);
    await userEvent.click(
      within(card()).getByRole("button", { name: "Goal 10,000" }),
    );
    const sheet = screen.getByRole("dialog", { name: "Daily step goal" });
    const field = within(sheet).getByLabelText(/^Daily goal/);
    await userEvent.clear(field);
    await userEvent.type(field, "999");
    const save = within(sheet).getByRole("button", { name: "Save goal" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    await userEvent.clear(field);
    await userEvent.type(field, "7250");
    await userEvent.click(save);
    expect(state.calls).toEqual([["steps:setGoal", { goal: 7250 }]]);

    await userEvent.click(
      within(card()).getByRole("button", { name: "Goal 10,000" }),
    );
    await userEvent.click(
      within(screen.getByRole("dialog", { name: "Daily step goal" })).getByRole(
        "button",
        { name: "Use the default (8,000)" },
      ),
    );
    expect(state.calls[1]).toEqual(["steps:setGoal", { goal: null }]);
  });
});
