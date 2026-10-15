// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FastingCard, FastingPrompt } from "../components/fasting";
import { timeLabel } from "../components/ui";

const state = vi.hoisted(() => ({ recent: [] as { at: number }[] }));
vi.mock("convex/react", () => ({ useQuery: () => state.recent }));

const at = (day: number, h: number, m = 0) =>
  new Date(2026, 9, day, h, m).getTime();
const NOW = at(15, 12);

function Fasting({
  meals = [],
  now = NOW,
}: {
  meals?: { at: number }[];
  now?: number;
}) {
  return (
    <>
      <FastingPrompt meals={meals} now={now} />
      <FastingCard meals={meals} now={now} />
    </>
  );
}
const card = () => screen.queryByRole("region", { name: "Fasting" });
const goal = (h: number) => screen.getByRole("button", { name: `${h} hours` });

beforeEach(() => {
  localStorage.clear();
  state.recent = [{ at: at(14, 20, 10) }];
});
afterEach(cleanup);

describe("fasting timer", () => {
  it("offers the timer from the meals card, then tracks against a goal", async () => {
    const { rerender } = render(<Fasting />);
    expect(card()).toBeNull();
    expect(screen.getByText("Last ate 15 h 50 m ago")).toBeTruthy();
    await userEvent.click(
      screen.getByRole("button", { name: /Fasting timer/ }),
    );

    expect(localStorage.getItem("daywell.fasting")).toBe("16");
    expect(screen.queryByText(/Last ate/)).toBeNull();
    expect(card()!.textContent).toContain(
      `Since your last meal yesterday at ${timeLabel(at(14, 20, 10))}`,
    );
    expect(screen.getByText("15 h 50 m")).toBeTruthy();
    expect(
      screen.getByText(
        `10 m to your 16 h goal, at ${timeLabel(at(15, 12, 10))}`,
      ),
    ).toBeTruthy();
    expect(goal(16).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      "99% of a 16 hour fast",
    );

    await userEvent.click(goal(14));
    expect(localStorage.getItem("daywell.fasting")).toBe("14");
    expect(
      screen.getByText(`14 h goal reached at ${timeLabel(at(15, 10, 10))}`),
    ).toBeTruthy();
    expect(card()!.className).toContain("reached");
    expect(card()!.querySelector(".burst")).toBeNull();

    // Crossing the goal while watching celebrates once.
    await userEvent.click(goal(16));
    expect(card()!.querySelector(".burst")).toBeNull();
    rerender(<Fasting now={at(15, 12, 11)} />);
    expect(card()!.querySelector(".burst")).toBeTruthy();
  });

  it("restarts from the next meal and labels tomorrow's goal", () => {
    localStorage.setItem("daywell.fasting", "16");
    render(
      <Fasting
        meals={[{ at: at(15, 20) }, { at: at(15, 23) }]}
        now={at(15, 21)}
      />,
    );
    // A meal logged for later tonight hasn't ended the fast yet.
    expect(screen.getByText("1 h")).toBeTruthy();
    expect(
      screen.getByText(
        `15 h to your 16 h goal, tomorrow at ${timeLabel(at(16, 12))}`,
      ),
    ).toBeTruthy();
  });

  it("names the weekday for older meals and hides on request", async () => {
    localStorage.setItem("daywell.fasting", "20");
    state.recent = [{ at: at(13, 19) }];
    render(<Fasting />);
    const weekday = new Date(at(13, 19)).toLocaleDateString([], {
      weekday: "long",
    });
    expect(card()!.textContent).toContain(
      `Since your last meal ${weekday} at ${timeLabel(at(13, 19))}`,
    );
    await userEvent.click(screen.getByRole("button", { name: "Hide timer" }));
    expect(card()).toBeNull();
    expect(localStorage.getItem("daywell.fasting")).toBeNull();
    expect(screen.getByText("Last ate 41 h ago")).toBeTruthy();
  });

  it("ignores a stored goal it doesn't offer and stays quiet with no meals", () => {
    localStorage.setItem("daywell.fasting", "15");
    render(<Fasting />);
    expect(card()).toBeNull();
    cleanup();
    state.recent = [];
    localStorage.setItem("daywell.fasting", "16");
    render(<Fasting />);
    expect(card()).toBeNull();
    expect(screen.queryByText(/Last ate/)).toBeNull();
  });
});
