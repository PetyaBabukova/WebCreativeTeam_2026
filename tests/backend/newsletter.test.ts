import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { appConfig, testOrigin } from "../../lib/config.js";
import { createApp } from "../../server/app.js";
import { authConnection, closeAuthConnection } from "../../server/auth/db.js";
import { runAuthOperator } from "../../server/auth/operator.js";
import { isRecipientRejected } from "../../server/auth/outbox.js";
import { decideSubscription, drainNewsletterTestMailbox, newsletterConnection, normalizeNewsletterEmail, requestSubscription, reserveNewsletterDecisionIp, reserveNewsletterIp, runNewsletterOutboxOnce } from "../../server/newsletter/service.js";
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
  const databaseName = `wct_2026_newsletter_test_${randomBytes(5).toString("hex")}`;
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
    await db.createCollection(appConfig.newsletter.collection);
    await expect(runAuthOperator("prepare")).rejects.toThrow("Authentication database ownership marker missing");
    await db.dropCollection(appConfig.newsletter.collection);
    await runAuthOperator("prepare");
    const control = db.collection<{ _id: string }>("adminControl");
    const authMarkerBefore = await control.findOne({ _id: "singleton" });
    await db.dropCollection(appConfig.newsletter.collection);
    for (const name of appConfig.newsletter.legacyCollections) await db.createCollection(name);
    await closeAuthConnection();
    await expect(newsletterConnection()).rejects.toThrow("Newsletter database is not prepared");
    await runAuthOperator("prepare-newsletter");
    const { db: preparedDb } = await authConnection();
    expect(await preparedDb.collection<{ _id: string }>("adminControl").findOne({ _id: "singleton" })).toEqual(authMarkerBefore);
    expect(await preparedDb.collection<{ _id: string }>(appConfig.newsletter.collection).findOne({ _id: "__newsletter_schema__" }))
      .toMatchObject({ recordType: "schema", schemaId: "wct-newsletter-v2" });
    for (const name of appConfig.newsletter.legacyCollections) {
      expect(await preparedDb.listCollections({ name }).hasNext()).toBe(false);
    }
  });
  afterAll(async () => {
    try { const { db } = await newsletterConnection(); await db.dropDatabase(); } catch { /* Database may never have opened. */ }
    await closeAuthConnection();
    vi.unstubAllEnvs();
  });

  it("does not prepare a foreign or unowned database", async () => {
    const foreignName = `foreign_newsletter_test_${randomBytes(5).toString("hex")}`;
    await closeAuthConnection();
    vi.stubEnv("AUTH_DB_NAME", foreignName);
    try {
      await expect(runAuthOperator("prepare-newsletter")).rejects.toThrow("Authentication database ownership marker missing");
      const { db } = await authConnection();
      expect(await db.listCollections().toArray()).toHaveLength(0);
      await runAuthOperator("prepare");
      const legacyName = appConfig.newsletter.legacyCollections[0];
      await db.createCollection(legacyName);
      await expect(runAuthOperator("prepare-newsletter")).rejects.toThrow("Legacy newsletter cleanup database mismatch");
      expect(await db.listCollections({ name: legacyName }).hasNext()).toBe(true);
      await db.dropDatabase();
    } finally {
      await closeAuthConnection();
      vi.stubEnv("AUTH_DB_NAME", databaseName);
    }
  });

  it("prepares only known newsletter collections and refuses a version mismatch", async () => {
    const { db } = await authConnection();
    const markers = db.collection<{ _id: string; schemaId: string }>(appConfig.newsletter.collection);
    const authMarkerBefore = await db.collection<{ _id: string }>("adminControl").findOne({ _id: "singleton" });
    await db.createCollection("unexpectedForNewsletterPrepareTest");
    await expect(runAuthOperator("prepare-newsletter")).rejects.toThrow("Database contains unexpected collections");
    await db.dropCollection("unexpectedForNewsletterPrepareTest");
    await markers.updateOne({ _id: "__newsletter_schema__" }, { $set: { schemaId: "wct-newsletter-v0" } });
    try {
      await expect(runAuthOperator("prepare-newsletter")).rejects.toThrow("Newsletter schema version mismatch");
      expect(await markers.findOne({ _id: "__newsletter_schema__" })).toMatchObject({ schemaId: "wct-newsletter-v0" });
    } finally {
      await markers.updateOne({ _id: "__newsletter_schema__" }, { $set: { schemaId: "wct-newsletter-v2" } });
    }
    await runAuthOperator("prepare-newsletter");
    await runAuthOperator("prepare-newsletter");
    expect(await db.collection<{ _id: string }>("adminControl").findOne({ _id: "singleton" })).toEqual(authMarkerBefore);
  });

  it("removes old newsletter collections only when every one is empty", async () => {
    const { db } = await authConnection();
    const second = appConfig.newsletter.legacyCollections[1];
    for (const name of appConfig.newsletter.legacyCollections) await db.createCollection(name);
    await db.collection<{ _id: string }>(second).insertOne({ _id: "keep" });
    await expect(runAuthOperator("prepare-newsletter")).rejects.toThrow("Legacy newsletter collection is not empty");
    expect(await db.listCollections({ name: appConfig.newsletter.legacyCollections[0] }).hasNext()).toBe(true);
    expect(await db.listCollections({ name: second }).hasNext()).toBe(true);
    await db.collection<{ _id: string }>(second).deleteOne({ _id: "keep" });
    await runAuthOperator("prepare-newsletter");
    for (const name of appConfig.newsletter.legacyCollections) {
      expect(await db.listCollections({ name }).hasNext()).toBe(false);
    }
    expect(await db.listCollections({ name: appConfig.newsletter.collection }).hasNext()).toBe(true);
  });

  it("keeps subscriber and pending uniqueness separate in one collection", async () => {
    const { db } = await authConnection();
    const records = db.collection(appConfig.newsletter.collection);
    const email = `index-${randomBytes(5).toString("hex")}@example.com`;
    try {
      await records.insertOne({ recordType: "pending", email });
      await records.insertOne({ recordType: "subscription", email });
      await expect(records.insertOne({ recordType: "pending", email })).rejects.toMatchObject({ code: 11000 });
      await expect(records.insertOne({ recordType: "subscription", email })).rejects.toMatchObject({ code: 11000 });
      const indexes = await records.listIndexes().toArray();
      expect(indexes.some((index) => index.name === "purgeAt_1" && index.expireAfterSeconds === 0)).toBe(true);
      expect(indexes.some((index) => index.name === "expiresAt_1" && index.expireAfterSeconds === 0)).toBe(true);
      expect(indexes.some((index) => index.name === "recordType_1_ownerId_1")).toBe(true);
      expect(indexes.find((index) => index.name === "subscription_email_unique")?.partialFilterExpression).toEqual({ recordType: "subscription" });
      expect(indexes.find((index) => index.name === "pending_email_unique")?.partialFilterExpression).toEqual({ recordType: "pending" });
    } finally {
      await records.deleteMany({ email });
    }
  });

  it("handles concurrent first IP attempts without a database error", async () => {
    const bucket = `new-${randomBytes(8).toString("hex")}`;
    const outcomes = await Promise.all(Array.from({ length: 20 }, () => reserveNewsletterIp(bucket)));
    expect(outcomes).not.toContain("unavailable");
    expect(outcomes).toContain("allowed");
  });

  it("keeps one pending request and one queued letter under concurrent submits", async () => {
    const { db } = await authConnection();
    const records = db.collection(appConfig.newsletter.collection);
    const email = `parallel-${randomBytes(5).toString("hex")}@example.com`;
    try {
      const outcomes = await Promise.all([requestSubscription(email, "bg", "footer"), requestSubscription(email, "bg", "contact")]);
      expect(outcomes).toEqual(["accepted", "accepted"]);
      const pending = await records.findOne({ recordType: "pending", email });
      expect(pending).toBeTruthy();
      expect(await records.countDocuments({ recordType: "pending", email })).toBe(1);
      expect(await records.countDocuments({ recordType: "outbox", ownerId: pending?._id })).toBe(1);
    } finally {
      const pending = await records.findOne({ recordType: "pending", email });
      if (pending) await records.deleteMany({ recordType: "outbox", ownerId: pending._id });
      await records.deleteMany({ recordType: "pending", email });
    }
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
    expect(await db.collection(appConfig.newsletter.collection).findOne({ email, recordType: "pending" }))
      .toMatchObject({ status: "pending_approval" });
    expect(await requestSubscription(normalizeNewsletterEmail("PETYA@example.com"), "en", "footer")).toBe("accepted");
    expect(await db.collection(appConfig.newsletter.collection).countDocuments({ recordType: "outbox" })).toBe(1);
    expect(await runNewsletterOutboxOnce()).toBe(true);
    const first = drainNewsletterTestMailbox()[0].text;
    expect(first).toContain("Потвърдете абонамента си:\n");
    expect(first).toContain("Отказ:\n");
    expect(first).not.toContain("Потвърдете до");
    const links = first.match(/https?:\/\/\S+/g) ?? [];
    expect(links).toHaveLength(2);
    const decline = new URL(links[1]!).hash.slice("#token=".length);
    expect(await decideSubscription("decline", decodeURIComponent(decline))).toBe("done");
    expect(await db.collection(appConfig.newsletter.collection).countDocuments({ email, recordType: "pending" })).toBe(0);
    expect(await requestSubscription(email, "bg", "contact")).toBe("accepted");
    expect(await runNewsletterOutboxOnce()).toBe(true);
    const second = drainNewsletterTestMailbox()[0].text.match(/https?:\/\/\S+/g) ?? [];
    const confirm = new URL(second[0]!).hash.slice("#token=".length);
    const unsubscribe = new URL(second[1]!).hash.slice("#token=".length);
    expect(await decideSubscription("confirm", decodeURIComponent(confirm))).toBe("done");
    expect(await decideSubscription("confirm", decodeURIComponent(confirm))).toBe("invalid");
    const approved = await db.collection(appConfig.newsletter.collection).findOne({ email, recordType: "subscription" });
    expect(approved?.status).toBe("approved");
    expect(await requestSubscription(email, "en", "footer")).toBe("accepted");
    expect(await runNewsletterOutboxOnce()).toBe(true);
    expect(drainNewsletterTestMailbox()[0].subject).toContain("WebCreativeTeam");
    expect(await requestSubscription(email, "en", "footer")).toBe("accepted");
    expect(await db.collection(appConfig.newsletter.collection).countDocuments({ recordType: "outbox" })).toBe(0);
    expect(await decideSubscription("decline", decodeURIComponent(unsubscribe))).toBe("done");
    const prior = await db.collection(appConfig.newsletter.collection).findOne({ email, recordType: "subscription" });
    expect(prior?.status).toBe("unsubscribed");
    expect(prior?.firstApprovedAt).toEqual(approved?.firstApprovedAt);
    expect(await requestSubscription(email, "en", "footer")).toBe("accepted");
    expect(await runNewsletterOutboxOnce()).toBe(true);
    const third = drainNewsletterTestMailbox()[0].text.match(/https?:\/\/\S+/g) ?? [];
    const declineAgain = new URL(third[1]!).hash.slice("#token=".length);
    expect(await decideSubscription("decline", decodeURIComponent(declineAgain))).toBe("done");
    expect(await db.collection(appConfig.newsletter.collection).findOne({ email, recordType: "subscription" })).toMatchObject({ status: "unsubscribed", firstApprovedAt: approved?.firstApprovedAt });
    expect(await db.collection(appConfig.newsletter.collection).countDocuments({ email, recordType: "pending" })).toBe(0);
    const previousClient = (await newsletterConnection()).client;
    await closeAuthConnection();
    expect((await newsletterConnection()).client).not.toBe(previousClient);
  });

  it("keeps status-mail unsubscribe links usable after 30 days and after another status mail", async () => {
    const email = `status-${randomBytes(5).toString("hex")}@example.test`;
    const { db } = await newsletterConnection();
    const records = db.collection(appConfig.newsletter.collection);
    expect(await requestSubscription(email, "en", "footer")).toBe("accepted");
    expect(await runNewsletterOutboxOnce()).toBe(true);
    const confirmation = drainNewsletterTestMailbox()[0].text;
    expect(confirmation).toContain("Confirm your subscription:\n");
    expect(confirmation).toContain("Decline:\n");
    expect(confirmation).not.toContain("Confirm by");
    const confirmLink = confirmation.match(/https?:\/\/\S+/g)?.[0];
    expect(confirmLink).toBeTruthy();
    const confirmToken = new URL(confirmLink!).hash.slice("#token=".length);
    expect(await decideSubscription("confirm", decodeURIComponent(confirmToken))).toBe("done");
    expect(await requestSubscription(email, "bg", "contact")).toBe("accepted");
    expect(await runNewsletterOutboxOnce()).toBe(true);
    const firstStatus = drainNewsletterTestMailbox()[0].text;
    expect(firstStatus).toContain("You're already subscribed");
    expect(firstStatus).not.toContain("within 30 days");
    const firstLink = firstStatus.match(/https?:\/\/\S+/g)?.[0];
    expect(firstLink).toBeTruthy();
    const firstToken = new URL(firstLink!).hash.slice("#token=".length);
    expect(await requestSubscription(email, "bg", "footer")).toBe("accepted");
    expect(await records.countDocuments({ recordType: "outbox", kind: "active-status" })).toBe(0);
    await records.updateOne({ email, recordType: "subscription" }, {
      $set: { statusNoticeAt: new Date(Date.now() - appConfig.newsletter.statusNoticeWaitMilliseconds - 60_000), "statusCancelTokens.0.expiresAt": new Date(Date.now() - 60_000) },
    });
    expect(await requestSubscription(email, "bg", "footer")).toBe("accepted");
    expect(await runNewsletterOutboxOnce()).toBe(true);
    const secondStatus = drainNewsletterTestMailbox()[0].text;
    const secondLink = secondStatus.match(/https?:\/\/\S+/g)?.[0];
    expect(secondLink).toBeTruthy();
    const secondToken = new URL(secondLink!).hash.slice("#token=".length);
    const record = await records.findOne({ email, recordType: "subscription" });
    expect(record?.statusCancelTokens).toHaveLength(2);
    expect(await decideSubscription("decline", decodeURIComponent(firstToken))).toBe("done");
    expect(await decideSubscription("decline", decodeURIComponent(secondToken))).toBe("invalid");
    expect(await records.findOne({ email, recordType: "subscription" })).toMatchObject({ status: "unsubscribed" });
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
