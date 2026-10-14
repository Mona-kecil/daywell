// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { PhotoWall } from "../components/photo-wall";

const page = vi.hoisted(() => ({
  results: [] as unknown[],
  status: "Exhausted",
  loadMore: vi.fn(),
  args: [] as unknown[],
}));
vi.mock("convex/react", () => ({
  usePaginatedQuery: (...args: unknown[]) => {
    page.args = args;
    return page;
  },
}));

// jsdom has no modal dialogs.
HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
  this.open = false;
  this.dispatchEvent(new Event("close"));
};

const at = new Date(2026, 9, 12, 12, 30).getTime();
const photo = (id: string, fields: object = {}) => ({
  id,
  at,
  description: "Rice and chicken",
  photoUrl: `https://example.test/${id}.jpg`,
  kcal: 359.6,
  protein: 28.3,
  carbs: 49,
  fat: 3.4,
  ...fields,
});

beforeEach(() => {
  page.results = [];
  page.status = "Exhausted";
  page.loadMore.mockReset();
});
afterEach(cleanup);

describe("photo wall", () => {
  it("asks for 24 photos and stays out of the way while loading", () => {
    page.status = "LoadingFirstPage";
    const { container } = render(<PhotoWall />);
    expect(page.args[2]).toEqual({ initialNumItems: 24 });
    expect(container.innerHTML).toBe("");
  });

  it("explains the empty wall", () => {
    render(<PhotoWall />);
    expect(
      screen.getByText("Analysed meal photos will collect here."),
    ).toBeTruthy();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("shows each photo with its calories and a placeholder for lost photos", () => {
    page.results = [photo("a"), photo("b", { photoUrl: null, kcal: 1200 })];
    render(<PhotoWall />);
    const tiles = within(screen.getByRole("list")).getAllByRole("button");
    expect(tiles).toHaveLength(2);
    expect(tiles[0].getAttribute("aria-label")).toMatch(
      /^Rice and chicken, Mon, Oct 12 .*360 kcal$/,
    );
    expect(tiles[0].querySelector("img")?.getAttribute("src")).toBe(
      "https://example.test/a.jpg",
    );
    expect(tiles[0].textContent).toBe("360");
    expect(tiles[1].querySelector("img")).toBeNull();
    expect(tiles[1].querySelector(".wall-missing")).toBeTruthy();
    expect(tiles[1].textContent).toBe((1200).toLocaleString());
  });

  it("opens a photo's details and closes them", () => {
    page.results = [photo("a"), photo("b", { photoUrl: null })];
    render(<PhotoWall />);
    const tiles = within(screen.getByRole("list")).getAllByRole("button");

    fireEvent.click(tiles[0]);
    const sheet = screen.getByRole("dialog", { name: "Rice and chicken" });
    expect(sheet.querySelector("img")?.getAttribute("alt")).toBe(
      "Your meal photo",
    );
    expect(within(sheet).getByText("360")).toBeTruthy();
    expect(within(sheet).getByText("28.3")).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();

    fireEvent.click(tiles[1]);
    expect(screen.getByText("Photo no longer available")).toBeTruthy();
  });

  it("loads older photos a page at a time", () => {
    page.results = [photo("a")];
    page.status = "CanLoadMore";
    const { rerender } = render(<PhotoWall />);
    fireEvent.click(screen.getByRole("button", { name: "Show older photos" }));
    expect(page.loadMore).toHaveBeenCalledWith(24);

    page.status = "LoadingMore";
    rerender(<PhotoWall />);
    expect(screen.getByRole("status").textContent).toBe(
      "Loading older photos…",
    );
    expect(
      screen.queryByRole("button", { name: "Show older photos" }),
    ).toBeNull();
  });

  it("keeps the open photo when newer meals push it off the page", () => {
    const first = Array.from({ length: 24 }, (_, i) =>
      photo(`meal-${i}`, { description: `Meal ${i}` }),
    );
    page.results = first;
    const { rerender } = render(<PhotoWall />);
    const tiles = within(screen.getByRole("list")).getAllByRole("button");
    fireEvent.click(tiles[23]);
    expect(screen.getByRole("heading", { name: "Meal 23" })).toBeTruthy();

    page.results = [
      photo("new", { description: "New meal" }),
      ...first.slice(0, 23),
    ];
    rerender(<PhotoWall />);
    expect(screen.getByRole("heading", { name: "Meal 23" })).toBeTruthy();

    // Still follows live edits while it is on the page.
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    fireEvent.click(within(screen.getByRole("list")).getAllByRole("button")[1]);
    page.results = [photo("new"), photo("meal-0", { description: "Edited" })];
    rerender(<PhotoWall />);
    expect(screen.getByRole("heading", { name: "Edited" })).toBeTruthy();
  });
});
