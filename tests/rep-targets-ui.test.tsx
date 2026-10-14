// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("convex/react", () => ({
  useQuery: () => undefined,
  useMutation: () => vi.fn(),
}));
import { RepTargets } from "../components/rep-targets";

afterEach(cleanup);

const pressed = () =>
  document.querySelector(".rep-rows [aria-pressed=true]")?.textContent;
const caption = () => document.querySelector(".plates figcaption")?.textContent;

describe("Rep targets", () => {
  it("starts from last session, picks rows and shows their plates", () => {
    render(<RepTargets bestKg={120} lastKg={100} />);
    expect(screen.getByText(/last session’s e1RM of 100 kg/)).toBeTruthy();
    expect(screen.getAllByRole("listitem")).toHaveLength(10);
    expect(pressed()).toBe("5 reps86%85 kg");
    expect(caption()).toContain("Per side: 25 + 5 + 2.5 kg");

    fireEvent.click(screen.getByRole("button", { name: /^1 rep/ }));
    expect(pressed()).toBe("1 rep100%100 kg");
    expect(caption()).toContain("Per side: 25 + 15");

    fireEvent.click(screen.getByRole("button", { name: "Best" }));
    expect(screen.getByText(/your best e1RM of 120 kg/)).toBeTruthy();
    expect(pressed()).toBe("1 rep100%120 kg");
  });

  it("has no choice when last session matches the best", () => {
    render(<RepTargets bestKg={100} lastKg={100.02} />);
    expect(screen.queryByRole("group", { name: "Based on" })).toBeNull();
    expect(screen.getByText(/your best e1RM of 100 kg/)).toBeTruthy();
  });

  it("points light weights away from the bar", () => {
    render(<RepTargets bestKg={22} lastKg={0} />);
    expect(screen.queryByRole("group", { name: "Based on" })).toBeNull();
    expect(pressed()).toBe("5 reps86%17.5 kg");
    expect(document.querySelector(".plates")).toBeNull();
    expect(
      screen.getByText(/17.5 kg is lighter than a 20 kg bar/),
    ).toBeTruthy();
  });
});
