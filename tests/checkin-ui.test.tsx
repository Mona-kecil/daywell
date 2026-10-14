// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { CheckInCard } from "../components/checkin";

const state = vi.hoisted(() => ({
  checkIn: undefined as unknown,
  calls: [] as unknown[],
}));
vi.mock("convex/react", () => ({
  useQuery: () => state.checkIn,
  useMutation: () => (args: unknown) => {
    state.calls.push(args);
    return Promise.resolve(null);
  },
}));

const now = new Date(2026, 9, 15, 9, 0).getTime();
beforeEach(() => {
  state.checkIn = undefined;
  state.calls = [];
});
afterEach(cleanup);

const input = (name: RegExp) => screen.getByLabelText(name) as HTMLInputElement;

describe("check-in fields", () => {
  it("shows the saved waist and sends it with the other fields", async () => {
    state.checkIn = { day: "2026-10-15", weightKg: 80.2, waistCm: 86 };
    render(<CheckInCard now={now} />);
    expect(input(/^Waist/).value).toBe("86");
    expect(input(/^Waist/).min).toBe("40");
    expect(input(/^Waist/).max).toBe("200");

    fireEvent.change(input(/^Waist/), { target: { value: "84.5" } });
    fireEvent.change(input(/^Weight/), { target: { value: "" } });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save check-in" }));
    });
    // A cleared field sends null, which clears it on the server.
    expect(state.calls).toEqual([
      {
        day: "2026-10-15",
        sleepHours: null,
        weightKg: null,
        waistCm: 84.5,
        note: null,
      },
    ]);
  });
});
