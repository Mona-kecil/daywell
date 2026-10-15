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
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

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

  it("builds a saved meal from scratch", async () => {
    render(<SavedMeals />);
    await userEvent.click(
      within(card()).getByRole("button", { name: /New saved meal/ }),
    );
    const sheet = screen.getByRole("dialog", { name: "New saved meal" });
    const field = (label: string | RegExp) =>
      within(sheet).getByLabelText(label);
    await userEvent.type(field("Name"), "   ");
    await userEvent.type(field("Food 1 name"), "Oats");
    await userEvent.clear(field(/^Food 1 grams/));
    await userEvent.type(field(/^Food 1 grams/), "160");
    await userEvent.type(field("Food 1 kcal"), "608");
    await userEvent.type(field("Food 1 Protein g"), "22");
    await userEvent.click(
      within(sheet).getByRole("button", { name: "Save meal" }),
    );
    expect(within(sheet).getByRole("alert").textContent).toBe(
      "Give the meal a name.",
    );
    expect(state.calls).toEqual([]);

    await userEvent.clear(field("Name"));
    await userEvent.type(field("Name"), " Oats batch ");
    await userEvent.click(
      within(sheet).getByRole("button", { name: "One serving more" }),
    );
    expect(
      within(sheet).getByText(/2 servings of 304 kcal · P 11/),
    ).toBeTruthy();
    await userEvent.click(
      within(sheet).getByRole("button", { name: "Save meal" }),
    );
    expect(state.calls).toEqual([
      [
        "savedMeals:create",
        {
          name: "Oats batch",
          servings: 2,
          items: [
            {
              name: "Oats",
              grams: 160,
              per100g: {
                kcal: 380,
                protein: expect.closeTo(13.75, 9),
                carbs: 0,
                fat: 0,
              },
            },
          ],
        },
      ],
    ]);
    expect(screen.queryByRole("dialog", { name: "New saved meal" })).toBeNull();

    cleanup();
    state.list = Array.from({ length: 60 }, (_, i) => ({
      ...oats,
      id: `s${i}`,
    }));
    render(<SavedMeals />);
    expect(
      (
        within(card()).getByRole("button", {
          name: /New saved meal/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
  });

  it("adds up a shopping list and keeps it on the device", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    render(<SavedMeals />);
    await userEvent.click(
      within(card()).getByRole("button", { name: /Shopping list/ }),
    );
    const sheet = () => screen.getByRole("dialog", { name: "Shopping list" });
    expect(within(sheet()).getByText(/Add servings above/)).toBeTruthy();
    const fewer = (name: string) =>
      within(sheet()).getByRole("button", {
        name: `One serving fewer of ${name}`,
      }) as HTMLButtonElement;
    expect(fewer("Overnight oats").disabled).toBe(true);
    const more = (name: string) =>
      userEvent.click(
        within(sheet()).getByRole("button", {
          name: `One serving more of ${name}`,
        }),
      );
    await more("Overnight oats");
    await more("Overnight oats");
    expect(
      within(sheet())
        .getByRole("checkbox", { name: /^Rolled oats/ })
        .closest("label")?.textContent,
    ).toBe("Rolled oats160 g");
    await more("Chicken rice bowl");
    const yogurt = within(sheet()).getByRole("checkbox", {
      name: /^Greek yogurt/,
    });
    expect(yogurt.closest("label")?.textContent).toBe(
      "Greek yogurt for Overnight oats, Chicken rice bowl600 g",
    );
    expect(
      within(sheet())
        .getByRole("checkbox", { name: /^Rolled oats/ })
        .closest("label")?.textContent,
    ).toMatch(/160 g$/);
    await userEvent.click(yogurt);
    expect(within(sheet()).getByText(/1 left/)).toBeTruthy();
    await userEvent.click(
      within(sheet()).getByRole("button", { name: /Share list/ }),
    );
    expect(writeText).toHaveBeenCalledWith("- Rolled oats, 160 g");

    // Closing and reopening keeps the plan and the ticks.
    await userEvent.click(
      within(sheet()).getByRole("button", { name: "Close" }),
    );
    await userEvent.click(
      within(card()).getByRole("button", { name: /Shopping list/ }),
    );
    expect(
      within(sheet()).getByLabelText("Overnight oats servings").textContent,
    ).toBe("2");
    expect(
      (
        within(sheet()).getByRole("checkbox", {
          name: /^Greek yogurt/,
        }) as HTMLInputElement
      ).checked,
    ).toBe(true);
    // A ticked food that drops off the list no longer counts.
    await userEvent.click(
      within(sheet()).getByRole("checkbox", { name: /^Rolled oats/ }),
    );
    await userEvent.click(fewer("Overnight oats"));
    await userEvent.click(fewer("Overnight oats"));
    expect(
      within(sheet()).queryByRole("checkbox", { name: /^Rolled oats/ }),
    ).toBeNull();
    expect(within(sheet()).getByText(/all done/)).toBeTruthy();
    await userEvent.click(
      within(sheet()).getByRole("button", { name: "Start over" }),
    );
    expect(within(sheet()).queryByRole("checkbox")).toBeNull();
    expect(JSON.parse(localStorage.getItem("daywell.shopping")!)).toEqual({
      plan: {},
      checked: [],
    });
  });
});
