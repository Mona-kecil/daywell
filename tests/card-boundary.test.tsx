// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ConvexError } from "convex/values";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CardBoundary } from "../components/card-boundary";

afterEach(cleanup);

describe("card boundary", () => {
  it("keeps a failing card to itself and can retry", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    let fail = true;
    function Recap() {
      if (fail) throw new ConvexError("History exceeds recap limits.");
      return <p>Recap ready</p>;
    }
    render(
      <>
        <CardBoundary title="Your month">
          <Recap />
        </CardBoundary>
        <p>Other card</p>
      </>,
    );
    const card = screen.getByRole("region", { name: "Your month" });
    expect(card.textContent).toContain("History exceeds recap limits.");
    expect(screen.getByText("Other card")).toBeTruthy();
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(screen.getByText("Recap ready")).toBeTruthy();
  });

  it("keeps unexpected errors generic", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    function Broken(): never {
      throw new Error("secret stack detail");
    }
    render(
      <CardBoundary title="Weekly review">
        <Broken />
      </CardBoundary>,
    );
    const card = screen.getByRole("region", { name: "Weekly review" });
    expect(card.textContent).toContain("This card couldn't load.");
    expect(card.textContent).not.toContain("secret stack detail");
  });
});
