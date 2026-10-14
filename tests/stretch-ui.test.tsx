// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { StretchCard } from "../components/stretch";

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

const now = new Date(2026, 9, 15, 18, 0).getTime();
const hours = (h: number) => now - h * 3600_000;
const muscles = [
  { name: "Chest", lastTrainedAt: hours(50) },
  { name: "Back", lastTrainedAt: hours(2) },
  { name: "Abs", lastTrainedAt: null },
  { name: "Calves", lastTrainedAt: hours(30) },
  { name: "Neck", lastTrainedAt: hours(1) },
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(now);
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
const chip = (name: string) => screen.getByRole("button", { name });
const phase = () => document.querySelector(".interval-phase")?.textContent;
const name = () => document.querySelector(".stretch-name")?.textContent;
const side = () => document.querySelector(".stretch-side")?.textContent;
const clock = () => document.querySelector(".interval-clock")?.textContent;
const live = () => document.querySelector("[aria-live]")?.textContent;

describe("Cool-down stretches", () => {
  it("starts from what was trained in the last day and a half", () => {
    render(<StretchCard muscles={muscles} now={now} />);
    expect(
      screen.getByText(
        "Picked from what you trained in the last day and a half.",
      ),
    ).toBeTruthy();
    // Only groups with a stretch get a chip.
    expect(screen.queryByRole("button", { name: "Neck" })).toBeNull();
    expect(chip("Back").ariaPressed).toBe("true");
    expect(chip("Calves").ariaPressed).toBe("true");
    expect(chip("Chest").ariaPressed).toBe("false");
    expect(chip("Abs").ariaPressed).toBe("false");
    // Child's pose once, wall calf per side: 35 s + 2 × 35 s.
    expect(screen.getByText("2 stretches · 1:45")).toBeTruthy();

    fireEvent.click(chip("Back"));
    fireEvent.click(chip("Chest"));
    expect(chip("Back").ariaPressed).toBe("false");
    expect(chip("Chest").ariaPressed).toBe("true");
    expect(screen.getByText("2 stretches · 2:20")).toBeTruthy();
  });

  it("remembers the hold and needs a muscle to start", () => {
    render(
      <StretchCard
        muscles={[{ name: "Back", lastTrainedAt: hours(40) }]}
        now={now}
      />,
    );
    expect(
      screen.getByText("Pick the muscles you want to stretch."),
    ).toBeTruthy();
    const start = screen.getByRole("button", { name: "Start cool-down" });
    expect((start as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText("0 stretches · 0:00")).toBeTruthy();

    fireEvent.click(chip("Back"));
    fireEvent.click(screen.getByRole("button", { name: "45 s" }));
    expect(screen.getByText("1 stretch · 0:50")).toBeTruthy();
    expect((start as HTMLButtonElement).disabled).toBe(false);
    expect(localStorage.getItem("daywell.stretchHold")).toBe("45");
    cleanup();

    render(<StretchCard muscles={muscles} now={now} />);
    expect(screen.getByRole("button", { name: "45 s" }).ariaPressed).toBe(
      "true",
    );
    localStorage.setItem("daywell.stretchHold", "999");
    cleanup();
    render(<StretchCard muscles={muscles} now={now} />);
    expect(screen.getByRole("button", { name: "30 s" }).ariaPressed).toBe(
      "true",
    );
  });

  it("guides each side, pauses, skips and finishes", () => {
    render(
      <StretchCard
        muscles={[{ name: "Calves", lastTrainedAt: hours(1) }]}
        now={now}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "20 s" }));
    fireEvent.click(screen.getByRole("button", { name: "Start cool-down" }));

    expect(screen.getByRole("dialog", { name: "Cool-down" })).toBeTruthy();
    expect(phase()).toBe("Get into position");
    expect(name()).toBe("Wall calf");
    expect(side()).toBe("Left side");
    expect(clock()).toBe("5");
    expect(screen.getByText("Hold 1 of 2")).toBeTruthy();
    expect(screen.getByText("Next: Wall calf, right side")).toBeTruthy();
    expect(live()).toMatch(/^Wall calf, left side\. Hands on a wall/);

    tick(5000);
    expect(phase()).toBe("Hold");
    expect(clock()).toBe("20");
    expect(live()).toBe("Hold");
    expect(tones).toEqual([880]);
    expect(screen.getByText("Next: Wall calf, right side")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Pause" }));
    tick(10_000);
    expect(clock()).toBe("20");
    expect(screen.getByText("Hold 1 of 2 · Paused")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Resume" }));
    tick(3000);
    expect(clock()).toBe("17");

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    tick(100);
    expect(phase()).toBe("Get into position");
    expect(side()).toBe("Right side");
    expect(screen.getByText("Hold 2 of 2")).toBeTruthy();
    expect(tones).toEqual([880, 660]);

    tick(5000);
    expect(screen.getByText("Last one")).toBeTruthy();
    tick(20_000);
    expect(phase()).toBe("Done");
    expect(live()).toBe("Done. Nice stretch.");
    expect(tones.at(-1)).toBe(1320);
    expect(screen.getByText("1 stretch")).toBeTruthy();
    // Nothing left to count, so the timer stops.
    expect(vi.getTimerCount()).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "Again" }));
    expect(name()).toBe("Wall calf");
    tick(1000);
    expect(clock()).toBe("4");
    fireEvent.click(screen.getByRole("button", { name: "Stop cool-down" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("counts each side as its own hold", () => {
    render(<StretchCard muscles={muscles} now={now} />);
    fireEvent.click(screen.getByRole("button", { name: "Start cool-down" }));
    // Child's pose has no sides; wall calf has two.
    expect(name()).toBe("Child's pose");
    expect(side()).toBeUndefined();
    expect(screen.getByText("Hold 1 of 3")).toBeTruthy();
    expect(screen.getByText("Next: Wall calf, left side")).toBeTruthy();
  });
});
