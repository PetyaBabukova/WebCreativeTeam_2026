import express, { type Request, type Response } from "express";
import { ObjectId } from "mongodb";
import { appConfig } from "../../lib/config.ts";
import { AdminTransitionError, authCollections, authConnection, transitionAdminStatus, type AdminUser } from "./db.ts";
import { acceptInvitation, acceptReactivation, audit, AuthFlowError, cancelInvitation, completePasswordReset, confirmEmailChange, deleteAdministrator, inviteAdministrator, notifyAdministrators, requestEmailChange, requestPasswordReset, requestReactivation, revokeUserTokens, validateOneTimeToken } from "./service.ts";
import { hashPassword, verifyPassword, verifyUnknownPassword } from "./password.ts";
import {
  assertRecentReauth, clearSessionCookie, clientIpBucket, createSession, csrfToken, enforceLimit, hasRecentReauth, isSessionCurrent, normalizeEmail, privateResponse, randomToken, ReauthRequiredError, tokenHash,
  readSessionCookie, resetLimit, setSessionCookie, validCsrf, validOrigin, validateUsername,
  verifySession, type VerifiedSession,
} from "./security.ts";

export const authRouter = express.Router();
authRouter.use((_req, res, next) => { privateResponse(res); next(); });
authRouter.use(express.json({ limit: "8kb" }));

function fail(res: Response, status: number, message: string) { res.status(status).json({ error: message }); }
class InputError extends Error {}
function bodyString(req: Request, field: string): string {
  const value: unknown = req.body?.[field];
  if (typeof value !== "string") throw new InputError();
  return value;
}

function safeRoute(handler: (req: Request, res: Response) => Promise<void>) {
  return (req: Request, res: Response) => { void handler(req, res).catch((error: unknown) => {
    if (res.headersSent) return;
    if (error instanceof InputError) { fail(res, 400, "Invalid input"); return; }
    if (error instanceof ReauthRequiredError) { fail(res, 428, "reauth_required"); return; }
    if (error instanceof AuthFlowError) { fail(res, 409, "Account changed; try again"); return; }
    console.error("Authentication request failed", { name: error instanceof Error ? error.name : "Unknown" });
    fail(res, 503, "Authentication temporarily unavailable");
  }); };
}

function requireOrigin(req: Request, res: Response): boolean {
  if (!validOrigin(req) || (req.get("sec-fetch-site") && !["same-origin", "none"].includes(req.get("sec-fetch-site")!))) {
    fail(res, 403, "Forbidden"); return false;
  }
  return true;
}

async function current(req: Request, res: Response, purpose: "logout" | "private" = "private"): Promise<VerifiedSession | null> {
  const verified = await verifySession(req, purpose === "private");
  if (!verified) { fail(res, 401, "Sign in required"); return null; }
  if (!validCsrf(verified.session, purpose, req.get("x-csrf-token"))) { fail(res, 403, "Forbidden"); return null; }
  return verified;
}

async function recheckPassword(req: Request, res: Response, user: AdminUser): Promise<boolean> {
  const accountKey = `reauth:${user._id}:${clientIpBucket(req.ip)}`;
  if (!await enforceLimit(accountKey, appConfig.auth.sensitiveLimit) || !await enforceLimit(`reauth-ip:${clientIpBucket(req.ip)}`, appConfig.auth.sensitiveLimit * 3)) {
    fail(res, 429, "Too many attempts"); return false;
  }
  const password = bodyString(req, "currentPassword");
  if (!await verifyPassword(user.passwordHash, password.normalize("NFC"))) { fail(res, 403, "Invalid password"); return false; }
  await resetLimit(accountKey);
  await resetLimit(`reauth-ip:${clientIpBucket(req.ip)}`);
  return true;
}

function requireRecentReauth(verified: VerifiedSession, res: Response): boolean {
  if (hasRecentReauth(verified.session)) return true;
  fail(res, 428, "reauth_required");
  return false;
}

authRouter.post("/reauth", safeRoute(async (req, res) => {
  if (!requireOrigin(req, res)) return;
  const verified = await current(req, res);
  if (!verified || !await recheckPassword(req, res, verified.user)) return;
  const { client, db } = await authConnection();
  const { users, sessions } = authCollections(db);
  const transaction = client.startSession();
  let rotated: { raw: string; session: typeof verified.session } | undefined;
  try {
    rotated = await transaction.withTransaction(async () => {
      const now = new Date();
      const actor = await users.updateOne({ _id: verified.user._id, status: "active", authGeneration: verified.session.authGeneration, passwordHash: verified.user.passwordHash }, { $inc: { authorizationSerial: 1 } }, { session: transaction });
      if (actor.modifiedCount !== 1) throw new AuthFlowError("Account changed");
      const old = await sessions.deleteOne({ _id: verified.session._id, userId: verified.user._id, authGeneration: verified.session.authGeneration, absoluteExpiresAt: { $gt: now }, idleExpiresAt: { $gt: now }, createdAt: { $gt: new Date(now.getTime() - appConfig.auth.absoluteSeconds * 1000) } }, { session: transaction });
      if (old.deletedCount !== 1) throw new AuthFlowError("Session changed");
      const raw = randomToken();
      const session = { ...verified.session, _id: tokenHash(raw), csrfSecret: randomToken(), lastSeenAt: now,
        idleExpiresAt: new Date(Math.min(now.getTime() + appConfig.auth.idleSeconds * 1000, verified.session.absoluteExpiresAt.getTime(), verified.session.createdAt.getTime() + appConfig.auth.absoluteSeconds * 1000)),
        reauthUntil: new Date(Math.min(now.getTime() + appConfig.auth.reauthSeconds * 1000, verified.session.absoluteExpiresAt.getTime(), verified.session.createdAt.getTime() + appConfig.auth.absoluteSeconds * 1000)) };
      await sessions.insertOne(session, { session: transaction });
      await audit("session-reauth", "success", verified.user._id, verified.user._id, transaction);
      return { raw, session };
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary", timeoutMS: 10_000 });
  } finally { await transaction.endSession(); }
  if (!rotated) throw new AuthFlowError("Session changed");
  const remaining = Math.min(rotated.session.absoluteExpiresAt.getTime(), rotated.session.createdAt.getTime() + appConfig.auth.absoluteSeconds * 1000) - Date.now();
  setSessionCookie(res, rotated.raw, Math.max(1, remaining));
  res.json({ csrf: csrfToken(rotated.session, "private") });
}));

authRouter.get("/status", safeRoute(async (req, res) => {
  const raw = readSessionCookie(req);
  if (!raw) { res.json({ authenticated: false }); return; }
  if (!await enforceLimit(`status:${clientIpBucket(req.ip)}`, 200)) { fail(res, 429, "Too many attempts"); return; }
  const verified = await verifySession(req);
  if (!verified) { res.json({ authenticated: false }); return; }
  res.json({ authenticated: true, username: verified.user.username, logoutCsrf: csrfToken(verified.session, "logout") });
}));

authRouter.get("/csrf", safeRoute(async (req, res) => {
  const verified = await verifySession(req);
  if (!verified) { fail(res, 401, "Sign in required"); return; }
  res.json({ csrf: csrfToken(verified.session, "private") });
}));

authRouter.post("/login", safeRoute(async (req, res) => {
  if (!requireOrigin(req, res)) return;
  let email: string;
  let password: string;
  try { email = normalizeEmail(bodyString(req, "email")); password = bodyString(req, "password").normalize("NFC"); } catch { fail(res, 400, "Invalid input"); return; }
  if (Buffer.byteLength(password, "utf8") > appConfig.auth.passwordMaxLength) { fail(res, 400, "Invalid input"); return; }
  if (!await enforceLimit(`login-ip:${clientIpBucket(req.ip)}`, appConfig.auth.loginLimit * 3) || !await enforceLimit(`login-account-ip:${email}:${clientIpBucket(req.ip)}`, appConfig.auth.loginLimit)) { fail(res, 429, "Too many attempts"); return; }
  const { client, db } = await authConnection();
  const user = await authCollections(db).users.findOne({ email, status: "active" }, { collation: { locale: "en", strength: 2 } });
  const valid = user ? await verifyPassword(user.passwordHash, password) : (await verifyUnknownPassword(password), false);
  if (!valid || !user) {
    const allowed = await enforceLimit(`login-account:${email}`, appConfig.auth.loginLimit * 8);
    await audit("login", "failure");
    if (!allowed) await new Promise((resolve) => setTimeout(resolve, 1_000));
    fail(res, allowed ? 401 : 429, allowed ? "Invalid email or password" : "Too many attempts");
    return;
  }
  const transaction = client.startSession();
  let raw: string | undefined;
  try {
    raw = await transaction.withTransaction(async () => {
      const nextSession = await createSession(user._id, user.authGeneration, req.get("user-agent") ?? "Unknown device", transaction);
      await audit("login", "success", user._id, user._id, transaction);
      return nextSession;
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary", timeoutMS: 10_000 });
  } finally { await transaction.endSession(); }
  if (!raw) throw new Error("Session creation failed");
  await Promise.allSettled([resetLimit(`login-account-ip:${email}:${clientIpBucket(req.ip)}`)]);
  setSessionCookie(res, raw);
  res.json({ username: user.username });
}));

authRouter.post("/logout", safeRoute(async (req, res) => {
  if (!requireOrigin(req, res)) return;
  if (!readSessionCookie(req)) { clearSessionCookie(res); res.json({ ok: true }); return; }
  const verified = await verifySession(req);
  if (!verified) { clearSessionCookie(res); res.json({ ok: true }); return; }
  if (!validCsrf(verified.session, "logout", req.get("x-csrf-token"))) { fail(res, 403, "Forbidden"); return; }
  const { client, db } = await authConnection();
  const transaction = client.startSession();
  try {
    await transaction.withTransaction(async () => {
      await authCollections(db).sessions.deleteOne({ _id: verified.session._id }, { session: transaction });
      await audit("logout", "success", verified.user._id, verified.user._id, transaction);
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary", timeoutMS: 10_000 });
  } finally { await transaction.endSession(); }
  clearSessionCookie(res);
  res.json({ ok: true });
}));

authRouter.post("/token/check", safeRoute(async (req, res) => {
  if (!requireOrigin(req, res)) return;
  if (!await enforceLimit(`token-check-ip:${clientIpBucket(req.ip)}`, 100)) { fail(res, 429, "Too many attempts"); return; }
  const kind = bodyString(req, "kind");
  if (!["bootstrap", "invitation", "reset", "email-change", "reactivation"].includes(kind)) { fail(res, 400, "Invalid input"); return; }
  const token = await validateOneTimeToken(bodyString(req, "token"), kind as "bootstrap" | "invitation" | "reset" | "email-change" | "reactivation");
  res.json({ valid: Boolean(token), email: token?.email });
}));

authRouter.post("/invite/accept", safeRoute(async (req, res) => {
  if (!requireOrigin(req, res)) return;
  if (!await enforceLimit(`accept-ip:${clientIpBucket(req.ip)}`, appConfig.auth.sensitiveLimit * 3)) { fail(res, 429, "Too many attempts"); return; }
  try {
    await acceptInvitation(bodyString(req, "token"), bodyString(req, "username"), bodyString(req, "password"));
    res.json({ ok: true });
  } catch (error) { if (error instanceof AuthFlowError || error instanceof InputError || error instanceof Error && error.message.startsWith("Invalid")) fail(res, 400, "Invitation unavailable or invalid"); else throw error; }
}));

authRouter.post("/forgot", safeRoute(async (req, res) => {
  if (!requireOrigin(req, res)) return;
  const started = Date.now();
  const email = bodyString(req, "email");
  if (!await enforceLimit(`forgot-ip:${clientIpBucket(req.ip)}`, appConfig.auth.sensitiveLimit * 3) || !await enforceLimit(`forgot-email:${email.toLowerCase().trim()}`, appConfig.auth.sensitiveLimit)) {
    fail(res, 429, "Too many attempts"); return;
  }
  try { await requestPasswordReset(email); }
  catch { console.error("Password reset request could not be queued"); }
  await new Promise((resolve) => setTimeout(resolve, Math.max(0, 1000 - (Date.now() - started))));
  res.json({ ok: true });
}));

authRouter.post("/reset", safeRoute(async (req, res) => {
  if (!requireOrigin(req, res)) return;
  if (!await enforceLimit(`reset-ip:${clientIpBucket(req.ip)}`, appConfig.auth.sensitiveLimit * 3)) { fail(res, 429, "Too many attempts"); return; }
  try { await completePasswordReset(bodyString(req, "token"), bodyString(req, "password")); res.json({ ok: true }); }
  catch (error) { if (error instanceof AuthFlowError || error instanceof InputError || error instanceof Error && error.message.startsWith("Invalid")) fail(res, 400, "Reset unavailable or invalid"); else throw error; }
}));

authRouter.post("/reactivate/accept", safeRoute(async (req, res) => {
  if (!requireOrigin(req, res)) return;
  if (!await enforceLimit(`reactivate-ip:${clientIpBucket(req.ip)}`, appConfig.auth.sensitiveLimit * 3)) { fail(res, 429, "Too many attempts"); return; }
  try { await acceptReactivation(bodyString(req, "token"), bodyString(req, "password")); res.json({ ok: true }); }
  catch (error) { if (error instanceof AuthFlowError || error instanceof InputError || error instanceof Error && error.message.startsWith("Invalid")) fail(res, 400, "Reactivation unavailable or invalid"); else throw error; }
}));

authRouter.post("/email/confirm", safeRoute(async (req, res) => {
  if (!requireOrigin(req, res)) return;
  if (!await enforceLimit(`email-confirm-ip:${clientIpBucket(req.ip)}`, appConfig.auth.sensitiveLimit * 3)) { fail(res, 429, "Too many attempts"); return; }
  try { await confirmEmailChange(bodyString(req, "token")); clearSessionCookie(res); res.json({ ok: true }); }
  catch (error) { if (error instanceof AuthFlowError || error instanceof InputError) fail(res, 400, "Email confirmation unavailable or invalid"); else throw error; }
}));

authRouter.get("/me", safeRoute(async (req, res) => {
  const verified = await verifySession(req, true);
  if (!verified) { fail(res, 401, "Sign in required"); return; }
  res.json({ id: verified.user._id.toHexString(), email: verified.user.email, username: verified.user.username, csrf: csrfToken(verified.session, "private") });
}));

authRouter.post("/invite", safeRoute(async (req, res) => {
  if (!requireOrigin(req, res)) return;
  const verified = await current(req, res);
  if (!verified || !requireRecentReauth(verified, res)) return;
  try { await inviteAdministrator(bodyString(req, "email"), verified.user, verified); res.json({ ok: true }); }
  catch (error) { if (error instanceof AuthFlowError || error instanceof InputError || error instanceof Error && error.message.startsWith("Invalid")) fail(res, 400, "Invitation could not be created"); else throw error; }
}));

authRouter.get("/administrators", safeRoute(async (req, res) => {
  const verified = await verifySession(req);
  if (!verified) { fail(res, 401, "Sign in required"); return; }
  const { db } = await authConnection();
  const { users, tokens } = authCollections(db);
  const records = await users.find({}, { projection: { email: 1, username: 1, status: 1, createdAt: 1 } }).toArray();
  const invitations = await tokens.find({ kind: "invitation", consumedAt: { $exists: false }, expiresAt: { $gt: new Date() } }, { projection: { email: 1, createdAt: 1, expiresAt: 1, mailState: 1, mailStateAt: 1 } }).toArray();
  res.json({ administrators: records.map((item) => ({ id: item._id.toHexString(), email: item.email, username: item.username, status: item.status })), invitations: invitations.map((item) => ({ id: item._id, email: item.email, expiresAt: item.expiresAt, createdAt: item.createdAt, mailState: item.mailState, mailStateAt: item.mailStateAt })) });
}));

authRouter.post("/invite/cancel", safeRoute(async (req, res) => {
  if (!requireOrigin(req, res)) return;
  const verified = await current(req, res);
  if (!verified || !requireRecentReauth(verified, res)) return;
  const id = bodyString(req, "id");
  if (!/^[a-f0-9]{64}$/.test(id)) { fail(res, 400, "Invalid input"); return; }
  await cancelInvitation(id, verified.user, verified);
  res.json({ ok: true });
}));

authRouter.post("/password/change", safeRoute(async (req, res) => {
  if (!requireOrigin(req, res)) return;
  const verified = await current(req, res);
  if (!verified || !await recheckPassword(req, res, verified.user)) return;
  let passwordHash: string;
  try { passwordHash = await hashPassword(bodyString(req, "newPassword")); }
  catch (error) { if (error instanceof Error && error.message === "Invalid password") { fail(res, 400, "Invalid password"); return; } throw error; }
  const { client, db } = await authConnection();
  const { users, sessions } = authCollections(db);
  const session = client.startSession();
  try {
    const raw = await session.withTransaction(async () => {
      const changed = await users.updateOne({ _id: verified.user._id, status: "active", passwordHash: verified.user.passwordHash, authGeneration: verified.user.authGeneration }, { $set: { passwordHash, updatedAt: new Date() }, $inc: { authGeneration: 1 } }, { session });
      if (changed.modifiedCount !== 1) throw new AuthFlowError("Account changed");
      await revokeUserTokens(verified.user._id, session);
      await sessions.deleteMany({ userId: verified.user._id }, { session });
      const nextSession = await createSession(verified.user._id, verified.user.authGeneration + 1, req.get("user-agent") ?? "Unknown device", session);
      await audit("password-change", "success", verified.user._id, verified.user._id, session);
      return nextSession;
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary", timeoutMS: 10_000 });
    if (!raw) throw new Error("Session creation failed");
    setSessionCookie(res, raw);
  } finally { await session.endSession(); }
  res.json({ ok: true });
}));

authRouter.post("/username", safeRoute(async (req, res) => {
  if (!requireOrigin(req, res)) return;
  const verified = await current(req, res);
  if (!verified) return;
  let username: string;
  try { username = validateUsername(bodyString(req, "username")); } catch { fail(res, 400, "Invalid username"); return; }
  const { client, db } = await authConnection();
  const transaction = client.startSession();
  try {
    await transaction.withTransaction(async () => {
      const changed = await authCollections(db).users.updateOne({ _id: verified.user._id, status: "active", authGeneration: verified.user.authGeneration }, { $set: { username, updatedAt: new Date() } }, { session: transaction });
      if (changed.matchedCount !== 1) throw new AuthFlowError("Account changed");
      await audit("username-changed", "success", verified.user._id, verified.user._id, transaction);
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary", timeoutMS: 10_000 });
  } finally { await transaction.endSession(); }
  res.json({ ok: true, username });
}));

authRouter.post("/email/change", safeRoute(async (req, res) => {
  if (!requireOrigin(req, res)) return;
  const verified = await current(req, res);
  if (!verified || !await recheckPassword(req, res, verified.user)) return;
  try { await requestEmailChange(verified.user, bodyString(req, "email")); res.json({ ok: true }); }
  catch (error) { if (error instanceof AuthFlowError || error instanceof InputError || error instanceof Error && error.message.startsWith("Invalid")) fail(res, 400, "Email change unavailable"); else throw error; }
}));

authRouter.get("/sessions", safeRoute(async (req, res) => {
  const verified = await verifySession(req, true);
  if (!verified) { fail(res, 401, "Sign in required"); return; }
  const { db } = await authConnection();
  const now = new Date();
  const records = (await authCollections(db).sessions.find({ userId: verified.user._id, absoluteExpiresAt: { $gt: now } }, { projection: { csrfSecret: 0 } }).toArray()).filter((item) => isSessionCurrent(item, now));
  res.json({ sessions: records.map((item) => ({ id: item._id, deviceLabel: item.deviceLabel, createdAt: item.createdAt, lastSeenAt: item.lastSeenAt, current: item._id === verified.session._id })) });
}));

authRouter.post("/sessions/revoke", safeRoute(async (req, res) => {
  if (!requireOrigin(req, res)) return;
  const verified = await current(req, res);
  if (!verified || !requireRecentReauth(verified, res)) return;
  const id = bodyString(req, "id");
  if (id !== "current" && !/^[a-f0-9]{64}$/.test(id)) { fail(res, 400, "Invalid input"); return; }
  const targetId = id === "current" ? verified.session._id : id;
  const { client, db } = await authConnection();
  const transaction = client.startSession();
  try {
    await transaction.withTransaction(async () => {
      await assertRecentReauth(verified, transaction);
      const changed = await authCollections(db).sessions.deleteOne({ _id: targetId, userId: verified.user._id }, { session: transaction });
      if (changed.deletedCount === 1) await audit("session-revoked", "success", verified.user._id, verified.user._id, transaction);
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary", timeoutMS: 10_000 });
  } finally { await transaction.endSession(); }
  if (targetId === verified.session._id) clearSessionCookie(res);
  res.json({ ok: true });
}));

authRouter.post("/sessions/revoke-all", safeRoute(async (req, res) => {
  if (!requireOrigin(req, res)) return;
  const verified = await current(req, res);
  if (!verified || !requireRecentReauth(verified, res)) return;
  const { client, db } = await authConnection();
  const { users, sessions } = authCollections(db);
  const transaction = client.startSession();
  try {
    await transaction.withTransaction(async () => {
      await assertRecentReauth(verified, transaction);
      const changed = await users.updateOne({ _id: verified.user._id, status: "active", authGeneration: verified.user.authGeneration }, { $inc: { authGeneration: 1 } }, { session: transaction });
      if (changed.modifiedCount !== 1) throw new AuthFlowError("Session changed");
      await revokeUserTokens(verified.user._id, transaction);
      await sessions.deleteMany({ userId: verified.user._id }, { session: transaction });
      await audit("sessions-revoked", "success", verified.user._id, verified.user._id, transaction);
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary", timeoutMS: 10_000 });
  } finally { await transaction.endSession(); }
  clearSessionCookie(res);
  res.json({ ok: true });
}));

authRouter.post("/administrators/disable", safeRoute(async (req, res) => {
  if (!requireOrigin(req, res)) return;
  const verified = await current(req, res);
  if (!verified || !requireRecentReauth(verified, res)) return;
  const id = bodyString(req, "id");
  if (!ObjectId.isValid(id) || id.length !== 24) { fail(res, 400, "Invalid input"); return; }
  const connection = await authConnection();
  const targetId = new ObjectId(id);
  try {
    await transitionAdminStatus(connection, targetId, "active", "disabled", verified.user, async (session) => {
      await notifyAdministrators("WebCreativeTeam administrator disabled", "An administrator account was disabled.", session);
      await audit("administrator-disabled", "success", verified.user._id, targetId, session);
    }, (session) => assertRecentReauth(verified, session));
  }
  catch (error) { if (error instanceof AdminTransitionError) { fail(res, 409, "Administrator could not be disabled"); return; } throw error; }
  if (id === verified.user._id.toHexString()) clearSessionCookie(res);
  res.json({ ok: true });
}));

authRouter.post("/administrators/reactivate", safeRoute(async (req, res) => {
  if (!requireOrigin(req, res)) return;
  const verified = await current(req, res);
  if (!verified || !requireRecentReauth(verified, res)) return;
  const id = bodyString(req, "id");
  if (!ObjectId.isValid(id) || id.length !== 24) { fail(res, 400, "Invalid input"); return; }
  try { await requestReactivation(new ObjectId(id), verified.user, verified); res.json({ ok: true }); }
  catch (error) { if (error instanceof AuthFlowError) fail(res, 400, "Reactivation unavailable"); else throw error; }
}));

authRouter.post("/administrators/delete", safeRoute(async (req, res) => {
  if (!requireOrigin(req, res)) return;
  const verified = await current(req, res);
  if (!verified || !requireRecentReauth(verified, res)) return;
  const id = bodyString(req, "id");
  if (!ObjectId.isValid(id) || id.length !== 24) { fail(res, 400, "Invalid input"); return; }
  try { await deleteAdministrator(new ObjectId(id), bodyString(req, "confirmation"), verified.user, verified); res.json({ ok: true }); }
  catch (error) { if (error instanceof AuthFlowError) fail(res, 400, "Deletion unavailable"); else throw error; }
}));

authRouter.all("/*path", (_req, res) => { fail(res, 404, "Not found"); });
authRouter.use((error: unknown, _req: Request, res: Response, _next: express.NextFunction) => {
  void _next;
  const status = error && typeof error === "object" && "status" in error && error.status === 413 ? 413 : 400;
  fail(res, status, "Invalid request body");
});
