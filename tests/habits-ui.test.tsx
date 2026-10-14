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
import { HabitsCard, streakLabel } from "../components/habits";

type Call = [string, unknown];
const state = vi.hoisted(() => ({
  habits: undefined as unknown,
  calls: [] as [string, unknown][],
  updater: null as null | ((store: unknown, args: unknown) => void),
}));
vi.mock("convex/react", () => ({
  useQuery: () => state.habits,
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
  state.calls = [];
  state.updater = null;
});
afterEach(cleanup);

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

    const done = screen.getByRole("button", { name: /Vitamins/ });
    expect(done.ariaPressed).toBe("true");
    expect(done.textContent).toContain("4 days in a row · best 9");
    expect(done.querySelector(".habit-streak svg")).toBeTruthy();
    expect(
      screen.getByRole("img", { name: "Done 6 of the last 7 days" }),
    ).toBeTruthy();

    const todo = screen.getByRole("button", { name: /Read/ });
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
      getQuery: (_: unknown, args: unknown) => {
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
