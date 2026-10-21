import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Request, Response } from "express";
import { ObjectId, type ClientSession } from "mongodb";
import ipaddr from "ipaddr.js";
import { appConfig } from "../../lib/config.ts";
import { authCookieConfig, authPublicOrigin } from "./config.ts";
import { authCollections, authConnection, type AdminUser, type AuthSession } from "./db.ts";

export function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@,;<>"()]+@[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}$/.test(email)) throw new Error("Invalid email");
  return email;
}

export function validateUsername(value: string): string {
  const name = value.trim();
  if (name.length < 2 || name.length > 60 || /[\p{Cc}\p{Cf}<>]/u.test(name)) throw new Error("Invalid username");
  return name;
}

export function randomToken(): string { return randomBytes(appConfig.auth.tokenBytes).toString("base64url"); }
export function tokenHash(token: string): string { return createHash("sha256").update(token).digest("hex"); }

export function clientIpBucket(ip: string | undefined): string {
  if (!ip || !ipaddr.isValid(ip)) return "unknown";
  const address = ipaddr.process(ip);
  if (address.kind() === "ipv4") return address.toString();
  return `v6:${address.toByteArray().slice(0, 8).map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function cookieValue(header: string | undefined, name: string): string | undefined {
  const part = header?.split(";").map((item) => item.trim()).find((item) => item.startsWith(`${name}=`));
  return part?.slice(name.length + 1);
}

export function sessionCookieFromHeader(header: string | undefined): string | undefined {
  const value = cookieValue(header, authCookieConfig().name);
  return value && value.length === Math.ceil(appConfig.auth.tokenBytes * 8 / 6) && /^[A-Za-z0-9_-]+$/.test(value) ? value : undefined;
}

export function readSessionCookie(req: Request): string | undefined { return sessionCookieFromHeader(req.get("cookie")); }
export function hasSessionCookie(req: Request): boolean { return cookieValue(req.get("cookie"), authCookieConfig().name) !== undefined; }

export type VerifiedSession = { session: AuthSession; user: AdminUser };
export class ReauthRequiredError extends Error {}
export function hasRecentReauth(session: AuthSession, now = new Date()): boolean {
  return isSessionCurrent(session, now) && session.reauthUntil instanceof Date && session.reauthUntil > now;
}

export async function assertRecentReauth(verified: VerifiedSession, transaction: ClientSession): Promise<void> {
  const now = new Date();
  if (!hasRecentReauth(verified.session, now)) throw new ReauthRequiredError("Reauthentication required");
  const { db } = await authConnection();
  const result = await authCollections(db).sessions.updateOne({
    _id: verified.session._id, userId: verified.user._id, authGeneration: verified.user.authGeneration,
    reauthUntil: { $gt: now }, idleExpiresAt: { $gt: now }, absoluteExpiresAt: { $gt: now },
    createdAt: { $gt: new Date(now.getTime() - appConfig.auth.absoluteSeconds * 1000) },
  }, { $inc: { sensitiveSerial: 1 } }, { session: transaction });
  if (result.modifiedCount !== 1) throw new ReauthRequiredError("Reauthentication required");
}
export function isSessionCurrent(session: AuthSession, now = new Date()): boolean {
  if (!(session.createdAt instanceof Date) || !(session.absoluteExpiresAt instanceof Date) || !(session.idleExpiresAt instanceof Date)) return false;
  const createdAt = session.createdAt.getTime();
  const absoluteExpiresAt = session.absoluteExpiresAt.getTime();
  const idleExpiresAt = session.idleExpiresAt.getTime();
  const nowMs = now.getTime();
  return Number.isFinite(createdAt) && Number.isFinite(absoluteExpiresAt) && Number.isFinite(idleExpiresAt)
    && createdAt <= nowMs + 60_000
    && Math.min(absoluteExpiresAt, createdAt + appConfig.auth.absoluteSeconds * 1000, idleExpiresAt) > nowMs;
}

export async function verifySessionCookie(cookieHeader: string | undefined, touch = false): Promise<VerifiedSession | null> {
  const raw = sessionCookieFromHeader(cookieHeader);
  if (!raw) return null;
  const { db } = await authConnection();
  const { sessions, users } = authCollections(db);
  const session = await sessions.findOne({ _id: tokenHash(raw) });
  const now = new Date();
  if (!session || !isSessionCurrent(session, now)) return null;
  const user = await users.findOne({ _id: session.userId, status: "active" });
  if (!user || session.authGeneration !== user.authGeneration) return null;
  if (touch && now.getTime() - session.lastSeenAt.getTime() >= appConfig.auth.activityWriteSeconds * 1000) {
    const idleExpiresAt = new Date(Math.min(now.getTime() + appConfig.auth.idleSeconds * 1000, session.absoluteExpiresAt.getTime(), session.createdAt.getTime() + appConfig.auth.absoluteSeconds * 1000));
    await sessions.updateOne({ _id: session._id, idleExpiresAt: { $gt: now } }, { $set: { lastSeenAt: now, idleExpiresAt } });
  }
  return { session, user };
}

export async function verifySession(req: Request, touch = false): Promise<VerifiedSession | null> {
  return verifySessionCookie(req.get("cookie"), touch);
}

export function csrfToken(session: AuthSession, purpose: "logout" | "private"): string {
  return createHmac("sha256", Buffer.from(session.csrfSecret, "base64url")).update(purpose).digest("base64url");
}

export function validCsrf(session: AuthSession, purpose: "logout" | "private", candidate: unknown): boolean {
  if (typeof candidate !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(candidate)) return false;
  const expected = Buffer.from(csrfToken(session, purpose));
  return timingSafeEqual(expected, Buffer.from(candidate));
}

export function validOrigin(req: Request): boolean {
  try { return req.get("origin") === authPublicOrigin().origin; } catch { return false; }
}

export async function createSession(userId: ObjectId, authGeneration: number, deviceLabel: string, transaction?: ClientSession) {
  const raw = randomToken();
  const now = new Date();
  const absoluteExpiresAt = new Date(now.getTime() + appConfig.auth.absoluteSeconds * 1000);
  const session: AuthSession = {
    _id: tokenHash(raw), userId, authGeneration, createdAt: now, lastSeenAt: now,
    idleExpiresAt: new Date(now.getTime() + appConfig.auth.idleSeconds * 1000),
    absoluteExpiresAt, deviceLabel: deviceLabel.slice(0, 120), csrfSecret: randomToken(),
  };
  const { db } = await authConnection();
  await authCollections(db).sessions.insertOne(session, { session: transaction });
  return raw;
}

export function setSessionCookie(res: Response, raw: string, maxAgeMilliseconds?: number) {
  const config = authCookieConfig();
  res.cookie(config.name, raw, { ...config, maxAge: maxAgeMilliseconds ?? config.maxAge });
}

export function clearSessionCookie(res: Response) {
  const config = authCookieConfig();
  res.clearCookie(config.name, { httpOnly: config.httpOnly, secure: config.secure, sameSite: config.sameSite, path: config.path });
}

export function privateResponse(res: Response) {
  res.set("Cache-Control", "private, no-store");
  res.set("Vary", "Cookie");
  res.set("X-Content-Type-Options", "nosniff");
  res.set("Referrer-Policy", "no-referrer");
  res.set("X-Frame-Options", "DENY");
}

export async function enforceLimit(key: string, limit: number): Promise<boolean> {
  const { db } = await authConnection();
  const { limits } = authCollections(db);
  const bucket = Math.floor(Date.now() / (appConfig.auth.limitWindowSeconds * 1000));
  const id = tokenHash(`${key}:${bucket}`);
  const expiresAt = new Date((bucket + 1) * appConfig.auth.limitWindowSeconds * 1000);
  let record;
  try {
    record = await limits.findOneAndUpdate({ _id: id }, { $inc: { count: 1 }, $setOnInsert: { expiresAt } }, { upsert: true, returnDocument: "after" });
  } catch (error) {
    if (!(error && typeof error === "object" && "code" in error && error.code === 11000)) throw error;
    record = await limits.findOneAndUpdate({ _id: id }, { $inc: { count: 1 } }, { returnDocument: "after" });
  }
  return (record?.count ?? limit + 1) <= limit;
}

export async function resetLimit(key: string): Promise<void> {
  const { db } = await authConnection();
  const bucket = Math.floor(Date.now() / (appConfig.auth.limitWindowSeconds * 1000));
  await authCollections(db).limits.deleteOne({ _id: tokenHash(`${key}:${bucket}`) });
}
