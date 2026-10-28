import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { appConfig, testOrigin } from "../../lib/config.js";
import { createApp } from "../../server/app.js";
import { authConnection, closeAuthConnection } from "../../server/auth/db.js";
import { runAuthOperator } from "../../server/auth/operator.js";
import { isRecipientRejected } from "../../server/auth/outbox.js";
import { decideSubscription, drainNewsletterTestMailbox, newsletterConnection, normalizeNewsletterEmail, requestSubscription, reserveNewsletterDecisionIp, runNewsletterOutboxOnce } from "../../server/newsletter/service.js";
import request from "supertest";

describe("newsletter boundaries", () => {
  it("treats a permanent SMTP recipient refusal as final", () => {
    expect(isRecipientRejected({ code: "EENVELOPE", responseCode: 550, command: "RCPT TO" })).toBe(true);
    expect(isRecipientRejected({ code: "ECONNRESET" })).toBe(false);
  });

  it("uses one lower-case key for every casing and accepts IDNA domains", () => {
    expect(normalizeNewsletterEmail("  PetYa@Example.COM  ")).toBe("petya@example.com");
    expect(normalizeNewsletterEmail("PETYA@example.com")).toBe("petya@example.com");
    expect(normalizeNewsletterEmail("petya@bücher.de")).toBe("petya@xn--bcher-kva.de");
    for (const email of ["a..b@example.com", "a@invalid", "a@example.com.", "Име@example.com", "a@bad..example.com", "a@example.com\r\nBcc:x@example.com"]) {
      expect(() => normalizeNewsletterEmail(email)).toThrow();
    }
  });

  it("rejects cross-origin, missing consent and invalid decision tokens before database work", async () => {
    vi.stubEnv("SITE_URL", testOrigin);
    try {
      const app = createApp((_req, res) => { res.end("next"); }, () => true);
      const route = `${appConfig.paths.newsletterApi}/request`;
      await request(app).post(route).send({ email: "a@example.com", locale: "bg" }).expect(403);
      await request(app).post(route).set("Origin", testOrigin).send({ email: "a@example.com", locale: "bg", consentNews: false, consentPrivacy: true }).expect(400);
      await request(app).post(`${appConfig.paths.newsletterApi}/decision`).set("Origin", testOrigin).send({ action: "confirm", token: "bad" }).expect(400);
    } finally { vi.unstubAllEnvs(); }
  });

  it("isolates decision pages from referrers, caches and external CAPTCHA scripts", async () => {
    const app = createApp((_req, res) => { res.status(200).send("page"); }, () => true);
    const response = await request(app).get(appConfig.paths.newsletterConfirm + "/bg").set("Accept", "text/html").expect(200);
    expect(response.headers["referrer-policy"]).toBe("no-referrer");
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-robots-tag"]).toContain("noindex");
    const policy = String(response.headers["content-security-policy"] ?? response.headers["content-security-policy-report-only"]);
    expect(policy).toContain("connect-src 'self'");
    expect(policy).not.toContain("recaptcha");
  });

  it("caps repeated decision attempts from one IP before database work", () => {
    const bucket = `test-${randomBytes(8).toString("hex")}`;
    for (let attempt = 0; attempt < appConfig.newsletter.decisionMinuteLimit; attempt += 1) {
      expect(reserveNewsletterDecisionIp(bucket)).toBe(true);
    }
    expect(reserveNewsletterDecisionIp(bucket)).toBe(false);
  });
});

const integration = process.env.NEWSLETTER_TEST_MONGODB_URI ? describe : describe.skip;
integration("newsletter lifecycle with MongoDB", () => {
  const databaseName = `newsletter_test_${randomBytes(5).toString("hex")}`;
  beforeAll(async () => {
    const testUri = process.env.NEWSLETTER_TEST_MONGODB_URI;
    if (!testUri) throw new Error("Newsletter test database is unavailable");
    vi.stubEnv("SITE_URL", testOrigin);
    vi.stubEnv("AUTH_MONGODB_URI", testUri);
    vi.stubEnv("AUTH_DB_NAME", databaseName);
    vi.stubEnv("AUTH_OUTBOX_KEY", Buffer.alloc(32, 7).toString("base64"));
    vi.stubEnv("AUTH_OUTBOX_KEY_ID", "test-v1");
    vi.stubEnv("AUTH_MAIL_TRANSPORT", "test");
    await expect(newsletterConnection()).rejects.toThrow("Newsletter database is not prepared");
    const { db } = await authConnection();
    await db.createCollection(appConfig.newsletter.collections.subscriptions);
    await expect(runAuthOperator("prepare")).rejects.toThrow("Authentication database ownership marker missing");
    await db.dropCollection(appConfig.newsletter.collections.subscriptions);
    await runAuthOperator("prepare");
  });
  afterAll(async () => {
    try { const { db } = await newsletterConnection(); await db.dropDatabase(); } catch { /* Database may never have opened. */ }
    await closeAuthConnection();
    vi.unstubAllEnvs();
  });

  it("deletes declined requests immediately and preserves history after unsubscribe", async () => {
    const email = normalizeNewsletterEmail("PetYa@example.com");
    const { db } = await newsletterConnection();
    await runAuthOperator("prepare");
    await db.createCollection("unexpectedForOperatorTest");
    await expect(runAuthOperator("prepare")).rejects.toThrow("Database contains unexpected collections");
    await db.dropCollection("unexpectedForOperatorTest");
    await runAuthOperator("prepare");
    expect(await requestSubscription(email, "bg", "footer")).toBe("accepted");
    expect(await requestSubscription(normalizeNewsletterEmail("PETYA@example.com"), "en", "footer")).toBe("accepted");
    expect(await db.collection(appConfig.newsletter.collections.outbox).countDocuments({})).toBe(1);
    expect(await runNewsletterOutboxOnce()).toBe(true);
    const first = drainNewsletterTestMailbox()[0].text;
    const links = first.match(/https?:\/\/\S+/g) ?? [];
    expect(links).toHaveLength(2);
    const decline = new URL(links[1]!).hash.slice("#token=".length);
    expect(await decideSubscription("decline", decodeURIComponent(decline))).toBe("done");
    expect(await db.collection(appConfig.newsletter.collections.pending).countDocuments({ email })).toBe(0);
    expect(await requestSubscription(email, "bg", "contact")).toBe("accepted");
    expect(await runNewsletterOutboxOnce()).toBe(true);
    const second = drainNewsletterTestMailbox()[0].text.match(/https?:\/\/\S+/g) ?? [];
    const confirm = new URL(second[0]!).hash.slice("#token=".length);
    const unsubscribe = new URL(second[1]!).hash.slice("#token=".length);
    expect(await decideSubscription("confirm", decodeURIComponent(confirm))).toBe("done");
    expect(await decideSubscription("confirm", decodeURIComponent(confirm))).toBe("invalid");
    const approved = await db.collection(appConfig.newsletter.collections.subscriptions).findOne({ email });
    expect(approved?.status).toBe("approved");
    expect(await requestSubscription(email, "en", "footer")).toBe("accepted");
    expect(await runNewsletterOutboxOnce()).toBe(true);
    expect(drainNewsletterTestMailbox()[0].subject).toContain("WebCreativeTeam");
    expect(await requestSubscription(email, "en", "footer")).toBe("accepted");
    expect(await db.collection(appConfig.newsletter.collections.outbox).countDocuments({})).toBe(0);
    expect(await decideSubscription("decline", decodeURIComponent(unsubscribe))).toBe("done");
    const prior = await db.collection(appConfig.newsletter.collections.subscriptions).findOne({ email });
    expect(prior?.status).toBe("unsubscribed");
    expect(prior?.firstApprovedAt).toEqual(approved?.firstApprovedAt);
    expect(await requestSubscription(email, "en", "footer")).toBe("accepted");
    expect(await runNewsletterOutboxOnce()).toBe(true);
    const third = drainNewsletterTestMailbox()[0].text.match(/https?:\/\/\S+/g) ?? [];
    const declineAgain = new URL(third[1]!).hash.slice("#token=".length);
    expect(await decideSubscription("decline", decodeURIComponent(declineAgain))).toBe("done");
    expect(await db.collection(appConfig.newsletter.collections.subscriptions).findOne({ email })).toMatchObject({ status: "unsubscribed", firstApprovedAt: approved?.firstApprovedAt });
    expect(await db.collection(appConfig.newsletter.collections.pending).countDocuments({ email })).toBe(0);
    const previousClient = (await newsletterConnection()).client;
    await closeAuthConnection();
    expect((await newsletterConnection()).client).not.toBe(previousClient);
  });

  it("delivers queued mail after rotating the shared master key", async () => {
    const email = normalizeNewsletterEmail("rotate@example.com");
    expect(await requestSubscription(email, "en", "footer")).toBe("accepted");
    vi.stubEnv("AUTH_OUTBOX_KEY", Buffer.alloc(32, 8).toString("base64"));
    vi.stubEnv("AUTH_OUTBOX_KEY_ID", "test-v2");
    vi.stubEnv("AUTH_OUTBOX_PREVIOUS_KEY", Buffer.alloc(32, 7).toString("base64"));
    vi.stubEnv("AUTH_OUTBOX_PREVIOUS_KEY_ID", "test-v1");
    expect(await runNewsletterOutboxOnce()).toBe(true);
    const delivered = drainNewsletterTestMailbox();
    expect(delivered).toHaveLength(1);
    expect(delivered[0].to).toBe(email);
  });
});
