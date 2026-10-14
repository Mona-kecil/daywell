/* @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import { RestTimer, type Rest } from "../components/rest-timer";

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

const next = { name: "Bench press", set: 3, reps: 5, weightKg: 82.5 };

describe("rest timer adjustment", () => {
  it("keeps the next set visible after changing the duration", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    render(
      <Harness
        initial={{ endsAt: Date.now() + 16_000, total: 90_000, next }}
      />,
    );

    act(() => screen.getByRole("button", { name: "15 seconds more" }).click());

    expect(document.querySelector(".rest-next")?.textContent).toBe(
      "Next: Bench press · 5 × 82.5 kg",
    );
  });

  it("speaks the original next set after changing the duration", () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
    localStorage.setItem("daywell.restVoice", "1");
    const speak = vi.fn();
    vi.stubGlobal("speechSynthesis", { speak, cancel: vi.fn() });
    vi.stubGlobal(
      "SpeechSynthesisUtterance",
      class {
        constructor(public text: string) {}
      },
    );
    render(
      <Harness initial={{ endsAt: Date.now() + 1_000, total: 90_000, next }} />,
    );

    act(() => screen.getByRole("button", { name: "15 seconds more" }).click());
    act(() => vi.advanceTimersByTime(16_400));

    expect(speak.mock.calls.map(([utterance]) => utterance.text)).toEqual([
      "Rest over. Bench press, set 3: 5 reps at 82.5 kilos.",
    ]);
  });
});
