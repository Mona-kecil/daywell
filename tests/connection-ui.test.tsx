// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import {
  ConnectionStatus,
  OFFLINE_AFTER_MS,
  SAVED_FOR_MS,
} from "../components/connection";

const mocks = vi.hoisted(() => ({
  state: {
    hasEverConnected: true,
    isWebSocketConnected: true,
    inflightMutations: 0,
    inflightActions: 0,
  },
}));
vi.mock("convex/react", () => ({
  useConvexConnectionState: () => mocks.state,
}));

const set = (over: Partial<typeof mocks.state>) => {
  mocks.state = { ...mocks.state, ...over };
};
const text = () => screen.getByRole("status", { hidden: true }).textContent;

beforeEach(() => {
  vi.useFakeTimers();
  mocks.state = {
    hasEverConnected: true,
    isWebSocketConnected: true,
    inflightMutations: 0,
    inflightActions: 0,
  };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Connection status", () => {
  it("stays quiet through short drops", () => {
    const { rerender } = render(<ConnectionStatus />);
    expect(text()).toBe("");
    set({ isWebSocketConnected: false });
    rerender(<ConnectionStatus />);
    act(() => vi.advanceTimersByTime(OFFLINE_AFTER_MS - 100));
    set({ isWebSocketConnected: true });
    rerender(<ConnectionStatus />);
    act(() => vi.advanceTimersByTime(OFFLINE_AFTER_MS));
    expect(text()).toBe("");
  });

  it("says nothing before the first connection", () => {
    set({ hasEverConnected: false, isWebSocketConnected: false });
    render(<ConnectionStatus />);
    act(() => vi.advanceTimersByTime(OFFLINE_AFTER_MS * 3));
    expect(text()).toBe("");
  });

  it("counts waiting changes, then confirms they synced", () => {
    const { rerender } = render(<ConnectionStatus />);
    set({ isWebSocketConnected: false });
    rerender(<ConnectionStatus />);
    act(() => vi.advanceTimersByTime(OFFLINE_AFTER_MS));
    expect(text()).toBe("Can't reach Daywell · Reconnecting…");

    set({ inflightMutations: 2 });
    rerender(<ConnectionStatus />);
    expect(text()).toBe("Can't reach Daywell · 2 changes waiting to sync");

    set({ isWebSocketConnected: true, inflightMutations: 1 });
    rerender(<ConnectionStatus />);
    expect(text()).toBe("Back online · syncing 1 change…");

    set({ inflightMutations: 0 });
    rerender(<ConnectionStatus />);
    expect(text()).toBe("Back online · everything is saved");
    act(() => vi.advanceTimersByTime(SAVED_FOR_MS));
    expect(text()).toBe("");
  });

  it("names a dropped device connection", () => {
    const onLine = vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    set({ isWebSocketConnected: false, inflightMutations: 1 });
    render(<ConnectionStatus />);
    act(() => vi.advanceTimersByTime(OFFLINE_AFTER_MS));
    expect(text()).toBe("You're offline · 1 change waiting to sync");
    onLine.mockRestore();
  });
});
