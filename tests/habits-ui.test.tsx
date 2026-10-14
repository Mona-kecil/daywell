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
import { HabitsCard, heatWeeks, streakLabel } from "../components/habits";

type Call = [string, unknown];
type Ref = Parameters<typeof getFunctionName>[0];
const state = vi.hoisted(() => ({
  habits: undefined as unknown,
  history: undefined as unknown,
  calls: [] as [string, unknown][],
  updater: null as null | ((store: unknown, args: unknown) => void),
}));
vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref) === "habits:history" ? state.history : state.habits,
  useMutation: (ref: Parameters<typeof getFunctionName>[0]) => {
    const name = getFunctionName(ref);
    const fn = (args: unknown) => {
      state.calls.push([name, args]);
      return Promise.resolve(null);
    };
    fn.withOptimisticUpdate = (u: typeof state.updater) => {
      state.updater = u;
      return fn;
    };
    return fn;
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
const habit = (id: string, fields: object = {}) => ({
  id,
  name: id,
  icon: "check",
  doneToday: false,
  streak: 0,
  best: 0,
  last7: [false, false, false, false, false, false, false],
  ...fields,
});
const vitamins = habit("Vitamins", {
  icon: "pill",
  doneToday: true,
  streak: 4,
  best: 9,
  last7: [true, false, true, true, true, true, true],
});
const read = habit("Read", { icon: "book", streak: 2, best: 2 });

beforeEach(() => {
  state.habits = undefined;
  state.history = undefined;
  state.calls = [];
  state.updater = null;
});
afterEach(cleanup);

const dayText = (y: number, m: number, d: number) =>
  new Date(y, m, d).toLocaleDateString([], {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
const flush = () => act(() => Promise.resolve());
const calls = (name: string) =>
  state.calls.filter(([n]: Call) => n === name).map(([, a]) => a);

describe("habits card", () => {
  it("stays hidden while loading and invites a first habit", async () => {
    const { container, rerender } = render(<HabitsCard now={now} />);
    expect(container.innerHTML).toBe("");

    state.habits = [];
    rerender(<HabitsCard now={now} />);
    expect(
      screen.getByText("A few small things you want to do every day."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add a habit" }));
    const sheet = screen.getByRole("dialog", { name: "Edit habits" });
    const add = within(sheet).getByRole("button", { name: "Add habit" });
    expect((add as HTMLButtonElement).disabled).toBe(true);

    const input = within(sheet).getByLabelText("Habit name");
    fireEvent.change(input, { target: { value: "  Read  " } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Book" }));
    expect(
      within(sheet).getByRole("button", { name: "Book" }).ariaPressed,
    ).toBe("true");
    fireEvent.click(add);
    await flush();
    expect(calls("habits:create")).toEqual([{ name: "Read", icon: "book" }]);
    expect((input as HTMLInputElement).value).toBe("");
  });

  it("lists habits with streaks and the week, and ticks today off", () => {
    state.habits = [vitamins, read];
    render(<HabitsCard now={now} />);
    expect(screen.getByText("1 of 2 done today.")).toBeTruthy();

    const done = screen.getByRole("button", { name: /^Vitamins(?!:)/ });
    expect(done.ariaPressed).toBe("true");
    expect(done.textContent).toContain("4 days in a row · best 9");
    expect(done.querySelector(".habit-streak svg")).toBeTruthy();
    expect(
      screen.getByRole("button", {
        name: "Vitamins: done 6 of the last 7 days. Change past days",
      }),
    ).toBeTruthy();

    const todo = screen.getByRole("button", { name: /^Read(?!:)/ });
    expect(todo.ariaPressed).toBe("false");
    // Two in a row is not worth a flame yet.
    expect(todo.querySelector(".habit-streak svg")).toBeNull();
    fireEvent.click(todo);
    expect(calls("habits:toggle")).toEqual([{ id: "Read", day: "2026-10-15" }]);
  });

  it("updates the streak and week straight away", () => {
    state.habits = [read];
    render(<HabitsCard now={now} />);
    let list = [vitamins, read];
    const store = {
      getQuery: (ref: Ref, args: unknown) => {
        if (getFunctionName(ref) === "habits:history") return undefined;
        expect(args).toEqual({ today: "2026-10-15" });
        return list;
      },
      setQuery: (_: unknown, __: unknown, next: typeof list) => {
        list = next;
      },
    };
    state.updater!(store, { id: "Read", day: "2026-10-15" });
    expect(list[1]).toMatchObject({
      doneToday: true,
      streak: 3,
      best: 3,
      last7: [false, false, false, false, false, false, true],
    });
    state.updater!(store, { id: "Vitamins", day: "2026-10-15" });
    expect(list[0]).toMatchObject({ doneToday: false, streak: 3, best: 9 });
    expect(list[0].last7.at(-1)).toBe(false);
    expect(list[1].doneToday).toBe(true);
  });

  it("ticks off a missed day from the week", () => {
    state.habits = [vitamins, read];
    render(<HabitsCard now={now} />);
    fireEvent.click(
      screen.getByRole("button", { name: /^Vitamins: done 6 of the last 7/ }),
    );
    const sheet = screen.getByRole("dialog", { name: "Vitamins" });
    expect(
      within(sheet).getByText(
        "4 days in a row · best 9. Tap a day you did it but forgot to tick.",
      ),
    ).toBeTruthy();
    // Newest first, with the one missed day (Saturday the 10th) open.
    const rows = within(sheet)
      .getAllByRole("button")
      .filter((b) => b.hasAttribute("aria-pressed"));
    expect(rows.map((b) => [b.textContent, b.ariaPressed])).toEqual([
      ["Today", "true"],
      ["Yesterday", "true"],
      [dayText(2026, 9, 13), "true"],
      [dayText(2026, 9, 12), "true"],
      [dayText(2026, 9, 11), "true"],
      [dayText(2026, 9, 10), "false"],
      [dayText(2026, 9, 9), "true"],
    ]);
    fireEvent.click(rows[5]);
    expect(calls("habits:toggle")).toEqual([
      { id: "Vitamins", day: "2026-10-10" },
    ]);
  });

  it("fills a past day without guessing the streak", () => {
    state.habits = [read];
    render(<HabitsCard now={now} />);
    let list = [vitamins, read];
    const store = {
      getQuery: (ref: Ref, args: unknown) => {
        if (getFunctionName(ref) === "habits:history") return undefined;
        // The card's own query, whichever day is ticked.
        expect(args).toEqual({ today: "2026-10-15" });
        return list;
      },
      setQuery: (_: unknown, __: unknown, next: typeof list) => {
        list = next;
      },
    };
    state.updater!(store, { id: "Vitamins", day: "2026-10-10" });
    expect(list[0]).toMatchObject({
      doneToday: true,
      streak: 4,
      best: 9,
      last7: [true, true, true, true, true, true, true],
    });
    state.updater!(store, { id: "Read", day: "2026-10-14" });
    expect(list[1]).toMatchObject({
      doneToday: false,
      streak: 2,
      last7: [false, false, false, false, false, true, false],
    });
    // Older than the week shown: left to the server.
    const before = list;
    state.updater!(store, { id: "Read", day: "2026-10-01" });
    expect(list).toBe(before);
  });

  it("shows the last 12 weeks under the days", () => {
    state.habits = [vitamins];
    render(<HabitsCard now={now} />);
    fireEvent.click(screen.getByRole("button", { name: /^Vitamins: done/ }));
    const sheet = screen.getByRole("dialog", { name: "Vitamins" });
    expect(within(sheet).getByText("Loading…")).toBeTruthy();
    expect(
      within(sheet).getByRole("img", { name: "Loading the last 12 weeks" }),
    ).toBeTruthy();
    cleanup();

    state.history = { days: ["2026-07-24", "2026-09-01", "2026-10-15"] };
    render(<HabitsCard now={now} />);
    fireEvent.click(screen.getByRole("button", { name: /^Vitamins: done/ }));
    const grid = within(
      screen.getByRole("dialog", { name: "Vitamins" }),
    ).getByRole("img", { name: "Done 3 of the last 84 days" });
    expect(screen.getByText("3 of 84 days")).toBeTruthy();
    expect(grid.querySelectorAll("i")).toHaveLength(13 * 7);
    expect(grid.querySelectorAll("i.on")).toHaveLength(3);
    expect(grid.querySelectorAll("i.off")).toHaveLength(13 * 7 - 84);
    // July would crowd August, which starts in the second column.
    expect(
      [...grid.querySelectorAll(".habit-heat-month")]
        .map((m) => m.textContent)
        .filter(Boolean),
    ).toEqual(["Aug", "Sep", "Oct"]);
  });

  it("ticks the 12 weeks along with the day", () => {
    state.habits = [read];
    render(<HabitsCard now={now} />);
    let history = { days: ["2026-10-01", "2026-10-14"] };
    const store = {
      getQuery: (ref: Ref, args: unknown) => {
        if (getFunctionName(ref) !== "habits:history") return [read];
        expect(args).toEqual({ id: "Read", today: "2026-10-15" });
        return history;
      },
      setQuery: (ref: Ref, _: unknown, next: unknown) => {
        if (getFunctionName(ref) === "habits:history")
          history = next as typeof history;
      },
    };
    state.updater!(store, { id: "Read", day: "2026-10-10" });
    expect(history.days).toEqual(["2026-10-01", "2026-10-10", "2026-10-14"]);
    state.updater!(store, { id: "Read", day: "2026-10-14" });
    expect(history.days).toEqual(["2026-10-01", "2026-10-10"]);
  });

  it("celebrates finishing the day, not loading a finished one", () => {
    state.habits = [vitamins, { ...read, doneToday: true }];
    const { container, unmount } = render(<HabitsCard now={now} />);
    expect(screen.getByText("All 2 done today.")).toBeTruthy();
    expect(container.querySelector(".burst")).toBeNull();
    unmount();

    state.habits = [vitamins, read];
    const view = render(<HabitsCard now={now} />);
    expect(view.container.querySelector(".burst")).toBeNull();
    state.habits = [vitamins, { ...read, doneToday: true }];
    view.rerender(<HabitsCard now={now} />);
    expect(view.container.querySelector(".burst")).toBeTruthy();
  });

  it("reorders, edits and archives in the sheet", async () => {
    state.habits = [vitamins, read];
    render(<HabitsCard now={now} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const sheet = screen.getByRole("dialog", { name: "Edit habits" });

    const up = within(sheet).getByRole("button", { name: "Move Vitamins up" });
    expect((up as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(
      within(sheet).getByRole("button", { name: "Move Vitamins down" }),
    );
    await flush();
    expect(calls("habits:move")).toEqual([
      { id: "Vitamins", direction: "down" },
    ]);

    fireEvent.click(within(sheet).getByRole("button", { name: "Edit Read" }));
    expect(
      within(sheet).getByRole("heading", { name: "Edit Read" }),
    ).toBeTruthy();
    const input = within(sheet).getByLabelText(
      "Habit name",
    ) as HTMLInputElement;
    expect(input.value).toBe("Read");
    expect(
      within(sheet).getByRole("button", { name: "Book" }).ariaPressed,
    ).toBe("true");
    fireEvent.change(input, { target: { value: "Read 20 pages" } });
    fireEvent.click(within(sheet).getByRole("button", { name: "Moon" }));
    fireEvent.click(within(sheet).getByRole("button", { name: "Save" }));
    await flush();
    expect(calls("habits:update")).toEqual([
      { id: "Read", name: "Read 20 pages", icon: "moon" },
    ]);
    // Saving goes back to adding a new one.
    expect(
      within(sheet).getByRole("heading", { name: "New habit" }),
    ).toBeTruthy();

    fireEvent.click(
      within(sheet).getByRole("button", { name: "Edit Vitamins" }),
    );
    const archive = within(sheet).getByRole("button", { name: "Archive" });
    fireEvent.click(archive);
    expect(calls("habits:archive")).toEqual([]);
    expect(archive.textContent).toBe("Tap again to archive");
    fireEvent.click(archive);
    await flush();
    expect(calls("habits:archive")).toEqual([{ id: "Vitamins" }]);
  });

  it("stops offering new habits at the limit", () => {
    state.habits = Array.from({ length: 12 }, (_, i) => habit(`H${i}`));
    render(<HabitsCard now={now} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    const sheet = screen.getByRole("dialog", { name: "Edit habits" });
    expect(within(sheet).queryByLabelText("Habit name")).toBeNull();
    expect(within(sheet).getByText(/You have 12 habits/)).toBeTruthy();
    // Editing an existing one still works.
    fireEvent.click(within(sheet).getByRole("button", { name: "Edit H3" }));
    expect(within(sheet).getByLabelText("Habit name")).toBeTruthy();
  });
});

describe("streak label", () => {
  it("says how the run is going", () => {
    expect(streakLabel({ streak: 0, best: 0, doneToday: false })).toBe(
      "Not started",
    );
    expect(streakLabel({ streak: 0, best: 5, doneToday: false })).toBe(
      "Best run 5 days",
    );
    expect(streakLabel({ streak: 1, best: 1, doneToday: true })).toBe(
      "1 day in a row",
    );
    expect(streakLabel({ streak: 4, best: 9, doneToday: true })).toBe(
      "4 days in a row · best 9",
    );
  });
});

describe("12-week grid", () => {
  it("covers exactly 84 days in Monday-first weeks", () => {
    // Thursday: a partial first and last week, so 13 columns.
    const weeks = heatWeeks("2026-10-15", ["2026-07-24", "2026-07-23"]);
    expect(weeks).toHaveLength(13);
    expect(weeks.flat().filter(Boolean)).toHaveLength(84);
    expect(weeks[0].map((c) => c?.day ?? null)).toEqual([
      null,
      null,
      null,
      null,
      "2026-07-24",
      "2026-07-25",
      "2026-07-26",
    ]);
    expect(weeks[0][4]?.on).toBe(true);
    expect(weeks.at(-1)!.map((c) => c?.day ?? null)).toEqual([
      "2026-10-12",
      "2026-10-13",
      "2026-10-14",
      "2026-10-15",
      null,
      null,
      null,
    ]);
    // Sunday: twelve whole weeks.
    const sunday = heatWeeks("2026-10-18", []);
    expect(sunday).toHaveLength(12);
    expect(sunday.flat().every(Boolean)).toBe(true);
    expect(sunday[0][0]?.day).toBe("2026-07-27");
  });
});
