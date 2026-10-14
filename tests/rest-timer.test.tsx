// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { RestTimer, type Rest } from "../components/rest-timer";
import {
  EntryEditor,
  type EntryDraft,
  type Exercise,
} from "../components/strength";

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown) =>
    getFunctionName(ref as never) === "strength:exerciseHistory"
      ? { sessions: [] }
      : undefined,
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function Harness({ initial }: { initial: Rest }) {
  const [rest, setRest] = useState<Rest | null>(initial);
  return <RestTimer rest={rest} onChange={setRest} />;
}

describe("rest timer", () => {
  it("still chimes when a nearly finished rest is shortened", () => {
    vi.useFakeTimers();
    const vibrate = vi.fn();
    vi.stubGlobal("navigator", { ...navigator, vibrate });
    const now = Date.now();
    render(<Harness initial={{ endsAt: now + 5_000, total: 90_000 }} />);
    act(() => screen.getByLabelText("15 seconds less").click());
    act(() => vi.advanceTimersByTime(400));
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Go!")).toBeTruthy();
  });

  it("reads out the next set once voice is on", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "Date"] });
    const speak = vi.fn();
    vi.stubGlobal("speechSynthesis", { speak, cancel: vi.fn() });
    vi.stubGlobal(
      "SpeechSynthesisUtterance",
      class {
        constructor(public text: string) {}
      },
    );
    const now = Date.now();
    render(
      <Harness
        initial={{
          endsAt: now + 1_000,
          total: 90_000,
          next: { name: "Bench press", set: 3, reps: 5, weightKg: 82.5 },
        }}
      />,
    );
    expect(document.querySelector(".rest-next")!.textContent).toBe(
      "Next: Bench press · 5 × 82.5 kg",
    );
    const toggle = screen.getByRole("button", {
      name: "Read out the next set",
    });
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
    expect(localStorage.getItem("daywell.restVoice")).toBe("1");
    expect(speak.mock.calls.map(([u]) => u.text)).toEqual(["Voice on."]);

    act(() => vi.advanceTimersByTime(1_200));
    expect(speak.mock.calls.at(-1)![0].text).toBe(
      "Rest over. Bench press, set 3: 5 reps at 82.5 kilos.",
    );
    expect(document.querySelector("[aria-live]")!.textContent).toBe(
      "Rest over. Bench press, set 3: 5 reps at 82.5 kilos.",
    );
  });

  it("stays silent and hides the toggle without speech support", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "Date"] });
    localStorage.setItem("daywell.restVoice", "1");
    render(<Harness initial={{ endsAt: Date.now() + 500, total: 90_000 }} />);
    expect(
      screen.queryByRole("button", { name: "Read out the next set" }),
    ).toBeNull();
    act(() => vi.advanceTimersByTime(600));
    expect(document.querySelector("[aria-live]")!.textContent).toBe(
      "Rest over. Next set.",
    );
  });
});

describe("next set after a rest", () => {
  const exercise = {
    _id: "e1",
    name: "Squat",
    muscles: [],
  } as never as Exercise;
  function Editor({ onRest }: { onRest: (n: unknown) => void }) {
    const [entry, setEntry] = useState<EntryDraft>({
      exercise,
      sets: [
        { reps: 5, weightKg: 100 },
        { reps: 5, weightKg: 100, done: true },
        { reps: 3, weightKg: 105 },
      ],
    });
    return (
      <EntryEditor
        entry={entry}
        index={0}
        onChange={(sets) => setEntry((e) => ({ ...e, sets }))}
        onRemove={() => {}}
        onHistory={() => {}}
        onRest={onRest}
      />
    );
  }

  it("names the next open set, skipping finished ones", async () => {
    const onRest = vi.fn();
    render(<Editor onRest={onRest} />);
    await userEvent.click(screen.getByRole("button", { name: "Set 1 done" }));
    expect(onRest).toHaveBeenLastCalledWith({
      name: "Squat",
      set: 3,
      reps: 3,
      weightKg: 105,
    });
    // Unticking a set starts no rest.
    await userEvent.click(screen.getByRole("button", { name: "Set 1 done" }));
    expect(onRest).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "Set 1 done" }));
    // The last open set hands over to whatever comes next.
    await userEvent.click(screen.getByRole("button", { name: "Set 3 done" }));
    expect(onRest).toHaveBeenLastCalledWith(null);
  });
});
