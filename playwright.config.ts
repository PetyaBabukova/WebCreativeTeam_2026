import { defineConfig, devices } from "@playwright/test";
import { appConfig, testOrigin } from "./lib/config";
export default defineConfig({
  testDir: "tests/e2e", fullyParallel: false, workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: testOrigin,
    trace: "retain-on-failure",
    // Existing journeys start after the first-visit choice; dedicated consent tests clear this cookie.
    storageState: { cookies: [{
      name: appConfig.cookieChoice.name,
      value: `${appConfig.cookieChoice.version}.all`,
      domain: new URL(testOrigin).hostname,
      path: appConfig.cookieChoice.path,
      expires: -1,
      httpOnly: false,
      secure: false,
      sameSite: "Lax",
    }], origins: [] },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "node dist/server/index.js",
    env: { NODE_ENV: "production", PORT: String(appConfig.testPort), SITE_URL: testOrigin, AUTH_CSP_ENFORCE: "1", AUTH_MONGODB_URI: "" },
    url: new URL(appConfig.paths.health, testOrigin).href, reuseExistingServer: false, timeout: 60000,
    gracefulShutdown: process.platform === "win32" ? undefined : { signal: "SIGTERM", timeout: 7000 },
  },
});
