// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import {
  SaveMealButton,
  SavedMeals,
  savedLine,
  servingLabel,
} from "../components/saved-meals";

type Ref = Parameters<typeof getFunctionName>[0];
const state = vi.hoisted(() => ({
  list: undefined as unknown,
  calls: [] as [string, unknown][],
}));
vi.mock("convex/react", () => ({
  useQuery: () => state.list,
  useMutation: (ref: Ref) => {
    const name = getFunctionName(ref);
    return (args: unknown) => {
      state.calls.push([name, args]);
      return Promise.resolve("meal1");
    };
  },
}));

HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
  this.open = false;
  this.dispatchEvent(new Event("close"));
};

const oats = {
  id: "s1",
  name: "Overnight oats",
  servings: 2,
  items: [
    {
      name: "Rolled oats",
      grams: 160,
      fdcId: 173904,
      per100g: { kcal: 380, protein: 13, carbs: 68, fat: 7 },
    },
    {
      name: "Greek yogurt",
      grams: 300,
      per100g: { kcal: 60, protein: 10, carbs: 4, fat: 0 },
    },
  ],
  useCount: 3,
  lastUsedAt: 1,
  perServing: { kcal: 394, protein: 25.4, carbs: 60.4, fat: 5.6 },
  totals: { kcal: 788, protein: 50.8, carbs: 120.8, fat: 11.2 },
};
const bowl = {
  ...oats,
  id: "s2",
  name: "Chicken rice bowl",
  servings: 1,
  items: [oats.items[1]],
  perServing: { kcal: 612, protein: 48, carbs: 70, fat: 14 },
};

beforeEach(() => {
  state.list = structuredClone([oats, bowl]);
  state.calls = [];
});
afterEach(cleanup);

const card = () => screen.getByRole("region", { name: "Saved meals" });

describe("saved meals", () => {
  it("labels quarter servings", () => {
    expect(servingLabel(0.25)).toBe("¼ serving");
    expect(servingLabel(1)).toBe("1 serving");
    expect(servingLabel(1.5)).toBe("1½ servings");
    expect(servingLabel(2.75)).toBe("2¾ servings");
    expect(savedLine(oats)).toBe("394 kcal a serving · makes 2");
    expect(savedLine(bowl)).toBe("612 kcal · P 48 g");
  });

  it("lists saved meals, or says how to save one", () => {
    render(<SavedMeals />);
    expect(
      within(card()).getByRole("button", {
        name: "Overnight oats, 394 kcal a serving · makes 2. Log or edit",
      }),
    ).toBeTruthy();
    cleanup();
    state.list = [];
    render(<SavedMeals />);
    expect(within(card()).getByText(/Open a logged meal below/)).toBeTruthy();
    expect(within(card()).queryByRole("list")).toBeNull();
  });

  it("logs a chosen amount with scaled foods", async () => {
    render(<SavedMeals />);
    await userEvent.click(
      screen.getByRole("button", { name: /^Overnight oats/ }),
    );
    const sheet = screen.getByRole("dialog", { name: "Overnight oats" });
    expect(
      within(sheet).getByText("The recipe makes 2 servings."),
    ).toBeTruthy();
    // One serving is half the recipe.
    expect(within(sheet).getByText("80 g")).toBeTruthy();
    expect(within(sheet).getByText("150 g")).toBeTruthy();
    expect(
      within(sheet).getByText("394 kcal · P 25 · F 6 · C 60 g"),
    ).toBeTruthy();

    await userEvent.click(
      within(sheet).getByRole("button", { name: "A quarter serving more" }),
    );
    expect(within(sheet).getByRole("status").textContent).toBe("1¼ servings");
    await userEvent.click(
      within(sheet).getByRole("button", { name: "½ serving" }),
    );
    expect(
      within(sheet)
        .getByRole("button", { name: "½ serving" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
    expect(within(sheet).getByText("40 g")).toBeTruthy();
    expect(within(sheet).getByText("75 g")).toBeTruthy();
    await userEvent.click(
      within(sheet).getByRole("button", { name: "A quarter serving less" }),
    );
    expect(
      (
        within(sheet).getByRole("button", {
          name: "A quarter serving less",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await userEvent.click(
      within(sheet).getByRole("button", { name: "Log ¼ serving" }),
    );
    expect(state.calls).toEqual([
      ["savedMeals:log", { id: "s1", at: expect.any(Number), servings: 0.25 }],
    ]);
  });

  it("edits a saved meal and deletes it with a second tap", async () => {
    render(<SavedMeals />);
    await userEvent.click(
      screen.getByRole("button", { name: /^Overnight oats/ }),
    );
    const sheet = screen.getByRole("dialog", { name: "Overnight oats" });
    await userEvent.click(
      within(sheet).getByRole("button", { name: "Edit saved meal" }),
    );
    const name = within(sheet).getByLabelText("Name");
    await userEvent.clear(name);
    await userEvent.type(name, "Oats for two");
    await userEvent.click(
      within(sheet).getByRole("button", { name: "One serving more" }),
    );
    const grams = within(sheet).getByLabelText(/^Rolled oats grams/);
    await userEvent.clear(grams);
    const save = within(sheet).getByRole("button", { name: "Save changes" });
    expect((save as HTMLButtonElement).disabled).toBe(true);
    await userEvent.type(grams, "200");
    await userEvent.click(
      within(sheet).getByRole("button", { name: "Remove Greek yogurt" }),
    );
    expect(
      (
        within(sheet).getByRole("button", {
          name: "Remove Rolled oats",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    await userEvent.click(save);
    expect(state.calls).toEqual([
      [
        "savedMeals:update",
        {
          id: "s1",
          name: "Oats for two",
          servings: 3,
          items: [
            {
              name: "Rolled oats",
              grams: 200,
              fdcId: 173904,
              per100g: oats.items[0].per100g,
            },
          ],
        },
      ],
    ]);

    await userEvent.click(
      within(sheet).getByRole("button", { name: "Edit saved meal" }),
    );
    await userEvent.click(
      within(sheet).getByRole("button", { name: "Delete saved meal" }),
    );
    expect(state.calls).toHaveLength(1);
    await userEvent.click(
      within(sheet).getByRole("button", { name: "Tap again to delete" }),
    );
    expect(state.calls[1]).toEqual(["savedMeals:remove", { id: "s1" }]);
  });

  it("saves a logged meal under a name", async () => {
    const { rerender } = render(
      <SaveMealButton mealId={"m1" as never} description="Toast" matched={0} />,
    );
    expect(
      screen.queryByRole("button", { name: /Save for next time/ }),
    ).toBeNull();
    const long = `Big breakfast ${"with extras ".repeat(10)}`;
    rerender(
      <SaveMealButton mealId={"m1" as never} description={long} matched={2} />,
    );
    await userEvent.click(
      screen.getByRole("button", { name: /Save for next time/ }),
    );
    const sheet = screen.getByRole("dialog", { name: "Save this meal" });
    const name = within(sheet).getByLabelText("Name") as HTMLInputElement;
    expect(name.value).toBe(long.trim().slice(0, 80));
    await userEvent.clear(name);
    await userEvent.type(name, "  Big breakfast ");
    await userEvent.click(
      within(sheet).getByRole("button", { name: "Save meal" }),
    );
    expect(state.calls).toEqual([
      ["savedMeals:saveFromMeal", { mealId: "m1", name: "Big breakfast" }],
    ]);
  });
});
