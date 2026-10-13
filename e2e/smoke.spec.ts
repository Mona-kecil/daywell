import { expect, test } from "@playwright/test";
import sharp from "sharp";
import { signIn, openTab, numberFromText } from "./helpers";

test("water, back recovery, fixture-grounded photo meal, portion edits, and deletion", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await signIn(page);
  let waterCreated = false,
    workoutCreated = false,
    mealCreated = false;
  const note = `Playwright back workout ${Date.now()}`;
  try {
    await openTab(page, "Water");
    const total = page.locator(".water-hero .metric strong");
    const before = numberFromText(await total.innerText());
    await page.getByRole("button", { name: /\+ 500 ml/ }).click();
    await expect(total).toHaveText((before + 500).toLocaleString("en-US"));
    waterCreated = true;
    await page
      .getByRole("button", { name: "Delete 500 ml entry", exact: true })
      .first()
      .click();
    await expect(total).toHaveText(before.toLocaleString("en-US"));
    waterCreated = false;

    await openTab(page, "Train");
    await page.getByRole("button", { name: "back", exact: true }).click();
    await page.getByLabel("Note").fill(note);
    await page
      .getByRole("button", { name: "Save workout", exact: true })
      .click();
    const workout = page.locator("li").filter({ hasText: note });
    await expect(workout).toBeVisible();
    workoutCreated = true;
    await expect(
      page.getByRole("progressbar", { name: "back recovery", exact: true }),
    ).toHaveAttribute("aria-valuenow", "0");
    const back = page
      .locator(".muscle-card")
      .filter({
        has: page.getByRole("heading", { name: "back", exact: true }),
      });
    await expect(back).toContainText(/Ready in \d+h \d+m/);
    await workout.getByRole("button", { name: "Delete workout" }).click();
    await expect(workout).toHaveCount(0);
    workoutCreated = false;

    await openTab(page, "Meals");
    const cards = page.locator("article.meal-card");
    const count = await cards.count();
    const jpeg = await sharp({
      create: { width: 800, height: 600, channels: 3, background: "#d8b47d" },
    })
      .jpeg()
      .toBuffer();
    await page
      .getByLabel("Add meal photo", { exact: false })
      .setInputFiles({
        name: "smoke-meal.jpg",
        mimeType: "image/jpeg",
        buffer: jpeg,
      });
    await expect(cards).toHaveCount(count + 1);
    mealCreated = true;
    const meal = cards.first();
    await expect(meal.getByText("Logged", { exact: true })).toBeVisible();
    await expect(meal.getByLabel("Meal description")).toHaveValue(
      "Chicken rice bowl with broccoli",
    );
    await expect(meal.locator(".food-item")).toHaveCount(3);
    const kcal = meal.locator(".meal-total > .row > strong").last();
    const originalKcal = numberFromText(await kcal.innerText());
    expect(originalKcal).toBeGreaterThan(0);
    await expect(meal.locator(".source-link")).toHaveCount(3);
    const chicken = meal
      .locator(".food-item")
      .filter({
        has: page.getByRole("heading", { name: "Chicken", exact: true }),
      });
    await chicken.getByLabel("Grams").fill("240");
    await chicken.getByRole("button", { name: "Save", exact: true }).click();
    // The SR Legacy grilled chicken fixture has 151 kcal/100 g. Add 120 g.
    await expect(kcal).toHaveText(`${Math.round(originalKcal + 181.2)} kcal`);
    await meal.getByRole("button", { name: "Delete meal and photo" }).click();
    await expect(cards).toHaveCount(count);
    mealCreated = false;
    expect(errors).toEqual([]);
  } finally {
    if (mealCreated) {
      await openTab(page, "Meals");
      await page
        .getByRole("button", { name: "Delete meal and photo" })
        .first()
        .click();
    }
    if (workoutCreated) {
      await openTab(page, "Train");
      await page
        .locator("li")
        .filter({ hasText: note })
        .getByRole("button", { name: "Delete workout" })
        .click();
    }
    if (waterCreated) {
      await openTab(page, "Water");
      await page
        .getByRole("button", { name: "Delete 500 ml entry", exact: true })
        .first()
        .click();
    }
  }
});
