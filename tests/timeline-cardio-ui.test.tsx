// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { getFunctionName } from "convex/server";
import { describe, expect, it, vi } from "vitest";
import { DayTimeline } from "../components/timeline";

const day = new Date(2026, 9, 15, 0, 0).getTime();
const at = (hour: number) => day + hour * 3_600_000;
const session = (
  id: string,
  sessionDay: string,
  createdAt: number,
  extra: Record<string, unknown> = {},
) => ({
  id,
  kind: "run",
  effort: "hard",
  day: sessionDay,
  minutes: 30,
  distanceKm: 6,
  note: null,
  pace: null,
  kcal: null,
  createdAt,
  ...extra,
});
const week = {
  sessions: [
    session("c1", "2026-10-15", at(7)),
    session("c2", "2026-10-15", at(-2), {
      kind: "walk",
      effort: "easy",
      distanceKm: null,
      minutes: 75,
    }),
    session("c3", "2026-10-14", at(-5)),
  ],
};
const queries = vi.hoisted(() => ({ args: [] as unknown[] }));

vi.mock("convex/react", () => ({
  useQuery: (ref: unknown, args: unknown) => {
    queries.args.push(args);
    return getFunctionName(ref as never) === "cardio:week" ? week : undefined;
  },
  usePaginatedQuery: () => ({
    results: [],
    status: "Exhausted",
    loadMore() {},
  }),
}));

describe("cardio on the day timeline", () => {
  it("shows today's sessions in time order with pace and effort", () => {
    render(<DayTimeline now={at(12)} water={[]} meals={[]} muscles={[]} />);
    expect(queries.args).toContainEqual({ today: "2026-10-15" });
    expect(screen.getByText("2 moments")).toBeTruthy();
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((r) => r.className)).toEqual(["cardio", "cardio"]);
    expect(within(rows[0]).getByText("Run · 6 km · 30 min")).toBeTruthy();
    expect(within(rows[0]).getByText("Hard · 5:00 /km")).toBeTruthy();
    // Logged last night for today: shown at the start of the day.
    expect(within(rows[1]).getByText("Walk · 1 h 15 min")).toBeTruthy();
    expect(within(rows[1]).getByText("Easy")).toBeTruthy();
    expect(rows[1].querySelector("time")?.getAttribute("datetime")).toBe(
      new Date(day).toISOString(),
    );
  });
});
