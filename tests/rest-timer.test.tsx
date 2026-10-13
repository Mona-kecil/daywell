// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { useState } from "react";
import { RestTimer, type Rest } from "../components/rest-timer";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function Harness({ initial }: { initial: Rest }) {
  const [rest, setRest] = useState<Rest | null>(initial);
  return <RestTimer rest={rest} onChange={setRest} />;
}

describe("rest timer", () => {
  it("still chimes when a nearly finished rest is shortened", () => {
    vi.useFakeTimers();
    const vibrate = vi.fn();
    vi.stubGlobal("navigator", { ...navigator, vibrate });
    const now = Date.now();
    render(<Harness initial={{ endsAt: now + 5_000, total: 90_000 }} />);
    act(() => screen.getByLabelText("15 seconds less").click());
    act(() => vi.advanceTimersByTime(400));
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Go!")).toBeTruthy();
  });
});
