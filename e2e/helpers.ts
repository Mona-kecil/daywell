import { expect, type Page } from "@playwright/test";

export async function signIn(page: Page) {
  await page.goto("/dev-login");
  await expect(
    page.getByRole("heading", { name: /Good (morning|afternoon|evening)|Still up/ }),
  ).toBeVisible();
  await expect(
    page.getByRole("navigation", { name: "Main navigation" }),
  ).toBeVisible();
}
export async function openTab(page: Page, name: string) {
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name, exact: true })
    .click();
  await expect(
    page.getByRole("navigation").getByRole("button", { name, exact: true }),
  ).toHaveAttribute("aria-current", "page");
}
export function numberFromText(text: string) {
  const match = text.replaceAll(",", "").match(/\d+/);
  if (!match) throw new Error(`No number in ${text}`);
  return Number(match[0]);
}
