// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { IntervalCard } from "../components/intervals";

// jsdom has no modal dialogs.
HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
  this.open = false;
  this.dispatchEvent(new Event("close"));
};

let tones: number[] = [];
let spoken: string[] = [];
class FakeAudio {
  currentTime = 0;
  destination = {};
  resume() {
    return Promise.resolve();
  }
  createOscillator() {
    const osc = {
      frequency: { value: 0 },
      connect: (n: unknown) => n,
      start: () => tones.push(osc.frequency.value),
      stop: () => {},
    };
    return osc;
  }
  createGain() {
    const ramp = () => {};
    return {
      gain: {
        setValueAtTime: ramp,
        exponentialRampToValueAtTime: ramp,
      },
      connect: (n: unknown) => n,
    };
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  tones = [];
  spoken = [];
  vi.stubGlobal("AudioContext", FakeAudio);
  vi.stubGlobal("SpeechSynthesisUtterance", function (this: object, t: string) {
    Object.assign(this, { text: t });
  });
  vi.stubGlobal("speechSynthesis", {
    cancel: () => {},
    speak: (u: { text: string }) => u.text && spoken.push(u.text),
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const tick = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const clockText = () => document.querySelector(".interval-clock")?.textContent;
const phaseText = () => document.querySelector(".interval-phase")?.textContent;
const live = () =>
  document.querySelector(".interval-top [aria-live]")?.textContent;

describe("Interval timer", () => {
  it("sets rounds from presets and steppers and remembers them", () => {
    render(<IntervalCard />);
    const tabata = screen.getByRole("button", { name: /Tabata/ });
    expect(tabata.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("8 rounds · 3:50 total")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /EMOM 10/ }));
    expect(screen.getByText("10 rounds · 10:00 total")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Less rounds" }));
    expect(screen.getByText("9 rounds · 9:00 total")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: /EMOM 10/ })
        .getAttribute("aria-pressed"),
    ).toBe("false");
    expect(JSON.parse(localStorage.getItem("daywell.intervals")!)).toEqual({
      workS: 60,
      restS: 0,
      rounds: 9,
    });

    cleanup();
    render(<IntervalCard />);
    expect(screen.getByText("9 rounds · 9:00 total")).toBeTruthy();
  });

  it("counts down each phase with beeps, pauses, skips and finishes", () => {
    render(<IntervalCard />);
    fireEvent.click(screen.getByRole("button", { name: "Less rounds" }));
    for (let i = 0; i < 6; i++)
      fireEvent.click(screen.getByRole("button", { name: "Less rounds" }));
    expect(screen.getByText("1 round · 0:20 total")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "More rounds" }));
    fireEvent.click(screen.getByRole("button", { name: "Start" }));

    expect(screen.getByRole("dialog", { name: "Interval timer" })).toBeTruthy();
    expect(phaseText()).toBe(" Get ready");
    expect(clockText()).toBe("0:05");
    expect(screen.getByText("Round 1 of 2")).toBeTruthy();
    expect(screen.getByText("Next: work 20 s")).toBeTruthy();

    // Three short beeps, then the switch.
    tick(4000);
    expect(tones).toEqual([660, 660, 660]);
    tick(1000);
    expect(tones).toEqual([660, 660, 660, 880]);
    expect(phaseText()).toBe(" Work");
    expect(clockText()).toBe("0:20");
    expect(live()).toBe("Work. Round 1 of 2.");

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    tick(10_000);
    expect(clockText()).toBe("0:20");
    expect(screen.getByText("Round 1 of 2 · Paused")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    tick(3000);
    expect(clockText()).toBe("0:17");

    fireEvent.click(screen.getByRole("button", { name: "Skip work" }));
    tick(100);
    expect(phaseText()).toBe(" Rest");
    expect(clockText()).toBe("0:10");
    expect(live()).toBe("Rest");

    tick(10_000);
    expect(live()).toBe("Work. Last round.");
    expect(screen.getByText("Last stretch")).toBeTruthy();
    tick(20_000);
    expect(phaseText()).toBe("Done");
    expect(live()).toBe("Done. Nice work.");
    expect(tones.at(-1)).toBe(1320);
    // Nothing left to count, so the timer stops.
    expect(vi.getTimerCount()).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "Again" }));
    expect(phaseText()).toBe(" Get ready");
    tick(1000);
    expect(clockText()).toBe("0:04");
    fireEvent.click(screen.getByRole("button", { name: "Stop timer" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("speaks the switches only with voice cues on", () => {
    render(<IntervalCard />);
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    tick(5000);
    expect(spoken).toEqual([]);
    fireEvent.click(screen.getByRole("button", { name: "Turn voice cues on" }));
    tick(20_000);
    expect(spoken).toEqual(["Rest"]);
    expect(localStorage.getItem("daywell.intervalVoice")).toBe("1");
  });
});
