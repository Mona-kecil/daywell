// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { CoachCard } from "../components/coach";
import { QuickLogButton } from "../components/quick-log";
import { FeedbackProvider } from "../components/ui";
import type { Suggestion } from "../lib/coach";

type Call = (args: Record<string, unknown>) => Promise<unknown>;
const mocks = vi.hoisted(() => ({
  data: undefined as unknown,
  fns: {} as Record<string, ReturnType<typeof vi.fn<Call>>>,
}));
const call = (name: string) =>
  (mocks.fns[name] ??= vi.fn<Call>(async () => "meal9"));
const fn = (ref: unknown) => call(getFunctionName(ref as never));
vi.mock("convex/react", () => ({
  useQuery: () => mocks.data,
  useAction: (ref: unknown) => fn(ref),
  useMutation: (ref: unknown) => fn(ref),
  useConvex: () => ({ query: (ref: unknown, args: never) => fn(ref)(args) }),
}));

HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
  this.open = false;
};

const bowl = { id: "s1", name: "Chicken rice bowl", protein: 48, kcal: 612 };
const food: Suggestion = {
  id: "today:food",
  kind: "food",
  priority: 2,
  title: "Add protein to your next meal",
  body: "70 g protein left. Your Chicken rice bowl adds 48 g (612 kcal).",
  savedMeal: bowl,
};

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
});
afterEach(() => {
  cleanup();
  mocks.fns = {};
  vi.unstubAllGlobals();
});

describe("saved meals from the coach", () => {
  it("logs the suggested saved meal in one tap, with undo", async () => {
    mocks.data = [
      food,
      { ...food, id: "today:water", kind: "water", savedMeal: undefined },
    ];
    const onTab = vi.fn();
    render(
      <FeedbackProvider>
        <CoachCard now={Date.now()} onTab={onTab} />
      </FeedbackProvider>,
    );
    // Only the suggestion that names a saved meal offers to log it.
    expect(screen.getAllByRole("button", { name: /^Log / })).toHaveLength(1);
    await userEvent.click(
      screen.getByRole("button", {
        name: "Log 1 serving of Chicken rice bowl",
      }),
    );
    expect(onTab).not.toHaveBeenCalled();
    expect(call("savedMeals:log")).toHaveBeenCalledWith({
      id: "s1",
      at: expect.any(Number),
      servings: 1,
    });
    expect(await screen.findByText("Logged Chicken rice bowl")).toBeTruthy();
    await userEvent.click(screen.getByText("Undo"));
    expect(call("meals:deleteMeal")).toHaveBeenCalledWith({ id: "meal9" });
  });

  it("proposes a saved meal from quick log in quarter servings", async () => {
    const at = new Date(2026, 9, 15, 12, 30).getTime();
    call("quickLog:parse").mockResolvedValueOnce({
      proposals: [
        {
          kind: "savedMeal",
          savedMealId: "s1",
          name: "Chicken rice bowl",
          servings: 0.25,
          at,
        },
      ],
      leftover: [],
    });
    render(
      <FeedbackProvider>
        <QuickLogButton />
      </FeedbackProvider>,
    );
    await userEvent.click(screen.getByRole("button", { name: /Tell Daywell/ }));
    await userEvent.type(
      screen.getByLabelText("What did you do?"),
      "had my chicken rice bowl",
    );
    await userEvent.click(screen.getByRole("button", { name: /Understand/ }));
    const results = await screen.findByRole("region", {
      name: "Proposed entries",
    });
    expect(within(results).getByText("Saved meal")).toBeTruthy();
    expect(within(results).getByText("Chicken rice bowl")).toBeTruthy();
    const less = within(results).getByRole("button", {
      name: "A quarter serving less of Chicken rice bowl",
    });
    expect((less as HTMLButtonElement).disabled).toBe(true);
    const more = within(results).getByRole("button", {
      name: "A quarter serving more of Chicken rice bowl",
    });
    await userEvent.click(more);
    await userEvent.click(more);
    expect(
      within(results)
        .getByRole("group", { name: "Servings of Chicken rice bowl" })
        .querySelector("output")?.textContent,
    ).toBe("¾ serving");
    await userEvent.click(
      within(results).getByRole("button", { name: "Log 1 entry" }),
    );
    expect(call("quickLog:applySavedMeal")).toHaveBeenCalledWith({
      savedMealId: "s1",
      servings: 0.75,
      at,
    });
    await userEvent.click(await screen.findByText("Undo"));
    expect(call("meals:deleteMeal")).toHaveBeenCalledWith({ id: "meal9" });
  });
});
