// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { FoodItem } from "../components/meals";
import { FeedbackProvider } from "../components/ui";
import type { Id } from "../convex/_generated/dataModel";

type Call = (args: Record<string, unknown>) => Promise<unknown>;
const mocks = vi.hoisted(() => ({
  fns: {} as Record<string, ReturnType<typeof vi.fn<Call>>>,
}));
const call = (name: string) =>
  (mocks.fns[name] ??= vi.fn<Call>(async () => null));
const fn = (ref: unknown) => call(getFunctionName(ref as never));
vi.mock("convex/react", () => ({
  useAction: (ref: unknown) => fn(ref),
  useMutation: (ref: unknown) => fn(ref),
}));

afterEach(() => {
  cleanup();
  mocks.fns = {};
});

const rice = {
  fdcId: 168878,
  description: "Rice, white, long-grain, regular, cooked",
  dataType: "SR Legacy",
  per100g: { kcal: 130, protein: 2.7, carbs: 28, fat: 0.3 },
};
const item = {
  id: "i1",
  name: "Steamed rice",
  grams: 180,
  status: "unmatched" as const,
  searchQuery: "white rice",
};

function show() {
  render(
    <FeedbackProvider>
      <FoodItem item={item} mealId={"m1" as Id<"meals">} disabled={false} />
    </FeedbackProvider>,
  );
}

async function searchFor(query: string) {
  await userEvent.click(
    screen.getByRole("button", { name: "Change food match" }),
  );
  const input = screen.getByLabelText("USDA search query");
  expect((input as HTMLInputElement).value).toBe("white rice");
  await userEvent.clear(input);
  await userEvent.type(input, query);
  await userEvent.click(screen.getByRole("button", { name: "Search USDA" }));
}

describe("changing a photo meal's food match", () => {
  it("lists USDA matches and records the one picked", async () => {
    call("food:search").mockResolvedValueOnce([
      { ...rice, fdcId: 1, description: "Rice, brown, cooked" },
      rice,
    ]);
    show();
    await searchFor("  long grain   rice ");
    expect(call("food:search")).toHaveBeenCalledWith({
      query: "long grain rice",
    });
    const matches = await screen.findByRole("group", {
      name: "USDA matches for Steamed rice",
    });
    await userEvent.click(
      within(matches).getByRole("button", { name: /long-grain/ }),
    );
    expect(call("mealActions:pickMatch")).toHaveBeenCalledWith({
      id: "m1",
      itemId: "i1",
      query: "long grain rice",
      fdcId: 168878,
    });
    expect(await screen.findByText("Matched Steamed rice")).toBeTruthy();
    expect(screen.queryByRole("group", { name: /USDA matches/ })).toBeNull();
    expect(screen.queryByLabelText("USDA search query")).toBeNull();
  });

  it("keeps the search open when nothing matches", async () => {
    call("food:search").mockResolvedValueOnce([]);
    show();
    await searchFor("zzqx");
    expect((await screen.findByRole("status")).textContent).toMatch(
      /No USDA food with complete nutrients matches “zzqx”/,
    );
    expect(call("mealActions:pickMatch")).not.toHaveBeenCalled();
    expect(screen.getByLabelText("USDA search query")).toBeTruthy();
  });
});
