// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Id } from "../convex/_generated/dataModel";
import { RecoveryReplay } from "../components/replay";

const mocks = vi.hoisted(() => ({
  data: undefined as unknown,
  args: [] as unknown[],
}));
vi.mock("convex/react", () => ({
  useQuery: (_ref: unknown, args: unknown) => {
    mocks.args.push(args);
    return mocks.data;
  },
}));
vi.mock("../components/body3d", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../components/body3d")>()),
  BodyModel: ({ states }: { states: Record<string, { kind: string }> }) => (
    <ul aria-label="Body">
      {Object.entries(states).map(([key, s]) => (
        <li key={key}>{`${key}: ${s.kind}`}</li>
      ))}
    </ul>
  ),
}));

const HOUR = 3_600_000;
const now = new Date(2026, 9, 14, 9, 20).getTime();
const end = new Date(2026, 9, 14, 10).getTime();
const id = (s: string) => s as Id<"muscles">;
const muscles = [
  {
    _id: id("back"),
    name: "back",
    lastTrainedAt: end - 3 * HOUR,
    cooldownHours: 72,
  },
  {
    _id: id("quads"),
    name: "quads",
    lastTrainedAt: end - 50 * HOUR,
    cooldownHours: 72,
  },
];
const workouts = [
  { trainedAt: end - 50 * HOUR, muscleIds: ["quads"] },
  { trainedAt: end - 3 * HOUR, muscleIds: ["back"] },
];

afterEach(() => {
  cleanup();
  mocks.data = undefined;
  mocks.args = [];
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("Recovery replay", () => {
  it("reads two weeks plus the longest cooldown", () => {
    render(<RecoveryReplay muscles={muscles} now={now} />);
    expect(mocks.args[0]).toEqual({
      startMs: end - (14 * 24 + 72) * HOUR,
      endMs: end,
    });
  });

  it("shows the body as it was at the scrubbed time", () => {
    mocks.data = { workouts };
    render(<RecoveryReplay muscles={muscles} now={now} />);
    expect(screen.getByText("back: recovering")).toBeTruthy();
    expect(screen.getByText("quads: recovering")).toBeTruthy();
    expect(
      screen.getByText(/2 recovering · Last session 3 h earlier: back/),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Replay time"), {
      target: { value: String(14 * 24 - 10) },
    });
    expect(screen.getByText("back: ready")).toBeTruthy();
    expect(
      screen.getByText(/1 recovering · Last session 1 day earlier: quads/),
    ).toBeTruthy();
  });

  it("jumps between sessions", async () => {
    mocks.data = { workouts };
    render(<RecoveryReplay muscles={muscles} now={now} />);
    const scrubber = screen.getByLabelText("Replay time") as HTMLInputElement;
    await userEvent.click(
      screen.getByRole("button", { name: "Previous session" }),
    );
    expect(scrubber.value).toBe(String(14 * 24 - 3));
    await userEvent.click(
      screen.getByRole("button", { name: "Previous session" }),
    );
    expect(scrubber.value).toBe(String(14 * 24 - 50));
    expect(
      (
        screen.getByRole("button", {
          name: "Previous session",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await userEvent.click(screen.getByRole("button", { name: "Next session" }));
    expect(scrubber.value).toBe(String(14 * 24 - 3));
  });

  it("plays from two weeks ago up to now, then stops", () => {
    vi.useFakeTimers();
    vi.stubGlobal("matchMedia", () => ({ matches: false }));
    mocks.data = { workouts };
    render(<RecoveryReplay muscles={muscles} now={now} />);
    const scrubber = screen.getByLabelText("Replay time") as HTMLInputElement;
    fireEvent.click(screen.getByRole("button", { name: /Play two weeks/ }));
    expect(scrubber.value).toBe("0");
    act(() => vi.advanceTimersByTime(500));
    expect(scrubber.value).toBe("20");
    act(() => vi.advanceTimersByTime(60_000));
    expect(scrubber.value).toBe(String(14 * 24));
    expect(screen.getByRole("button", { name: /Play two weeks/ })).toBeTruthy();
  });
});
