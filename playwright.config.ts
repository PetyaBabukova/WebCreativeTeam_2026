import { defineConfig, devices } from "@playwright/test";
import { appConfig, testOrigin } from "./lib/config";
export default defineConfig({
  testDir: "tests/e2e", fullyParallel: false, workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: { baseURL: testOrigin, trace: "retain-on-failure" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node dist/server/index.js",
    env: { NODE_ENV: "production", PORT: String(appConfig.testPort), SITE_URL: testOrigin },
    url: new URL(appConfig.paths.health, testOrigin).href, reuseExistingServer: false, timeout: 60000,
    gracefulShutdown: process.platform === "win32" ? undefined : { signal: "SIGTERM", timeout: 7000 },
  },
});
