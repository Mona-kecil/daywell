// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { getFunctionName } from "convex/server";
import {
  EntryEditor,
  type EntryDraft,
  type Exercise,
  type SetDraft,
} from "../components/strength";

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown) =>
    getFunctionName(ref as never) === "strength:exerciseHistory"
      ? { sessions: [] }
      : undefined,
}));
afterEach(cleanup);

const exercise = {
  _id: "e1",
  name: "Squat",
  muscles: [],
} as never as Exercise;
function Editor({ sets }: { sets: SetDraft[] }) {
  const [entry, setEntry] = useState<EntryDraft>({ exercise, sets });
  return (
    <EntryEditor
      entry={entry}
      index={0}
      onChange={(next) => setEntry((e) => ({ ...e, sets: next }))}
      onRemove={() => {}}
      onHistory={() => {}}
      onRest={() => {}}
    />
  );
}

describe("Warm-up sets", () => {
  it("ramps up to the heaviest planned set with plates per side", async () => {
    render(
      <Editor
        sets={[
          { reps: 5, weightKg: 95 },
          { reps: 5, weightKg: 100 },
        ]}
      />,
    );
    const toggle = screen.getByRole("button", { name: "Warm-up" });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    await userEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText(/before 100 kg × 5, not logged/)).toBeTruthy();
    expect(
      screen
        .getAllByRole("listitem")
        .filter((li) => li.closest(".warmup"))
        .map((li) => li.textContent),
    ).toEqual([
      "Bar × 10Empty bar",
      "40 kg × 510 kg a side",
      "60 kg × 320 kg a side",
      "80 kg × 225 + 5 kg a side",
    ]);
  });

  it("follows the sets as they change, and hides for light loads", async () => {
    render(<Editor sets={[{ reps: 5, weightKg: 100 }]} />);
    await userEvent.click(screen.getByRole("button", { name: "Warm-up" }));
    await userEvent.click(
      screen.getByRole("button", { name: "More set 1 kilograms, exercise 1" }),
    );
    expect(screen.getByText(/before 102.5 kg × 5/)).toBeTruthy();
    cleanup();
    render(<Editor sets={[{ reps: 10, weightKg: 25 }]} />);
    expect(screen.queryByRole("button", { name: "Warm-up" })).toBeNull();
  });
});
