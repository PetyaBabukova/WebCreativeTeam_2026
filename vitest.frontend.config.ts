import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    environment: "jsdom", include: ["tests/frontend/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/frontend/setup.ts"],
    coverage: {
      provider: "v8", include: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "lib/**/*.{ts,tsx}"],
      reporter: ["text", "html", "json-summary", "lcov"], reportsDirectory: "coverage/frontend",
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 80 },
    },
  },
});
