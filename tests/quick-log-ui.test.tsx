// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { QuickLogButton } from "../components/quick-log";
import { FeedbackProvider } from "../components/ui";

type Call = (args: Record<string, unknown>) => Promise<unknown>;
const mocks = vi.hoisted(() => ({
  fns: {} as Record<string, ReturnType<typeof vi.fn<Call>>>,
}));
const fn = (ref: unknown) =>
  (mocks.fns[getFunctionName(ref as never)] ??= vi.fn<Call>(async () => null));
vi.mock("convex/react", () => ({
  useAction: (ref: unknown) => fn(ref),
  useMutation: (ref: unknown) => fn(ref),
  useConvex: () => ({ query: (ref: unknown, args: never) => fn(ref)(args) }),
}));

// jsdom has no modal dialogs.
HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
  this.open = false;
};

const at = new Date(2026, 9, 14, 7, 0).getTime();
const parsed = {
  proposals: [
    { kind: "water", amountMl: 500, at },
    {
      kind: "workout",
      muscleIds: ["m1"],
      muscles: ["back"],
      at,
      note: "",
    },
    { kind: "checkin", day: "2026-10-14", sleepHours: 7 },
  ],
  leftover: ["Unknown muscle: wings"],
};

const call = (name: string) =>
  (mocks.fns[name] ??= vi.fn<Call>(async () => null));

async function openAndParse() {
  call("quickLog:parse").mockResolvedValueOnce(parsed);
  render(
    <FeedbackProvider>
      <QuickLogButton />
    </FeedbackProvider>,
  );
  await userEvent.click(screen.getByRole("button", { name: /Tell Daywell/ }));
  await userEvent.type(
    screen.getByLabelText("What did you do?"),
    "drank 500 ml, trained back, slept 7 hours, flapped wings",
  );
  await userEvent.click(screen.getByRole("button", { name: /Understand/ }));
  return screen.findByRole("region", { name: "Proposed entries" });
}

afterEach(() => {
  cleanup();
  mocks.fns = {};
  vi.unstubAllGlobals();
});

describe("Quick log", () => {
  it("shows proposals and what it could not log", async () => {
    const results = await openAndParse();
    expect(call("quickLog:parse")).toHaveBeenCalledWith({
      text: "drank 500 ml, trained back, slept 7 hours, flapped wings",
      timeZone: expect.any(String),
    });
    expect(within(results).getByLabelText("Water amount in ml")).toHaveProperty(
      "value",
      "500",
    );
    expect(within(results).getByText("back")).toBeTruthy();
    expect(within(results).getByText("7 h sleep")).toBeTruthy();
    expect(within(results).getByText("Unknown muscle: wings")).toBeTruthy();
    expect(
      within(results).getByRole("button", { name: "Log 3 entries" }),
    ).toBeTruthy();
  });

  it("logs only the included entries, with the edited amount", async () => {
    const results = await openAndParse();
    await userEvent.click(
      within(results).getByRole("button", { name: "Include workout" }),
    );
    const amount = within(results).getByLabelText("Water amount in ml");
    await userEvent.clear(amount);
    await userEvent.type(amount, "750");
    call("tracker:addWater").mockResolvedValueOnce("w1");
    await userEvent.click(
      within(results).getByRole("button", { name: "Log 2 entries" }),
    );
    expect(call("tracker:addWater")).toHaveBeenCalledWith({
      amountMl: 750,
      at,
    });
    expect(call("tracker:addWorkout")).not.toHaveBeenCalled();
    expect(call("checkins:upsert")).toHaveBeenCalledWith({
      day: "2026-10-14",
      sleepHours: 7,
    });
    expect(await screen.findByText("Logged 2 entries")).toBeTruthy();
  });

  it("undoes everything it logged and restores the old check-in", async () => {
    const results = await openAndParse();
    call("tracker:addWater").mockResolvedValueOnce("w1");
    call("tracker:addWorkout").mockResolvedValueOnce("k1");
    call("checkins:get").mockResolvedValueOnce({ sleepHours: 6 });
    await userEvent.click(
      within(results).getByRole("button", { name: "Log 3 entries" }),
    );
    await userEvent.click(await screen.findByText("Undo"));
    expect(await screen.findByText("Undone")).toBeTruthy();
    expect(call("tracker:deleteWater")).toHaveBeenCalledWith({ id: "w1" });
    expect(call("tracker:deleteWorkout")).toHaveBeenCalledWith({ id: "k1" });
    expect(call("checkins:upsert")).toHaveBeenLastCalledWith({
      day: "2026-10-14",
      sleepHours: 6,
    });
  });

  it("keeps unsaved entries after a partial failure so a retry can't double-log", async () => {
    const results = await openAndParse();
    call("tracker:addWater").mockResolvedValueOnce("w1");
    call("tracker:addWorkout").mockRejectedValueOnce(
      new Error("Choose at least one muscle."),
    );
    await userEvent.click(
      within(results).getByRole("button", { name: "Log 3 entries" }),
    );
    expect(
      await screen.findByText("Logged 1 of 3. Choose at least one muscle."),
    ).toBeTruthy();
    expect(within(results).queryByLabelText("Water amount in ml")).toBeNull();
    expect(
      within(results).getByRole("button", { name: "Log 2 entries" }),
    ).toBeTruthy();
  });

  it("offers dictation only where the browser supports it", async () => {
    await openAndParse();
    expect(screen.queryByRole("button", { name: /Dictate/ })).toBeNull();
    cleanup();
    class FakeRecognition {
      start = vi.fn();
      stop = vi.fn();
    }
    vi.stubGlobal("webkitSpeechRecognition", FakeRecognition);
    await openAndParse();
    expect(screen.getByRole("button", { name: /Dictate/ })).toBeTruthy();
  });
});
