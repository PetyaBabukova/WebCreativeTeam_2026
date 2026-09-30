import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node", include: ["tests/backend/**/*.test.ts"],
    coverage: {
      provider: "v8", include: ["server/**/*.ts"],
      reporter: ["text", "html", "json-summary", "lcov"], reportsDirectory: "coverage/backend",
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 80 },
    },
  },
});
