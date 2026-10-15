import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["tests/**/*.test.{ts,tsx}"],
    // convex-test suites seed months of history and pass alone in ~2 s, but a
    // full parallel run on a laptop can push them past the 5 s default.
    testTimeout: 15_000,
  },
});
