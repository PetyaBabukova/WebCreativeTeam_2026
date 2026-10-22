import { expect, test } from "@playwright/test";

test("anonymous visitors see a compact sign-in form and cannot open private pages", async ({ page }) => {
  await page.goto("/admin/login");
  await expect(page.getByRole("heading", { name: "Вход" })).toBeVisible();
  await expect(page.getByLabel("Имейл")).toBeVisible();
  await expect(page.getByLabel("Парола", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Забравена парола?" })).toBeVisible();
  await page.goto("/admin/profile");
  await expect(page).toHaveURL(/\/admin\/login\?returnTo=/);
  await expect(page.getByRole("heading", { name: "Вход" })).toBeVisible();
});

test("English sign-in keeps labels and mobile layout readable", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/admin/en/login");
  await expect(page.getByRole("heading", { name: "Sign in" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  const panel = page.locator(".auth-panel");
  const bounds = await panel.boundingBox();
  expect(bounds).not.toBeNull();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
});

for (const { status, message } of [
  { status: 429, message: "Твърде много опити." },
  { status: 503, message: "Услугата е временно недостъпна." },
]) {
  test(`invitation check shows the actual ${status} error`, async ({ page }) => {
    const kinds: string[] = [];
    await page.route("**/api/auth/token/check", (route) => {
      kinds.push(route.request().postDataJSON().kind);
      return route.fulfill({ status, contentType: "application/json", body: "{}" });
    });
    await page.goto(`/admin/invite#token=${"A".repeat(43)}`);
    await expect(page.locator(".auth-panel p[role=alert]:visible")).toContainText(message);
    await expect(page.getByText("Връзката е невалидна или изтекла.")).toHaveCount(0);
    expect([...new Set(kinds)]).toEqual(["bootstrap"]);
  });
}

test("invitation check reports invalid only after all token kinds are checked", async ({ page }) => {
  const kinds: string[] = [];
  await page.route("**/api/auth/token/check", (route) => {
    kinds.push(route.request().postDataJSON().kind);
    return route.fulfill({ status: 200, contentType: "application/json", body: '{"valid":false}' });
  });
  await page.goto(`/admin/invite#token=${"A".repeat(43)}`);
  await expect(page.locator(".auth-panel p[role=alert]:visible")).toHaveText("Връзката е невалидна или изтекла.");
  expect([...new Set(kinds)]).toEqual(["bootstrap", "invitation", "reactivation"]);
});

test("invitation check reports a malformed response as temporary", async ({ page }) => {
  await page.route("**/api/auth/token/check", (route) => route.fulfill({ status: 200, contentType: "application/json", body: "{}" }));
  await page.goto(`/admin/invite#token=${"B".repeat(43)}`);
  await expect(page.locator(".auth-panel p[role=alert]:visible")).toContainText("Услугата е временно недостъпна.");
});

test("invitation check reports a network failure as temporary", async ({ page }) => {
  await page.route("**/api/auth/token/check", (route) => route.abort("failed"));
  await page.goto(`/admin/invite#token=${"A".repeat(43)}`);
  await expect(page.locator(".auth-panel p[role=alert]:visible")).toContainText("Услугата е временно недостъпна.");
});

test("public header stays anonymous while status is unauthenticated", async ({ page }) => {
  await page.goto("/faq/bg");
  await expect(page.locator(".site-header .site-auth")).toHaveCount(0);
  const status = await page.request.get("/api/auth/status");
  expect(status.status()).toBe(200);
  expect(await status.json()).toEqual({ authenticated: false });
  expect(status.headers()["cache-control"]).toBe("private, no-store");
  expect(status.headers()["content-security-policy"]).toContain("script-src");
});

test("sign-in page does not report script policy violations", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (message) => { if (message.text().includes("Content Security Policy") && message.text().includes("script-src")) violations.push(message.text()); });
  await page.goto("/admin/login");
  await expect(page.getByRole("heading", { name: "Вход" })).toBeVisible();
  expect(violations).toEqual([]);
});

test("public page scripts comply with the same policy", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (message) => { if (message.text().includes("Content Security Policy") && message.text().includes("script-src")) violations.push(message.text()); });
  for (const path of ["/bg", "/faq/bg", "/services/ai-automation/bg"]) {
    await page.goto(path);
    await expect(page.locator("main").first()).toBeVisible();
  }
  expect(violations).toEqual([]);
});
