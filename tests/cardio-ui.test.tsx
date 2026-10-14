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
import type { Id } from "../convex/_generated/dataModel";
import {
  CardioCard,
  minutesLabel,
  sessionLine,
  weekLine,
} from "../components/cardio";

type Ref = Parameters<typeof getFunctionName>[0];
const state = vi.hoisted(() => ({
  week: undefined as unknown,
  bests: undefined as unknown,
  args: {} as Record<string, unknown>,
  calls: [] as [string, unknown][],
  fail: "",
}));
vi.mock("convex/react", () => ({
  useQuery: (ref: Ref, args: unknown) => {
    const name = getFunctionName(ref);
    state.args[name] = args;
    return name === "cardio:week" ? state.week : state.bests;
  },
  useMutation: (ref: Ref) => {
    const name = getFunctionName(ref);
    return (args: unknown) => {
      state.calls.push([name, args]);
      if (state.fail === name) return Promise.reject(new Error("Nope."));
      return Promise.resolve("new-id");
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

// Thursday.
const now = new Date(2026, 9, 15, 9, 0).getTime();
const days = [
  ["2026-10-12", 30, 30],
  ["2026-10-13", 0, 0],
  ["2026-10-14", 45, 90],
  ["2026-10-15", 20, 20],
  ["2026-10-16", 0, 0],
  ["2026-10-17", 0, 0],
  ["2026-10-18", 0, 0],
] as const;
const session = (id: string, over: Partial<Record<string, unknown>> = {}) => ({
  id: id as Id<"cardioSessions">,
  kind: "run" as const,
  effort: "moderate" as const,
  day: "2026-10-15",
  minutes: 20,
  distanceKm: 3.5 as number | null,
  note: null as string | null,
  pace: "5:43 /km" as string | null,
  activeMinutes: 20,
  kcal: 245 as number | null,
  ...over,
});
const week = {
  weekStart: "2026-10-12",
  days: days.map(([day, minutes, activeMinutes]) => ({
    day,
    minutes,
    activeMinutes,
  })),
  sessions: [
    session("s3"),
    session("s2", {
      kind: "ride",
      effort: "hard",
      day: "2026-10-14",
      minutes: 45,
      distanceKm: 18.25,
      pace: "24.3 km/h",
      activeMinutes: 90,
      kcal: null,
      note: "Hill loop",
    }),
    session("s1", {
      kind: "walk",
      day: "2026-10-12",
      minutes: 30,
      distanceKm: null,
      pace: null,
      activeMinutes: 30,
      kcal: 120,
    }),
  ],
  minutes: 95,
  activeMinutes: 140,
  goal: 150,
  lastWeekActiveMinutes: 160,
  streakWeeks: 1,
  totals: [],
};
const bests = {
  longestRunKm: 12.4,
  fastestRun: { day: "2026-10-03", distanceKm: 5, pace: "4:58 /km" },
  longestRideKm: null,
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(now);
  state.week = undefined;
  state.bests = undefined;
  state.args = {};
  state.calls = [];
  state.fail = "";
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const sheet = (name: string) => screen.getByRole("dialog", { name });
const field = (s: HTMLElement, name: RegExp) =>
  within(s).getByLabelText(name) as HTMLInputElement;

describe("cardio card", () => {
  it("waits quietly for the week of the local day", () => {
    const { container } = render(<CardioCard />);
    expect(container.innerHTML).toBe("");
    expect(state.args["cardio:week"]).toEqual({ today: "2026-10-15" });
  });

  it("shows the week against the goal, by day and by session", () => {
    state.week = week;
    state.bests = bests;
    render(<CardioCard />);
    const card = screen.getByRole("region", { name: "Cardio" });
    expect(
      within(card).getByText(
        "140 of 150 active minutes this week, 10 to go. Last week 160.",
      ),
    ).toBeTruthy();
    expect(
      within(card).getByRole("progressbar").getAttribute("aria-valuenow"),
    ).toBe("93");
    const bars = within(
      within(card).getByRole("list", { name: "Minutes each day this week" }),
    ).getAllByRole("listitem");
    expect(bars).toHaveLength(7);
    expect(bars[2].getAttribute("aria-label")).toMatch(/: 45 min$/);
    expect(bars[1].getAttribute("aria-label")).toMatch(/: none$/);
    expect(bars[3].className).toBe("today");

    const rows = within(
      within(card).getByRole("list", { name: "This week's sessions" }),
    ).getAllByRole("button");
    expect(rows.map((r) => r.textContent)).toEqual([
      "Run · 3.5 km · 20 minToday · Moderate · ~245 kcal5:43 /km",
      `Ride · 18.25 km · 45 min${new Date(2026, 9, 14).toLocaleDateString([], { weekday: "short" })} · Hard · Hill loop24.3 km/h`,
      `Walk · 30 min${new Date(2026, 9, 12).toLocaleDateString([], { weekday: "short" })} · Moderate · ~120 kcal`,
    ]);
    expect(
      within(card).getByText(
        `Longest run 12.4 km, fastest 4:58 /km over 5 km on ${new Date(2026, 9, 3).toLocaleDateString([], { month: "short", day: "numeric" })}.`,
      ),
    ).toBeTruthy();
  });

  it("logs a session with a live pace and active-minute preview", async () => {
    state.week = { ...week, sessions: [] };
    render(<CardioCard />);
    fireEvent.click(screen.getByRole("button", { name: "Log cardio" }));
    const s = sheet("Log cardio");
    expect(
      within(s)
        .getByRole("button", { name: "Run" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      within(s)
        .getByRole("button", { name: "Moderate" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    const save = within(s).getByRole("button", { name: "Log session" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    expect(field(s, /Day/).value).toBe("2026-10-15");

    fireEvent.change(field(s, /Duration/), { target: { value: "30" } });
    fireEvent.change(field(s, /Distance/), { target: { value: "5.86" } });
    expect(within(s).getByText("5:07 /km · 30 active min")).toBeTruthy();
    fireEvent.click(within(s).getByRole("button", { name: "Hard" }));
    expect(within(s).getByText("5:07 /km · 60 active min")).toBeTruthy();
    expect(within(s).getByText(/These minutes count double/)).toBeTruthy();
    fireEvent.change(field(s, /Note/), { target: { value: "Tempo" } });

    await act(async () => {
      fireEvent.click(save);
    });
    expect(state.calls).toEqual([
      [
        "cardio:add",
        {
          kind: "run",
          effort: "hard",
          day: "2026-10-15",
          minutes: 30,
          distanceKm: 5.86,
          note: "Tempo",
        },
      ],
    ]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("refuses durations, distances and days the server would reject", () => {
    state.week = { ...week, sessions: [] };
    render(<CardioCard />);
    fireEvent.click(screen.getByRole("button", { name: "Log cardio" }));
    const s = sheet("Log cardio");
    const save = within(s).getByRole("button", {
      name: "Log session",
    }) as HTMLButtonElement;
    const set = (name: RegExp, value: string) =>
      fireEvent.change(field(s, name), { target: { value } });

    set(/Duration/, "0.5");
    expect(save.disabled).toBe(true);
    set(/Duration/, "601");
    expect(save.disabled).toBe(true);
    set(/Duration/, "600");
    expect(save.disabled).toBe(false);
    set(/Distance/, "0");
    expect(save.disabled).toBe(true);
    set(/Distance/, "1000.5");
    expect(save.disabled).toBe(true);
    set(/Distance/, "");
    expect(save.disabled).toBe(false);
    set(/Day/, "2026-10-16");
    expect(save.disabled).toBe(true);
    set(/Day/, "2026-10-01");
    expect(save.disabled).toBe(false);
  });

  it("sends no distance when the field is empty and keeps the sheet on failure", async () => {
    state.week = { ...week, sessions: [] };
    state.fail = "cardio:add";
    render(<CardioCard />);
    fireEvent.click(screen.getByRole("button", { name: "Log cardio" }));
    const s = sheet("Log cardio");
    fireEvent.click(within(s).getByRole("button", { name: "Other" }));
    fireEvent.change(field(s, /Duration/), { target: { value: "25" } });
    expect(within(s).getByText("25 active min")).toBeTruthy();
    await act(async () => {
      fireEvent.click(within(s).getByRole("button", { name: "Log session" }));
    });
    expect(state.calls[0][1]).toMatchObject({
      kind: "other",
      minutes: 25,
      distanceKm: null,
    });
    expect(sheet("Log cardio")).toBeTruthy();
  });

  it("edits a session and asks twice before deleting it", async () => {
    state.week = week;
    render(<CardioCard />);
    fireEvent.click(screen.getByRole("button", { name: /^Ride/ }));
    const s = sheet("Edit session");
    expect(
      within(s)
        .getByRole("button", { name: "Ride" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(
      within(s)
        .getByRole("button", { name: "Hard" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(field(s, /Duration/).value).toBe("45");
    expect(field(s, /Distance/).value).toBe("18.25");
    expect(field(s, /Day/).value).toBe("2026-10-14");
    expect(field(s, /Note/).value).toBe("Hill loop");

    fireEvent.change(field(s, /Distance/), { target: { value: "" } });
    await act(async () => {
      fireEvent.click(within(s).getByRole("button", { name: "Save changes" }));
    });
    expect(state.calls).toEqual([
      [
        "cardio:update",
        {
          id: "s2",
          kind: "ride",
          effort: "hard",
          day: "2026-10-14",
          minutes: 45,
          distanceKm: null,
          note: "Hill loop",
        },
      ],
    ]);

    fireEvent.click(screen.getByRole("button", { name: /^Walk/ }));
    const del = within(sheet("Edit session")).getByRole("button", {
      name: "Delete session",
    });
    fireEvent.click(del);
    expect(state.calls).toHaveLength(1);
    expect(del.textContent).toBe("Tap again to delete");
    fireEvent.blur(del);
    expect(del.textContent).toBe("Delete session");
    fireEvent.click(del);
    await act(async () => {
      fireEvent.click(del);
    });
    expect(state.calls[1]).toEqual(["cardio:remove", { id: "s1" }]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("cardio copy", () => {
  it("formats durations", () => {
    expect(minutesLabel(0.4)).toBe("0 min");
    expect(minutesLabel(59.6)).toBe("1 h");
    expect(minutesLabel(75)).toBe("1 h 15 min");
    expect(minutesLabel(120)).toBe("2 h");
  });

  it("names a session without empty parts", () => {
    expect(sessionLine({ kind: "swim", minutes: 40, distanceKm: 1.5 })).toBe(
      "Swim · 1.5 km · 40 min",
    );
    expect(sessionLine({ kind: "other", minutes: 25, distanceKm: null })).toBe(
      "Other · 25 min",
    );
  });

  it("counts down to the goal and celebrates streaks", () => {
    const w = {
      activeMinutes: 0,
      goal: 150,
      streakWeeks: 0,
      lastWeekActiveMinutes: 0,
    };
    expect(weekLine(w)).toBe("0 of 150 active minutes this week, 150 to go.");
    expect(weekLine({ ...w, activeMinutes: 149.6 })).toBe(
      "149 of 150 active minutes this week, 1 to go.",
    );
    expect(weekLine({ ...w, activeMinutes: 150, streakWeeks: 3 })).toBe(
      "Weekly goal reached: 150 active minutes. 3 weeks in a row.",
    );
    expect(weekLine({ ...w, activeMinutes: 200, streakWeeks: 1 })).toBe(
      "Weekly goal reached: 200 active minutes.",
    );
  });
});
