// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { BreathCard } from "../components/breath";

// jsdom has no modal dialogs.
HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
  this.open = false;
  this.dispatchEvent(new Event("close"));
};

let tones: number[] = [];
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
      gain: { setValueAtTime: ramp, exponentialRampToValueAtTime: ramp },
      connect: (n: unknown) => n,
    };
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  // An evening, so the wind-down pattern comes first.
  vi.setSystemTime(new Date(2026, 9, 14, 21, 0));
  localStorage.clear();
  tones = [];
  vi.stubGlobal("AudioContext", FakeAudio);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const tick = (ms: number) => act(() => vi.advanceTimersByTime(ms));
const pressed = (group: string) =>
  screen
    .getByRole("group", { name: group })
    .querySelector("[aria-pressed=true]")?.textContent;
const word = () => document.querySelector(".interval-phase")?.textContent;
const count = () => document.querySelector(".breath-count")?.textContent;
const orb = () => (document.querySelector(".breath-orb") as HTMLElement).style;
const live = () => document.querySelector("[aria-live]")?.textContent;

describe("Breathing", () => {
  it("offers 4-7-8 in the evening and remembers the choice", () => {
    render(<BreathCard />);
    expect(pressed("Pattern")).toBe("4-7-8Wind down for sleep");
    expect(pressed("Minutes")).toBe("2 min");
    // 120 s / 19 s rounds to 6 breaths, 1:54.
    expect(screen.getByText("6 breaths · 1:54")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /^Box/ }));
    fireEvent.click(screen.getByRole("button", { name: "5 min" }));
    expect(screen.getByText("19 breaths · 5:04")).toBeTruthy();
    cleanup();
    render(<BreathCard />);
    expect(pressed("Pattern")).toBe("BoxSteady focus");
    expect(pressed("Minutes")).toBe("5 min");
  });

  it("ignores a broken saved choice", () => {
    vi.setSystemTime(new Date(2026, 9, 14, 9, 0));
    localStorage.setItem("daywell.breath", '{"pattern":"box","minutes":7}');
    render(<BreathCard />);
    expect(pressed("Pattern")).toBe("BoxSteady focus");
    expect(pressed("Minutes")).toBe("2 min");
    localStorage.setItem("daywell.breath", "{");
    cleanup();
    expect(() => render(<BreathCard />)).not.toThrow();
  });

  it("paces each step, eases the orb, pauses and finishes", () => {
    render(<BreathCard />);
    fireEvent.click(screen.getByRole("button", { name: "1 min" }));
    fireEvent.click(screen.getByRole("button", { name: "Start 4-7-8" }));
    expect(screen.getByRole("dialog", { name: "Breathing" })).toBeTruthy();
    expect(word()).toBe("Breathe in");
    expect(count()).toBe("4");
    expect(screen.getByText("Breath 1 of 3")).toBeTruthy();
    // First frame sits empty, then eases full over the rest of the step.
    expect(orb().transform).toBe("scale(0.42)");
    expect(orb().transitionDuration).toBe("0ms");
    tick(100);
    expect(orb().transform).toBe("scale(1)");
    expect(orb().transitionDuration).toBe("3900ms");

    tick(3900);
    expect(word()).toBe("Hold");
    expect(live()).toBe("Hold");
    expect(count()).toBe("7");
    tick(7000);
    expect(word()).toBe("Breathe out");
    tick(4000);
    // Paused halfway out: the orb holds at half full, the count stops.
    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    expect(orb().transform).toBe("scale(0.71)");
    expect(orb().transitionDuration).toBe("0ms");
    tick(10_000);
    expect(count()).toBe("4");
    expect(screen.getByText("Breath 1 of 3 · Paused")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    tick(4000);
    expect(screen.getByText("Breath 2 of 3")).toBeTruthy();
    expect(word()).toBe("Breathe in");

    tick(40_000);
    expect(word()).toBe("Done");
    expect(live()).toBe("Done. 3 breaths.");
    expect(screen.getByText("3 breaths of 4-7-8")).toBeTruthy();
    expect(tones).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Again" }));
    expect(word()).toBe("Breathe in");
    fireEvent.click(screen.getByRole("button", { name: "Stop breathing" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("plays a tone on each breath in and out only with tones on", () => {
    render(<BreathCard />);
    fireEvent.click(screen.getByRole("button", { name: "Start 4-7-8" }));
    fireEvent.click(screen.getByRole("button", { name: "Turn tones on" }));
    expect(localStorage.getItem("daywell.breathSound")).toBe("1");
    tick(100);
    expect(tones).toEqual([440]);
    tick(19_000);
    // Hold is silent; out, then the next in.
    expect(tones).toEqual([440, 330, 440]);
  });
});
