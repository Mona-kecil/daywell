// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { CloseTheGap } from "../components/gap";
import { FeedbackProvider } from "../components/ui";
import { closeGap } from "../lib/gap";

const mocks = vi.hoisted(() => ({
  settings: undefined as unknown,
  calls: [] as [string, unknown][],
}));
vi.mock("convex/react", () => ({
  useQuery: () => mocks.settings,
  useMutation: (ref: unknown) => {
    const name = getFunctionName(ref as never);
    return async (args: unknown) => {
      mocks.calls.push([name, args]);
      return name === "meals:addManual" ? "meal-1" : null;
    };
  },
}));

const eaten = (protein: number, kcal: number) => ({
  kcal,
  protein,
  carbs: 0,
  fat: 0,
});
const show = (totals: ReturnType<typeof eaten>) =>
  render(
    <FeedbackProvider>
      <CloseTheGap totals={totals} />
    </FeedbackProvider>,
  );

afterEach(() => {
  cleanup();
  mocks.settings = undefined;
  mocks.calls = [];
});

describe("Close the gap", () => {
  it("suggests portions from FDC values and logs one with undo", async () => {
    mocks.settings = { proteinTarget: 140, kcalTarget: 2200 };
    const totals = eaten(100, 1500);
    const plan = closeGap({
      eaten: totals,
      proteinTarget: 140,
      kcalTarget: 2200,
    });
    if (plan.status !== "open") throw new Error(plan.status);
    show(totals);
    expect(screen.getByText("40 g protein to go · 700 kcal left")).toBeTruthy();
    const rows = screen.getAllByRole("listitem");
    expect(rows.map((r) => r.querySelector("strong")!.textContent)).toEqual(
      plan.suggestions.map((s) => s.food.name),
    );
    expect(rows[0].textContent).toContain("Closes the gap");
    const first = plan.suggestions[0];
    expect(screen.getByRole("img").getAttribute("aria-label")).toBe(
      `Protein 100 of 140 g. ${first.food.name} would bring it to ${Math.round(100 + first.adds.protein)} g.`,
    );

    await userEvent.click(
      screen.getByRole("button", {
        name: `Log ${first.food.name}, ${first.label}`,
      }),
    );
    expect(mocks.calls).toEqual([
      [
        "meals:addManual",
        {
          at: expect.any(Number),
          description: first.food.name,
          items: [
            {
              name: first.food.name,
              grams: first.grams,
              fdcId: first.food.fdcId,
              per100g: first.food.per100g,
            },
          ],
        },
      ],
    ]);
    await userEvent.click(await screen.findByText("Undo"));
    expect(mocks.calls[1]).toEqual(["meals:deleteMeal", { id: "meal-1" }]);
  });

  it("previews the hovered suggestion on the protein bar", () => {
    mocks.settings = { proteinTarget: 140, kcalTarget: null };
    show(eaten(100, 1500));
    const rows = screen.getAllByRole("listitem");
    fireEvent.pointerEnter(rows[1]);
    const name = rows[1].querySelector("strong")!.textContent;
    expect(screen.getByRole("img").getAttribute("aria-label")).toContain(
      `${name} would bring it to`,
    );
    expect(rows[1].className).toBe("previewed");
  });

  it("says when portions leave a gap", () => {
    mocks.settings = { proteinTarget: 140, kcalTarget: 1600 };
    show(eaten(60, 1500));
    expect(screen.getAllByText(/g short$/).length).toBeGreaterThan(0);
    expect(screen.queryByText("Closes the gap")).toBeNull();
  });

  it("explains when no food fits the calories left", () => {
    mocks.settings = { proteinTarget: 140, kcalTarget: 2000 };
    show(eaten(60, 2100));
    expect(screen.getByText(/at your calorie target/)).toBeTruthy();
    expect(screen.queryByRole("listitem")).toBeNull();
  });

  it("celebrates a met target", () => {
    mocks.settings = { proteinTarget: 120, kcalTarget: null };
    show(eaten(130, 1800));
    expect(screen.getByText("Protein target reached.")).toBeTruthy();
  });

  it("sets a protein target without clearing the calorie target", async () => {
    mocks.settings = { proteinTarget: null, kcalTarget: 2000 };
    show(eaten(10, 300));
    await userEvent.type(screen.getByLabelText("Daily protein"), "130");
    await userEvent.click(screen.getByRole("button", { name: "Set target" }));
    expect(mocks.calls).toEqual([
      ["coach:setTargets", { kcalTarget: 2000, proteinTarget: 130 }],
    ]);
    await userEvent.click(await screen.findByText("Undo"));
    expect(mocks.calls[1]).toEqual(["coach:setTargets", { kcalTarget: 2000 }]);
  });
});
