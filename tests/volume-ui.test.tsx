// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { VolumeCard } from "../components/volume";
import type { WeeklyVolume } from "../lib/volume";

const mocks = vi.hoisted(() => ({ data: undefined as unknown }));
vi.mock("convex/react", () => ({ useQuery: () => mocks.data }));

type Row = WeeklyVolume["muscles"][number];
const row = (over: Partial<Row>): Row => ({
  id: "back",
  name: "back",
  current: 12,
  average: 11.4,
  status: "on-track",
  ...over,
});
const volume = (muscles: Row[]): WeeklyVolume => ({
  weeks: [
    { start: "2026-10-05", perMuscle: {} },
    { start: "2026-10-12", perMuscle: {} },
  ],
  muscles,
});
const rows = () =>
  within(screen.getByRole("list"))
    .getAllByRole("listitem")
    .map((li) => li.textContent);

afterEach(() => {
  cleanup();
  mocks.data = undefined;
});

describe("Weekly volume", () => {
  it("shows each trained muscle against the 10–20 range", () => {
    mocks.data = volume([
      row({}),
      row({
        id: "chest",
        name: "chest",
        current: 3,
        average: 9,
        status: "low",
      }),
      row({
        id: "quads",
        name: "quads",
        current: 24,
        average: 18,
        status: "high",
      }),
      row({
        id: "abs",
        name: "abs",
        current: 4,
        average: 0.4,
        status: "on-track",
      }),
      row({
        id: "calves",
        name: "calves",
        current: 0,
        average: 6,
        status: "none",
      }),
      row({ id: "neck", name: "neck", current: 0, average: 0, status: "none" }),
      row({
        id: "forearms",
        name: "forearms",
        current: 0,
        average: 0,
        status: "none",
      }),
    ]);
    render(<VolumeCard />);
    expect(screen.getByRole("heading", { name: "Weekly volume" })).toBeTruthy();
    expect(screen.getByText(/since Monday, Oct 12/)).toBeTruthy();
    expect(screen.getByText(/in range this week/).textContent).toBe(
      "1 of 5 muscles in range this week",
    );
    expect(rows()).toEqual([
      "back12 setsIn rangeUsually 11 sets",
      "chest3 setsBehind pace for 10Usually 9 sets",
      "quads24 setsAbove 20Usually 18 sets",
      "abs4 setsOn pace for 10Usually under 1",
      "calves0 setsNone since MondayUsually 6 sets",
    ]);
    // Muscles idle for the whole window collapse into one line.
    expect(screen.getByText(/No sets in 8 weeks/).textContent).toBe(
      "No sets in 8 weeks: neck, forearms",
    );
  });

  it("opens a muscle from its row", async () => {
    mocks.data = volume([row({ current: 1, average: 0 })]);
    const onOpen = vi.fn();
    render(<VolumeCard onOpen={onOpen} />);
    expect(rows()).toEqual(["back1 setOn pace for 10New this week"]);
    await userEvent.click(
      screen.getByRole("button", {
        name: "back: 1 set this week, on pace for 10. Open details",
      }),
    );
    expect(onOpen).toHaveBeenCalledWith("back");
  });

  it("asks for sets when nothing is logged", () => {
    mocks.data = volume([row({ current: 0, average: 0, status: "none" })]);
    render(<VolumeCard />);
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByText(/Log sets with an exercise/)).toBeTruthy();
  });

  it("renders nothing while loading", () => {
    const { container } = render(<VolumeCard />);
    expect(container.innerHTML).toBe("");
  });
});
