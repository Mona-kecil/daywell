// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { MuscleSheet } from "../components/muscle-sheet";
import { FeedbackProvider } from "../components/ui";
import type { Id } from "../convex/_generated/dataModel";

const mocks = vi.hoisted(() => ({
  calls: [] as [string, unknown][],
}));
vi.mock("convex/react", () => ({
  useQuery: () => undefined,
  useMutation: (ref: unknown) => async (args: unknown) => {
    mocks.calls.push([getFunctionName(ref as never), args]);
    return null;
  },
}));

// jsdom has no modal dialogs.
HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
  this.open = false;
};

const now = new Date(2026, 9, 14, 9).getTime();
const hour = 3_600_000;
const muscle = (over: {
  lastTrainedAt?: number | null;
  soreUntil?: number | null;
}) => ({
  _id: "m-chest" as Id<"muscles">,
  _creationTime: 0,
  userId: "u",
  name: "chest",
  cooldownHours: 48,
  lastTrainedAt: now - 10 * hour,
  soreUntil: null,
  ...over,
});
const sheet = (m: ReturnType<typeof muscle>) =>
  render(
    <FeedbackProvider>
      <MuscleSheet
        muscle={m}
        now={now}
        exercises={[]}
        onClose={() => {}}
        onExercise={() => {}}
      />
    </FeedbackProvider>,
  );

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
});
afterEach(() => {
  cleanup();
  mocks.calls = [];
  vi.unstubAllGlobals();
});

describe("Soreness in the muscle sheet", () => {
  it("reports a recovering muscle as still sore", async () => {
    sheet(muscle({}));
    expect(screen.getByText("Ready in 38h 0m")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Not sore anymore" }),
    ).toBeNull();
    expect(
      screen.getByText(
        "Each tap adds 12 hours of rest, up to 3 days from now.",
      ),
    ).toBeTruthy();
    await userEvent.click(screen.getByRole("button", { name: "Still sore" }));
    expect(mocks.calls).toHaveLength(1);
    expect(mocks.calls[0][0]).toBe("tracker:reportSore");
    expect(mocks.calls[0][1]).toMatchObject({ muscleId: "m-chest" });
    expect(await screen.findByText("Chest rests 12 hours longer")).toBeTruthy();
  });

  it("shows when soreness ends and clears it", async () => {
    const soreUntil = now + 50 * hour;
    sheet(muscle({ soreUntil }));
    expect(screen.getByText("Sore · ready in 50h 0m")).toBeTruthy();
    // The sore end, not the cooldown end, is when the muscle is ready.
    const when = new Date(soreUntil).toLocaleString([], {
      weekday: "short",
      hour: "numeric",
      minute: "2-digit",
    });
    expect(
      screen.getByText("Marked sore, so it rests past its 48h cooldown."),
    ).toBeTruthy();
    expect(screen.getByText(new RegExp(`ready ${when}$`))).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: "Not sore anymore" }),
    );
    expect(mocks.calls).toEqual([
      ["tracker:clearSore", { muscleId: "m-chest" }],
    ]);
  });

  it("offers Feeling sore on a rested muscle", () => {
    sheet(muscle({ lastTrainedAt: now - 72 * hour }));
    expect(screen.getByRole("button", { name: "Feeling sore" })).toBeTruthy();
    // A soreness that has run out no longer shows.
    cleanup();
    sheet(muscle({ lastTrainedAt: now - 72 * hour, soreUntil: now - hour }));
    expect(screen.queryByText(/Marked sore/)).toBeNull();
    expect(screen.getByRole("button", { name: "Feeling sore" })).toBeTruthy();
  });
});
