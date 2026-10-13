import { chromium, expect } from "@playwright/test";
import { mkdir, stat } from "node:fs/promises";
import { signIn, openTab } from "../e2e/helpers";

await mkdir("artifacts/shots", { recursive: true });
const browser = await chromium.launch();
try {
  for (const theme of ["light", "dark"] satisfies ("light" | "dark")[]) {
    const context = await browser.newContext({
      baseURL: process.env.DAYWELL_URL ?? "http://localhost:3000",
      viewport: { width: 375, height: 812 },
      colorScheme: theme,
      locale: "en-US",
      timezoneId: "Asia/Jakarta",
      isMobile: true,
      hasTouch: true,
    });
    try {
      const page = await context.newPage();
      await signIn(page);
      const tabs = await page
        .getByRole("navigation", { name: "Main navigation" })
        .getByRole("button")
        .allTextContents();
      for (const tab of tabs) {
        const name = tab.trim();
        await openTab(page, name);
        await expect(page.locator("main h1")).toBeVisible();
        if (name === "Train")
          await expect(
            page.getByRole("heading", { name: "Workout history" }),
          ).toBeVisible();
        await page.evaluate(async () => {
          await document.fonts.ready;
          await Promise.all(
            Array.from(document.images, (image) =>
              image.decode().catch(() => {}),
            ),
          );
        });
        const path = `artifacts/shots/${name.toLowerCase()}-${theme}.png`;
        await page.screenshot({
          path,
          fullPage: true,
          animations: "disabled",
          style: "nextjs-portal { display: none; }",
        });
        console.log(`${path}\t${(await stat(path)).size} bytes`);
      }
    } finally {
      await context.close();
    }
  }
} finally {
  await browser.close();
}
