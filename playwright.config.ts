import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: "smoke.spec.ts",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  outputDir: "artifacts/e2e",
  reporter: "list",
  use: {
    browserName: "chromium",
    baseURL: process.env.DAYWELL_URL ?? "http://localhost:3000",
    viewport: { width: 375, height: 812 },
    locale: "en-US",
    timezoneId: "Asia/Jakarta",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
