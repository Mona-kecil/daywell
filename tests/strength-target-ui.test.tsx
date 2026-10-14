// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { useState } from "react";
import {
  EntryEditor,
  type EntryDraft,
  type Exercise,
} from "../components/strength";

const mocks = vi.hoisted(() => ({
  results: {} as Record<string, unknown>,
  args: {} as Record<string, unknown>,
}));
vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => {
    const name = getFunctionName(ref as never);
    mocks.args[name] = args;
    return mocks.results[name];
  },
}));

const exercise = {
  _id: "e1",
  name: "Bench press",
  muscles: ["chest"],
} as unknown as Exercise;
const last = {
  workoutId: "w1",
  trainedAt: new Date(2026, 9, 12, 18).getTime(),
  sets: [
    { reps: 8, weightKg: 60 },
    { reps: 8, weightKg: 60 },
  ],
};

function Harness() {
  const [entry, setEntry] = useState<EntryDraft>({
    exercise,
    sets: [{ reps: 8, weightKg: 20 }],
    fresh: true,
  });
  return (
    <EntryEditor
      entry={entry}
      index={0}
      onChange={(sets) => setEntry((e) => ({ ...e, sets, fresh: false }))}
      onRemove={() => {}}
      onHistory={() => {}}
      onRest={() => {}}
    />
  );
}

const repsOf = () =>
  within(screen.getByRole("list", { name: "Bench press sets" }))
    .getAllByRole("listitem")
    .map((li) => li.textContent);

afterEach(() => {
  cleanup();
  mocks.results = {};
  mocks.args = {};
});

describe("Strength targets in the entry editor", () => {
  it("starts a new entry from the target, and can repeat last time instead", async () => {
    mocks.results["strength:exerciseHistory"] = { sessions: [last] };
    mocks.results["strength:nextTarget"] = {
      kind: "add_weight",
      sets: [
        { reps: 5, weightKg: 62.5 },
        { reps: 5, weightKg: 62.5 },
      ],
      range: { min: 5, max: 8 },
      reason: "You hit 8 reps on every set; add 2.5 kg.",
      basedOn: last.trainedAt,
    };
    render(<Harness />);
    expect(mocks.args["strength:nextTarget"]).toEqual({
      exerciseId: "e1",
      now: expect.any(Number),
    });
    expect(
      (mocks.args["strength:nextTarget"] as { now: number }).now % 300_000,
    ).toBe(0);
    expect(screen.getByText("Target 2 × 5 @ 62.5 kg")).toBeTruthy();
    expect(
      screen.getByText("You hit 8 reps on every set; add 2.5 kg."),
    ).toBeTruthy();
    expect(screen.getByLabelText("set 1 kilograms, exercise 1")).toHaveProperty(
      "value",
      "62.5",
    );
    expect(repsOf()).toHaveLength(2);

    await userEvent.click(screen.getByRole("button", { name: "Repeat" }));
    expect(screen.getByLabelText("set 1 kilograms, exercise 1")).toHaveProperty(
      "value",
      "60",
    );
    await userEvent.click(screen.getByRole("button", { name: "Use" }));
    expect(screen.getByLabelText("set 2 reps, exercise 1")).toHaveProperty(
      "value",
      "5",
    );
  });

  it("keeps the default draft when there is no history", () => {
    mocks.results["strength:exerciseHistory"] = { sessions: [] };
    mocks.results["strength:nextTarget"] = null;
    render(<Harness />);
    expect(screen.queryByText(/^Target/)).toBeNull();
    expect(screen.getByLabelText("set 1 kilograms, exercise 1")).toHaveProperty(
      "value",
      "20",
    );
  });
});
