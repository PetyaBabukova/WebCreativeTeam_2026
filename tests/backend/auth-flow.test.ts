import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../../server/app.js";
import { authCollections, authConnection, closeAuthConnection, createAuthIndexes, ensureAdminControl, transitionAdminStatus } from "../../server/auth/db.js";
import { bootstrapOwner, deleteAdministrator, requestPasswordReset, requestReactivation } from "../../server/auth/service.js";
import { recoverOwner } from "../../server/auth/service.js";
import { ObjectId } from "mongodb";
import { drainTestMailbox, queueMail, runOutboxOnce } from "../../server/auth/outbox.js";
import { createSession, tokenHash } from "../../server/auth/security.js";

const integration = process.env.AUTH_TEST_MONGODB_URI ? describe : describe.skip;

integration("administrator invitation, sign in, and sign out", () => {
  const app = createApp((_req, res) => { res.status(404).end(); }, () => true);
  const origin = "http://localhost:3000";
  let databaseName: string;

  async function nextLink(path?: string) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (!await runOutboxOnce()) break;
      const link = drainTestMailbox().map((mail) => mail.text.match(/https?:\/\/\S+/)?.[0]).find((value) => value && (!path || new URL(value).pathname === path));
      if (link) return link;
    }
    throw new Error("No test mail link");
  }

  beforeAll(async () => {
    databaseName = `wct_auth_flow_${randomBytes(6).toString("hex")}`;
    process.env.AUTH_MONGODB_URI = process.env.AUTH_TEST_MONGODB_URI;
    process.env.AUTH_DB_NAME = databaseName;
    process.env.AUTH_OUTBOX_KEY = randomBytes(32).toString("base64");
    process.env.AUTH_MAIL_TRANSPORT = "test";
    process.env.SITE_URL = origin;
    const { db } = await authConnection();
    await createAuthIndexes(db);
    await ensureAdminControl(db);
  });

  afterAll(async () => {
    if (databaseName) {
      const { db } = await authConnection();
      await db.dropDatabase();
      await closeAuthConnection();
    }
    delete process.env.AUTH_MONGODB_URI;
    delete process.env.AUTH_DB_NAME;
    delete process.env.AUTH_OUTBOX_KEY;
    delete process.env.AUTH_MAIL_TRANSPORT;
    delete process.env.SITE_URL;
  });

  it("keeps a public status anonymous without a cookie", async () => {
    const response = await request(app).get("/api/auth/status").expect(200);
    expect(response.body).toEqual({ authenticated: false });
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect(response.headers.vary).toBe("Cookie");
  });

  it("creates one owner via a private invitation and invalidates the session on logout", async () => {
    await bootstrapOwner("owner@example.test");
    await expect(bootstrapOwner("other@example.test")).rejects.toThrow();
    const raw = new URL(await nextLink()).hash.slice("#token=".length);
    const password = "correct horse battery staple";
    await request(app).post("/api/auth/token/check").set("Origin", origin).send({ kind: "bootstrap", token: raw }).expect(200, { valid: true, email: "owner@example.test" });
    await request(app).post("/api/auth/invite/accept").set("Origin", origin).send({ token: raw, username: "Owner", password }).expect(200);
    await request(app).post("/api/auth/invite/accept").set("Origin", origin).send({ token: raw, username: "Owner", password }).expect(400);
    await expect(bootstrapOwner("owner@example.test")).rejects.toThrow();
    await request(app).post("/api/auth/login").set("Origin", "http://evil.test").send({ email: "owner@example.test", password }).expect(403);
    const signedIn = await request(app).post("/api/auth/login").set("Origin", origin).send({ email: "owner@example.test", password }).expect(200);
    const cookie = signedIn.headers["set-cookie"]?.[0]?.split(";")[0];
    expect(cookie).toMatch(/^wct_admin_dev=/);
    const status = await request(app).get("/api/auth/status").set("Cookie", cookie).expect(200);
    expect(status.body).toMatchObject({ authenticated: true, username: "Owner" });
    await request(app).post("/api/auth/logout").set("Origin", origin).set("Cookie", cookie).set("x-csrf-token", status.body.logoutCsrf).expect(200);
    await request(app).get("/api/auth/status").set("Cookie", cookie).expect(200, { authenticated: false });
  });

  it("keeps equal administrators independent and revokes invitations from a disabled inviter", async () => {
    const password = "correct horse battery staple";
    const ownerLogin = await request(app).post("/api/auth/login").set("Origin", origin).send({ email: "owner@example.test", password }).expect(200);
    const ownerCookie = ownerLogin.headers["set-cookie"][0].split(";")[0];
    const ownerMe = await request(app).get("/api/auth/me").set("Cookie", ownerCookie).expect(200);
    await request(app).post("/api/auth/invite").set("Origin", origin).set("Cookie", ownerCookie).set("x-csrf-token", ownerMe.body.csrf).send({ email: "partner@example.test", currentPassword: password }).expect(200);
    const partnerLink = await nextLink();
    await request(app).post("/api/auth/invite/accept").set("Origin", origin).send({ token: new URL(partnerLink).hash.slice(7), username: "Partner", password }).expect(200);
    const partnerLogin = await request(app).post("/api/auth/login").set("Origin", origin).send({ email: "partner@example.test", password }).expect(200);
    const partnerCookie = partnerLogin.headers["set-cookie"][0].split(";")[0];
    const partnerMe = await request(app).get("/api/auth/me").set("Cookie", partnerCookie).expect(200);
    await request(app).post("/api/auth/invite").set("Origin", origin).set("Cookie", ownerCookie).set("x-csrf-token", ownerMe.body.csrf).send({ email: "stale@example.test", currentPassword: password }).expect(200);
    const staleLink = await nextLink();
    await request(app).post("/api/auth/administrators/disable").set("Origin", origin).set("Cookie", partnerCookie).set("x-csrf-token", partnerMe.body.csrf).send({ id: ownerMe.body.id, currentPassword: password }).expect(200);
    await request(app).post("/api/auth/invite/accept").set("Origin", origin).send({ token: new URL(staleLink).hash.slice(7), username: "Stale", password }).expect(400);
    await request(app).get("/api/auth/me").set("Cookie", ownerCookie).expect(401);
    await request(app).get("/api/auth/me").set("Cookie", partnerCookie).expect(200);
    await request(app).post("/api/auth/administrators/disable").set("Origin", origin).set("Cookie", partnerCookie).set("x-csrf-token", partnerMe.body.csrf).send({ id: partnerMe.body.id, currentPassword: password }).expect(409);
  });

  it("confirms a new email, resets a password, and permanently removes a disabled account", async () => {
    const password = "correct horse battery staple";
    const nextPassword = "an even longer replacement password";
    const oldLogin = await request(app).post("/api/auth/login").set("Origin", origin).send({ email: "partner@example.test", password }).expect(200);
    const oldCookie = oldLogin.headers["set-cookie"][0].split(";")[0];
    const oldMe = await request(app).get("/api/auth/me").set("Cookie", oldCookie).expect(200);
    await request(app).post("/api/auth/email/change").set("Origin", origin).set("Cookie", oldCookie).set("x-csrf-token", oldMe.body.csrf).send({ email: "new@example.test", currentPassword: password }).expect(200);
    const emailLink = await nextLink();
    await request(app).post("/api/auth/email/confirm").set("Origin", origin).send({ token: new URL(emailLink).hash.slice(7) }).expect(200);
    const { db: mailDb } = await authConnection();
    expect(await authCollections(mailDb).outbox.countDocuments({ recipientHash: tokenHash("partner@example.test") })).toBeGreaterThan(0);
    await request(app).get("/api/auth/me").set("Cookie", oldCookie).expect(401);
    await request(app).post("/api/auth/login").set("Origin", origin).send({ email: "partner@example.test", password }).expect(401);
    await request(app).post("/api/auth/forgot").set("Origin", origin).send({ email: "missing@example.test" }).expect(200, { ok: true });
    await request(app).post("/api/auth/forgot").set("Origin", origin).send({ email: "new@example.test" }).expect(200, { ok: true });
    const resetLink = await nextLink();
    await request(app).post("/api/auth/reset").set("Origin", origin).send({ token: new URL(resetLink).hash.slice(7), password: nextPassword }).expect(200);
    await request(app).post("/api/auth/reset").set("Origin", origin).send({ token: new URL(resetLink).hash.slice(7), password: nextPassword }).expect(400);
    const partnerLogin = await request(app).post("/api/auth/login").set("Origin", origin).send({ email: "new@example.test", password: nextPassword }).expect(200);
    const partnerCookie = partnerLogin.headers["set-cookie"][0].split(";")[0];
    const partnerMe = await request(app).get("/api/auth/me").set("Cookie", partnerCookie).expect(200);
    await request(app).post("/api/auth/invite").set("Origin", origin).set("Cookie", partnerCookie).set("x-csrf-token", partnerMe.body.csrf).send({ email: "temporary@example.test", currentPassword: nextPassword }).expect(200);
    const inviteLink = await nextLink();
    await request(app).post("/api/auth/invite/accept").set("Origin", origin).send({ token: new URL(inviteLink).hash.slice(7), username: "Temporary", password }).expect(200);
    const listing = await request(app).get("/api/auth/administrators").set("Cookie", partnerCookie).expect(200);
    const temporary = listing.body.administrators.find((item: { email: string }) => item.email === "temporary@example.test");
    await request(app).post("/api/auth/administrators/disable").set("Origin", origin).set("Cookie", partnerCookie).set("x-csrf-token", partnerMe.body.csrf).send({ id: temporary.id, currentPassword: nextPassword }).expect(200);
    await queueMail({ to: "temporary@example.test", subject: "Pending notification", text: "Pending notification" });
    await request(app).post("/api/auth/administrators/delete").set("Origin", origin).set("Cookie", partnerCookie).set("x-csrf-token", partnerMe.body.csrf).send({ id: temporary.id, confirmation: "wrong@example.test", currentPassword: nextPassword }).expect(400);
    await request(app).post("/api/auth/administrators/delete").set("Origin", origin).set("Cookie", partnerCookie).set("x-csrf-token", partnerMe.body.csrf).send({ id: temporary.id, confirmation: "temporary@example.test", currentPassword: nextPassword }).expect(200);
    const after = await request(app).get("/api/auth/administrators").set("Cookie", partnerCookie).expect(200);
    expect(after.body.administrators.some((item: { id: string }) => item.id === temporary.id)).toBe(false);
    const { db } = await authConnection();
    const deletedId = new ObjectId(temporary.id);
    expect(await authCollections(db).outbox.countDocuments({ recipientHash: tokenHash("temporary@example.test") })).toBe(0);
    expect(await authCollections(db).audit.countDocuments({ $or: [{ actorId: deletedId }, { targetId: deletedId }] })).toBe(0);
    expect(await authCollections(db).audit.countDocuments({ kind: "administrator-deleted" })).toBeGreaterThan(0);
  });

  it("reactivates by email and lets a verified operator recover the original owner", async () => {
    const partnerPassword = "an even longer replacement password";
    const ownerPassword = "a newly assigned owner password";
    const recoveredPassword = "a completely different owner password";
    const login = await request(app).post("/api/auth/login").set("Origin", origin).send({ email: "new@example.test", password: partnerPassword }).expect(200);
    const cookie = login.headers["set-cookie"][0].split(";")[0];
    const me = await request(app).get("/api/auth/me").set("Cookie", cookie).expect(200);
    const records = await request(app).get("/api/auth/administrators").set("Cookie", cookie).expect(200);
    const owner = records.body.administrators.find((item: { email: string }) => item.email === "owner@example.test");
    await request(app).post("/api/auth/administrators/reactivate").set("Origin", origin).set("Cookie", cookie).set("x-csrf-token", me.body.csrf).send({ id: owner.id, currentPassword: partnerPassword }).expect(200);
    const link = await nextLink();
    await request(app).post("/api/auth/reactivate/accept").set("Origin", origin).send({ token: new URL(link).hash.slice(7), password: ownerPassword }).expect(200);
    await request(app).post("/api/auth/login").set("Origin", origin).send({ email: "owner@example.test", password: ownerPassword }).expect(200);
    const connection = await authConnection();
    const staleActor = await authCollections(connection.db).users.findOne({ _id: new ObjectId(me.body.id) });
    expect(staleActor).toBeTruthy();
    const report = await recoverOwner("recovered@example.test", [new ObjectId(me.body.id)]);
    expect(report.createdIds).toEqual([]);
    await expect(requestReactivation(new ObjectId(me.body.id), staleActor!)).rejects.toThrow();
    await expect(deleteAdministrator(new ObjectId(me.body.id), "new@example.test", staleActor!)).rejects.toThrow();
    await expect(transitionAdminStatus(connection, new ObjectId(owner.id), "active", "disabled", staleActor!)).rejects.toThrow();
    await request(app).get("/api/auth/me").set("Cookie", cookie).expect(401);
    await request(app).post("/api/auth/login").set("Origin", origin).send({ email: "owner@example.test", password: ownerPassword }).expect(401);
    const resetLink = await nextLink();
    await request(app).post("/api/auth/reset").set("Origin", origin).send({ token: new URL(resetLink).hash.slice(7), password: recoveredPassword }).expect(200);
    await request(app).post("/api/auth/login").set("Origin", origin).send({ email: "recovered@example.test", password: recoveredPassword }).expect(200);
  });

  it("keeps only one reset token when requests race", async () => {
    const results = await Promise.allSettled([
      requestPasswordReset("recovered@example.test"),
      requestPasswordReset("recovered@example.test"),
    ]);
    expect(results.every((item) => item.status === "fulfilled")).toBe(true);
    const { db } = await authConnection();
    const active = await db.collection("authTokens").countDocuments({ kind: "reset", email: "recovered@example.test", consumedAt: { $exists: false } });
    expect(active).toBe(1);
  });

  it("rejects a session inserted after password rotation with a stale generation", async () => {
    const password = "a completely different owner password";
    const login = await request(app).post("/api/auth/login").set("Origin", origin).send({ email: "recovered@example.test", password }).expect(200);
    const oldCookie = login.headers["set-cookie"][0].split(";")[0];
    const me = await request(app).get("/api/auth/me").set("Cookie", oldCookie).expect(200);
    const { db } = await authConnection();
    const owner = await authCollections(db).users.findOne({ _id: new ObjectId(me.body.id) });
    expect(owner).toBeTruthy();
    await request(app).post("/api/auth/email/change").set("Origin", origin).set("Cookie", oldCookie).set("x-csrf-token", me.body.csrf)
      .send({ email: "attacker-one@example.test", currentPassword: password }).expect(200);
    const firstEmailToken = new URL(await nextLink("/admin/email")).hash.slice(7);
    const changed = await request(app).post("/api/auth/password/change").set("Origin", origin).set("Cookie", oldCookie).set("x-csrf-token", me.body.csrf)
      .send({ currentPassword: password, newPassword: "another secure owner password" }).expect(200);
    await request(app).post("/api/auth/email/confirm").set("Origin", origin).send({ token: firstEmailToken }).expect(400);
    const newCookie = changed.headers["set-cookie"][0].split(";")[0];
    await request(app).get("/api/auth/me").set("Cookie", oldCookie).expect(401);
    await request(app).get("/api/auth/me").set("Cookie", newCookie).expect(200);
    const staleRaw = await createSession(owner!._id, owner!.authGeneration, "stale login race");
    await request(app).get("/api/auth/me").set("Cookie", `wct_admin_dev=${staleRaw}`).expect(401);
    const fresh = await request(app).get("/api/auth/me").set("Cookie", newCookie).expect(200);
    const beforeRevoke = await authCollections(db).users.findOne({ _id: owner!._id });
    await request(app).post("/api/auth/email/change").set("Origin", origin).set("Cookie", newCookie).set("x-csrf-token", fresh.body.csrf)
      .send({ email: "attacker-two@example.test", currentPassword: "another secure owner password" }).expect(200);
    const secondEmailToken = new URL(await nextLink("/admin/email")).hash.slice(7);
    await request(app).post("/api/auth/sessions/revoke-all").set("Origin", origin).set("Cookie", newCookie).set("x-csrf-token", fresh.body.csrf)
      .send({ currentPassword: "another secure owner password" }).expect(200);
    await request(app).post("/api/auth/email/confirm").set("Origin", origin).send({ token: secondEmailToken }).expect(400);
    const lateRaw = await createSession(owner!._id, beforeRevoke!.authGeneration, "late concurrent login");
    await request(app).get("/api/auth/me").set("Cookie", `wct_admin_dev=${lateRaw}`).expect(401);
    const nextLogin = await request(app).post("/api/auth/login").set("Origin", origin)
      .send({ email: "recovered@example.test", password: "another secure owner password" }).expect(200);
    const nextCookie = nextLogin.headers["set-cookie"][0].split(";")[0];
    const nextMe = await request(app).get("/api/auth/me").set("Cookie", nextCookie).expect(200);
    await request(app).post("/api/auth/email/change").set("Origin", origin).set("Cookie", nextCookie).set("x-csrf-token", nextMe.body.csrf)
      .send({ email: "attacker-three@example.test", currentPassword: "another secure owner password" }).expect(200);
    const thirdEmailToken = new URL(await nextLink("/admin/email")).hash.slice(7);
    await request(app).post("/api/auth/forgot").set("Origin", origin).send({ email: "recovered@example.test" }).expect(200);
    const resetToken = new URL(await nextLink("/admin/reset")).hash.slice(7);
    await request(app).post("/api/auth/reset").set("Origin", origin)
      .send({ token: resetToken, password: "another replacement owner password" }).expect(200);
    await request(app).post("/api/auth/email/confirm").set("Origin", origin).send({ token: thirdEmailToken }).expect(400);
  });
});
