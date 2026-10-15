// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CoachCard } from "../components/coach";
import type { Suggestion } from "../lib/coach";

const mocks = vi.hoisted(() => ({ data: undefined as unknown }));
vi.mock("convex/react", () => ({
  useQuery: () => mocks.data,
  useMutation: () => vi.fn(),
  useAction: () => vi.fn(),
}));

const suggestion = (kind: Suggestion["kind"], title: string): Suggestion => ({
  id: `today:${kind}`,
  kind,
  priority: 2,
  title,
  body: "Body.",
});

let reduce = false;
const scrolled: { id: string; behavior?: ScrollBehavior }[] = [];
beforeEach(() => {
  reduce = false;
  scrolled.length = 0;
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("reduce"),
  }));
  Element.prototype.scrollIntoView = function (options) {
    scrolled.push({
      id: this.id,
      behavior: (options as ScrollIntoViewOptions | undefined)?.behavior,
    });
  };
  mocks.data = [
    suggestion("readiness", "Readiness 31: take it easy"),
    suggestion("habit", "Two habits left"),
    suggestion("water", "Drink a glass"),
  ];
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderToday() {
  const onTab = vi.fn();
  render(
    <>
      <CoachCard now={Date.parse("2026-10-15T01:00Z")} onTab={onTab} />
      <section id="readiness" />
      <section id="habits" />
    </>,
  );
  return onTab;
}

describe("coach card", () => {
  it("scrolls to the readiness and habits cards on Today", async () => {
    const onTab = renderToday();
    await userEvent.click(
      screen.getByRole("button", { name: /Readiness 31: take it easy/ }),
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Two habits left/ }),
    );
    expect(scrolled).toEqual([
      { id: "readiness", behavior: "smooth" },
      { id: "habits", behavior: "smooth" },
    ]);
    expect(onTab).toHaveBeenCalledWith("today");
  });

  it("jumps without animation when motion is reduced", async () => {
    reduce = true;
    renderToday();
    await userEvent.click(
      screen.getByRole("button", { name: /Readiness 31: take it easy/ }),
    );
    expect(scrolled).toEqual([{ id: "readiness", behavior: "instant" }]);
  });

  it("still switches tabs for suggestions that live elsewhere", async () => {
    const onTab = renderToday();
    await userEvent.click(
      screen.getByRole("button", { name: /Drink a glass/ }),
    );
    expect(onTab).toHaveBeenCalledWith("water");
    expect(scrolled).toEqual([]);
  });
});
