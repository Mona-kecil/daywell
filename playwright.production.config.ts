import { defineConfig } from "@playwright/test";
const port = process.env.DAYWELL_PRODUCTION_PORT ?? "3100";
const url = `http://localhost:${port}`;

export default defineConfig({
  testDir: "./e2e",
  testMatch: "production.spec.ts",
  workers: 1,
  outputDir: "artifacts/production",
  reporter: "list",
  use: { baseURL: url },
  webServer: {
    command: `pnpm start --port ${port}`,
    url,
    reuseExistingServer: false,
    env: { NODE_ENV: "production", DEV_AUTH: "1" },
    timeout: 60_000,
  },
});
