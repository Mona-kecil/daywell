// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { CaffeineCard } from "../components/caffeine";
import { FeedbackProvider, timeLabel } from "../components/ui";
import { caffeineAt, sleepReadyAt } from "../lib/caffeine";

const mocks = vi.hoisted(() => ({
  doses: [] as unknown[],
  calls: [] as [string, unknown][],
}));
vi.mock("convex/react", () => ({
  // Answers like the backend: only doses inside the asked-for range.
  useQuery: (_: unknown, args: { startMs: number; endMs: number }) => {
    if (args.endMs - args.startMs > 48 * 3_600_000)
      throw new Error("Use a time range of at most 48 hours.");
    return (mocks.doses as { at: number }[]).filter(
      (d) => d.at >= args.startMs && d.at < args.endMs,
    );
  },
  useMutation: (ref: unknown) => {
    const name = getFunctionName(ref as never);
    return async (args: unknown) => {
      mocks.calls.push([name, args]);
      return name === "caffeine:add" ? "c-new" : null;
    };
  },
}));

const HOUR = 3_600_000;
const NOW = new Date(2026, 9, 14, 15, 20).getTime();
const dose = (id: string, label: string, mg: number, at: number) => ({
  _id: id,
  _creationTime: at,
  userId: "u",
  label,
  mg,
  at,
});
const coffee = dose("c1", "Brewed coffee", 95, NOW - 2 * HOUR);
const show = () =>
  render(
    <FeedbackProvider>
      <CaffeineCard />
    </FeedbackProvider>,
  );
const round = (n: number) => `${Math.round(n)} mg`;

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(NOW);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  mocks.doses = [];
  mocks.calls = [];
});

describe("Caffeine card", () => {
  it("logs a preset now, with undo", async () => {
    show();
    expect(screen.getByText("Nothing logged today.")).toBeTruthy();
    expect(screen.queryByRole("img")).toBeNull();
    await userEvent.click(
      screen.getByRole("button", { name: "Log Espresso, 63 mg" }),
    );
    expect(mocks.calls).toEqual([
      ["caffeine:add", { mg: 63, label: "Espresso", at: NOW }],
    ]);
    expect(await screen.findByText("Logged Espresso · 63 mg")).toBeTruthy();
    await userEvent.click(screen.getByText("Undo"));
    expect(mocks.calls[1]).toEqual(["caffeine:remove", { id: "c-new" }]);
  });

  it("says what is in you now and when you will be sleep-ready", () => {
    // Last night's espresso still counts toward now, but not toward today.
    const lastNight = dose(
      "c0",
      "Espresso",
      63,
      new Date(2026, 9, 13, 22).getTime(),
    );
    mocks.doses = [lastNight, coffee];
    show();
    const sleep = sleepReadyAt(mocks.doses as never, NOW)!;
    expect(sleep).toBeGreaterThan(NOW);
    expect(
      screen.getByText(
        `${round(caffeineAt(mocks.doses as never, NOW))} in you now · sleep-ready by ${timeLabel(sleep)}`,
      ),
    ).toBeTruthy();
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain(
      `Falls to 50 mg at ${timeLabel(sleep)}.`,
    );
    expect(screen.getByText("95 mg of 400 mg today")).toBeTruthy();
    expect(
      screen
        .getAllByRole("listitem")
        .map((li) => li.querySelector("strong")!.textContent),
    ).toEqual(["Brewed coffee"]);
  });

  it("counts a big dose from yesterday's lunch in tonight's sleep-ready time", () => {
    // 12 h before midnight is noon; a 400 mg dose a minute earlier still
    // leaves about 25 mg at 8 AM, enough to push a small coffee past 50 mg.
    const lunch = dose(
      "c0",
      "Cold brew",
      400,
      new Date(2026, 9, 13, 11, 59).getTime(),
    );
    const morning = new Date(2026, 9, 14, 8).getTime();
    vi.spyOn(Date, "now").mockReturnValue(morning);
    mocks.doses = [lunch, dose("c1", "Coffee", 35, morning)];
    show();
    const sleep = sleepReadyAt(mocks.doses as never, morning)!;
    expect(sleep).toBeGreaterThan(morning);
    expect(
      screen.getByText(new RegExp(`sleep-ready by ${timeLabel(sleep)}$`)),
    ).toBeTruthy();
  });

  it("stays inside the 48-hour read limit on a 25-hour fall-back day", () => {
    const zone = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      const morning = Date.parse("2026-11-01T08:00:00-05:00");
      vi.spyOn(Date, "now").mockReturnValue(morning);
      // 300 mg at 11 PM the night before still delays sleep-ready.
      mocks.doses = [
        dose("y", "Espresso", 300, Date.parse("2026-10-31T23:00:00-04:00")),
      ];
      show();
      const sleep = sleepReadyAt(mocks.doses as never, morning)!;
      expect(sleep).toBeGreaterThan(morning);
      expect(
        screen.getByText(new RegExp(`sleep-ready by ${timeLabel(sleep)}$`)),
      ).toBeTruthy();
    } finally {
      if (zone === undefined) delete process.env.TZ;
      else process.env.TZ = zone;
    }
  });

  it("names the peak while a fresh dose is still absorbing", () => {
    mocks.doses = [dose("c2", "Cold brew", 155, NOW - 10 * 60_000)];
    show();
    expect(screen.getByText(/ · peaks at \d+ mg around /)).toBeTruthy();
  });

  it("warns past 400 mg a day", () => {
    mocks.doses = [
      dose("a", "Cold brew", 155, NOW - 9 * HOUR),
      dose("b", "Cold brew", 155, NOW - 6 * HOUR),
      dose("c", "Cold brew", 155, NOW - 3 * HOUR),
    ];
    show();
    expect(screen.getByRole("note").textContent).toMatch(
      /Over the 400 mg a day/,
    );
  });

  it("removes a dose, and undo logs it again at the same time", async () => {
    mocks.doses = [coffee];
    show();
    await userEvent.click(
      screen.getByRole("button", {
        name: `Remove Brewed coffee at ${timeLabel(coffee.at)}`,
      }),
    );
    expect(mocks.calls).toEqual([["caffeine:remove", { id: "c1" }]]);
    await userEvent.click(await screen.findByText("Undo"));
    expect(mocks.calls[1]).toEqual([
      "caffeine:add",
      { mg: 95, label: "Brewed coffee", at: coffee.at },
    ]);
  });

  it("logs a custom drink", async () => {
    show();
    await userEvent.click(screen.getByRole("button", { name: "Other" }));
    await userEvent.type(screen.getByLabelText("Drink"), "Matcha");
    await userEvent.type(screen.getByLabelText("Amount"), "70");
    await userEvent.click(screen.getByRole("button", { name: "Log" }));
    expect(mocks.calls).toEqual([
      ["caffeine:add", { mg: 70, label: "Matcha", at: NOW }],
    ]);
    expect(screen.queryByLabelText("Drink")).toBeNull();
  });

  it("steps through the curve an hour at a time from now", () => {
    mocks.doses = [coffee];
    show();
    const chart = screen.getByRole("img");
    expect(screen.getByText(`Now · ${round(caffeineAt([coffee], NOW))}`));
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    // The curve starts six whole hours back and samples every 10 minutes.
    const from = Math.floor(NOW / HOUR) * HOUR - 6 * HOUR;
    const t = from + (Math.round((NOW - from) / 600_000) + 6) * 600_000;
    expect(
      screen.getByText(`${timeLabel(t)} · ${round(caffeineAt([coffee], t))}`),
    ).toBeTruthy();
    fireEvent.blur(chart);
    expect(screen.getByText(`Now · ${round(caffeineAt([coffee], NOW))}`));
  });
});
