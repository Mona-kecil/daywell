// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { Train } from "../components/train";
import { SaveRoutineSheet, type Routine } from "../components/routines";
import type { Exercise } from "../components/strength";
import { FeedbackProvider } from "../components/ui";

const mocks = vi.hoisted(() => ({
  results: {} as Record<string, unknown>,
  calls: [] as [string, unknown][],
  returns: {} as Record<string, unknown>,
}));
vi.mock("convex/react", () => ({
  useQuery: (ref: unknown) => mocks.results[getFunctionName(ref as never)],
  useMutation: (ref: unknown) => {
    const name = getFunctionName(ref as never);
    return async (args: unknown) => {
      mocks.calls.push([name, args]);
      return mocks.returns[name] ?? null;
    };
  },
  usePaginatedQuery: () => ({
    results: [],
    status: "Exhausted",
    loadMore: () => {},
  }),
}));
vi.mock("../components/body3d", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../components/body3d")>()),
  BodyModel: () => <div aria-hidden />,
}));

// jsdom has no modal dialogs.
HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
  this.open = false;
};

const now = new Date(2026, 9, 14, 9).getTime();
const muscles = ["chest", "triceps", "back"].map((name) => ({
  _id: `m-${name}`,
  name,
  lastTrainedAt: null,
  cooldownHours: 48,
}));
const ex = (name: string, muscles: string[]) =>
  ({ _id: `e-${name}`, name, muscles, custom: false }) as unknown as Exercise;
const bench = ex("Bench press", ["chest", "triceps"]);
const dips = ex("Dips", ["triceps", "chest"]);
const row = ex("Barbell row", ["back"]);
const push = {
  _id: "r-push",
  name: "Push",
  lastUsedAt: null,
  exercises: [bench, dips],
} as unknown as Routine;
const pull = {
  _id: "r-pull",
  name: "Pull",
  lastUsedAt: null,
  exercises: [],
} as unknown as Routine;
const calls = (name: string) =>
  mocks.calls.filter(([n]) => n === name).map(([, args]) => args);

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  mocks.results["strength:exercises"] = [bench, dips, row];
  mocks.results["routines:list"] = [push, pull];
});
afterEach(() => {
  cleanup();
  mocks.results = {};
  mocks.calls = [];
  mocks.returns = {};
  vi.unstubAllGlobals();
});

const renderTrain = () =>
  render(
    <FeedbackProvider>
      <Train muscles={muscles as never} now={now} />
    </FeedbackProvider>,
  );
const entryNames = () =>
  screen
    .queryAllByRole("list", { name: / sets$/ })
    .map((l) => l.getAttribute("aria-label")!.replace(/ sets$/, ""));

describe("Routines in Train", () => {
  it("starts a routine, then marks it used when the workout is saved", async () => {
    renderTrain();
    const chips = within(
      screen.getByRole("group", { name: "Start a routine" }),
    );
    expect(
      (chips.getByRole("button", { name: /Pull/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    await userEvent.click(chips.getByRole("button", { name: /Push/ }));
    expect(entryNames()).toEqual(["Bench press", "Dips"]);
    expect(
      chips.getByRole("button", { name: /Push/ }).getAttribute("aria-pressed"),
    ).toBe("true");
    expect(await screen.findByText("Started Push · 2 exercises")).toBeTruthy();
    await userEvent.click(chips.getByRole("button", { name: /Push/ }));
    expect(entryNames()).toEqual(["Bench press", "Dips"]);
    expect(
      await screen.findByText("Push is already in this workout"),
    ).toBeTruthy();
    // Unchanged from the routine, so there is nothing to save.
    expect(
      screen.queryByRole("button", { name: /Save.*routine|Save changes/ }),
    ).toBeNull();

    await userEvent.click(
      screen.getByRole("button", { name: /^Save workout/ }),
    );
    expect(calls("strength:logSession")).toHaveLength(1);
    expect(calls("routines:markUsed")).toEqual([{ id: "r-push" }]);
    expect(entryNames()).toEqual([]);
  });

  it("saves a changed routine without saving the workout", async () => {
    mocks.returns["routines:create"] = "r-new";
    renderTrain();
    await userEvent.click(
      within(screen.getByRole("group", { name: "Start a routine" })).getByRole(
        "button",
        { name: /Push/ },
      ),
    );
    await userEvent.click(screen.getByRole("button", { name: "Remove Dips" }));
    await userEvent.click(
      screen.getByRole("button", { name: "Save changes to Push" }),
    );
    await userEvent.type(
      screen.getByLabelText("Or save as a new routine"),
      "Bench only",
    );
    await userEvent.click(screen.getByRole("button", { name: "Save routine" }));
    expect(calls("routines:create")).toEqual([
      { name: "Bench only", exerciseIds: ["e-Bench press"] },
    ]);
    expect(calls("strength:logSession")).toEqual([]);
    expect(entryNames()).toEqual(["Bench press"]);
    // The save button is gone, so focus lands on Add exercise.
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Add exercise" }),
    );
  });

  it("renames and deletes routines, with undo only when it can be recreated", async () => {
    mocks.returns["routines:remove"] = {
      name: "Push",
      exerciseIds: ["e-Bench press", "e-Dips"],
    };
    renderTrain();
    await userEvent.click(
      screen.getByRole("button", { name: "Manage routines" }),
    );
    const name = screen.getByLabelText("Name of Push");
    await userEvent.clear(name);
    await userEvent.type(name, "Push A");
    await userEvent.click(screen.getByRole("button", { name: "Rename Push" }));
    expect(calls("routines:rename")).toEqual([
      { id: "r-push", name: "Push A" },
    ]);
    expect(calls("tracker:addWorkout")).toEqual([]);

    await userEvent.click(screen.getByRole("button", { name: "Delete Push" }));
    expect(await screen.findByText("Deleted Push")).toBeTruthy();
    await userEvent.click(screen.getByText("Undo"));
    expect(calls("routines:create")).toEqual([
      { name: "Push", exerciseIds: ["e-Bench press", "e-Dips"] },
    ]);

    await userEvent.click(screen.getByRole("button", { name: "Delete Pull" }));
    expect(await screen.findByText("Deleted Pull")).toBeTruthy();
    expect(screen.queryByText("Undo")).toBeNull();
  });
});

describe("Saving a routine", () => {
  it("saves the current exercises under a suggested name, with undo", async () => {
    const onSaved = vi.fn();
    mocks.returns["routines:create"] = "r-new";
    render(
      <FeedbackProvider>
        <SaveRoutineSheet
          open
          onClose={() => {}}
          exercises={[bench, dips]}
          active={null}
          onSaved={onSaved}
        />
      </FeedbackProvider>,
    );
    expect(screen.getByLabelText("Routine name")).toHaveProperty(
      "value",
      "Chest & triceps",
    );
    await userEvent.click(screen.getByRole("button", { name: "Save routine" }));
    expect(calls("routines:create")).toEqual([
      { name: "Chest & triceps", exerciseIds: ["e-Bench press", "e-Dips"] },
    ]);
    expect(onSaved).toHaveBeenCalledWith("r-new");
    await userEvent.click(await screen.findByText("Undo"));
    expect(calls("routines:remove")).toEqual([{ id: "r-new" }]);
  });

  it("updates the started routine and can undo back to its old list", async () => {
    const onSaved = vi.fn();
    render(
      <FeedbackProvider>
        <SaveRoutineSheet
          open
          onClose={() => {}}
          exercises={[dips, bench, row]}
          active={push}
          onSaved={onSaved}
        />
      </FeedbackProvider>,
    );
    expect(screen.getByLabelText("Or save as a new routine")).toHaveProperty(
      "value",
      "",
    );
    await userEvent.click(screen.getByRole("button", { name: "Update Push" }));
    expect(calls("routines:update")).toEqual([
      {
        id: "r-push",
        exerciseIds: ["e-Dips", "e-Bench press", "e-Barbell row"],
      },
    ]);
    expect(onSaved).toHaveBeenCalledWith("r-push");
    await userEvent.click(await screen.findByText("Undo"));
    expect(calls("routines:update")[1]).toEqual({
      id: "r-push",
      exerciseIds: ["e-Bench press", "e-Dips"],
    });
  });
});
