// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Readiness } from "../lib/readiness";
import { ReadinessCard } from "../components/readiness";

const mocks = vi.hoisted(() => ({ data: undefined as unknown }));
vi.mock("convex/react", () => ({ useQuery: () => mocks.data }));

const full: Readiness = {
  day: "2026-10-15",
  score: 68,
  band: "steady",
  components: [
    {
      key: "load",
      score: 42.9,
      weight: 0.15,
      detail: { acute: 60, chronic: 37.5, acwr: 1.6 },
    },
    {
      key: "sleepTrend",
      score: 84,
      weight: 0.15,
      detail: { recentSleep: 6.4, baselineSleep: 7.2 },
    },
    {
      key: "soreness",
      score: 81.8,
      weight: 0.15,
      detail: { sore: 2, total: 11 },
    },
    { key: "sleep", score: 100, weight: 0.3, detail: { sleepHours: 7.5 } },
  ],
  missing: ["feel"],
};

beforeEach(() => {
  mocks.data = full;
  vi.stubGlobal("matchMedia", () => ({ matches: false }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("readiness card", () => {
  it("shows the score, the band and every factor, biggest drag first", () => {
    render(<ReadinessCard now={Date.parse("2026-10-15T08:00:00Z")} />);
    const card = screen.getByRole("region", { name: "Readiness" });
    expect(within(card).getByText("68")).toBeTruthy();
    expect(within(card).getByText("Train steady")).toBeTruthy();
    expect(card.textContent).toContain(
      "Your training load is well above your usual week, so train as planned and skip the max-effort sets.",
    );
    const rows = within(card)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(rows).toEqual([
      "Training load1.6× your usual week",
      "Sleep trend6.4 h lately, 7.2 h usual",
      "Soreness2 of 11 muscle groups sore",
      "Sleep7.5 h last night",
    ]);
    expect(card.textContent).toContain(
      "An estimate from your logs, not medical advice.",
    );
  });

  it("words each factor and band", () => {
    mocks.data = {
      ...full,
      score: 91,
      band: "push",
      components: [
        {
          key: "feel",
          score: 75,
          weight: 0.5,
          detail: { energy: 4, mood: 4 },
        },
        {
          key: "soreness",
          score: 100,
          weight: 0.5,
          detail: { sore: 0, total: 11 },
        },
      ],
      missing: [],
    };
    const { unmount } = render(<ReadinessCard now={0} />);
    let card = screen.getByRole("region", { name: "Readiness" });
    expect(within(card).getByText("Ready to push")).toBeTruthy();
    expect(card.textContent).toContain("Energy 4/5 · Mood 4/5");
    expect(card.textContent).toContain("No sore muscle groups");
    expect(within(card).queryByRole("button")).toBeNull();
    unmount();
    mocks.data = {
      ...full,
      score: 38,
      band: "easy",
      components: [
        { key: "feel", score: 0, weight: 0.5, detail: { energy: 1 } },
        { key: "load", score: 60, weight: 0.5, detail: { acwr: 0.4 } },
      ],
    };
    render(<ReadinessCard now={0} />);
    card = screen.getByRole("region", { name: "Readiness" });
    expect(within(card).getByText("Take it easy")).toBeTruthy();
    expect(card.textContent).toContain(
      "Go light: a walk, mobility or a stretch.",
    );
    expect(card.textContent).toContain("Energy 1/5");
    expect(card.textContent).toContain("0.4× your usual week");
  });

  it.each([
    ["load", { acwr: 1.7 }, "Your training load is well above your usual week"],
    ["sleep", { sleepHours: 5.4 }, "Last night was short"],
    [
      "sleepTrend",
      { recentSleep: 5, baselineSleep: 7.6 },
      "You've slept less than usual lately",
    ],
    ["feel", { energy: 2, mood: 2 }, "You're running low today"],
    [
      "soreness",
      { sore: 6, total: 11 },
      "Several muscle groups are still sore",
    ],
  ] as const)(
    "names a weak %s factor when it holds back a high score",
    (key, detail, reason) => {
      mocks.data = {
        ...full,
        score: 86,
        band: "steady",
        components: [
          { key, score: 40, weight: 0.2, detail },
          {
            key: "soreness" === key ? "sleep" : "soreness",
            score: 100,
            weight: 0.8,
            detail: { sleepHours: 8, sore: 0, total: 11 },
          },
        ],
        missing: [],
      } as Readiness;
      render(<ReadinessCard now={0} />);
      expect(
        screen.getByRole("region", { name: "Readiness" }).textContent,
      ).toContain(
        `${reason}, so train as planned and skip the max-effort sets.`,
      );
    },
  );

  it("asks for the missing signals and jumps to the check-in", async () => {
    mocks.data = {
      day: "2026-10-15",
      score: null,
      band: null,
      components: [
        {
          key: "soreness",
          score: 100,
          weight: 1,
          detail: { sore: 0, total: 11 },
        },
      ],
      missing: ["sleep", "feel"],
    };
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    render(
      <>
        <ReadinessCard now={0} />
        <section id="checkin">
          <button className="mood" type="button">
            Great
          </button>
          <input name="sleep" aria-label="Sleep" />
        </section>
      </>,
    );
    const card = screen.getByRole("region", { name: "Readiness" });
    expect(card.textContent).toContain(
      "Log last night's sleep and how you feel to see today's readiness.",
    );
    expect(within(card).queryAllByRole("listitem")).toHaveLength(0);
    await userEvent.click(
      within(card).getByRole("button", { name: "Add sleep" }),
    );
    expect(document.activeElement).toBe(screen.getByLabelText("Sleep"));
    await userEvent.click(
      within(card).getByRole("button", { name: "Add how you feel" }),
    );
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Great" }),
    );
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it("renders nothing until the first result", () => {
    mocks.data = undefined;
    const { container } = render(<ReadinessCard now={0} />);
    expect(container.innerHTML).toBe("");
  });
});
