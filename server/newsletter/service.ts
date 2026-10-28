import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";
import { domainToASCII } from "node:url";
import nodemailer from "nodemailer";
import { ObjectId, type ClientSession, type Db, type MongoClient } from "mongodb";
import { appConfig, localizedPath, siteOrigin, type Locale } from "../../lib/config.js";
import { authDatabaseConfig } from "../auth/config.js";
import { authCollections, authConnection, type AuthConnection } from "../auth/db.js";
import { tokenHash } from "../auth/security.js";
import { isRecipientRejected, transportConfig } from "../auth/outbox.js";

type Source = "footer" | "contact";
type Subscription = {
  _id: ObjectId; recordType: "subscription"; email: string; status: "approved" | "unsubscribed";
  firstApprovedAt: Date; lastConfirmedAt: Date; consentVersion: string;
  source: Source; locale: Locale; cancelHashes: string[];
  statusCancelTokens?: { hash: string; expiresAt?: Date }[];
  statusNoticeAt?: Date; unsubscribedAt?: Date; retainUntil?: Date; purgeAt?: Date;
};
type Pending = {
  _id: ObjectId; recordType: "pending"; status: "pending_approval"; email: string; source: Source; locale: Locale;
  consentVersion: string; createdAt: Date; expiresAt: Date; purgeAt: Date;
  confirmHashes: string[]; cancelHashes: string[];
  lastMailAt: Date; resends: number; acceptedCount: number;
  acceptedOutboxIds?: ObjectId[]; uncertainDelivery?: boolean; smtpStartedAt?: Date;
};
type Outbox = {
  _id: ObjectId; recordType: "outbox"; kind: "confirmation" | "resend" | "active-status";
  ownerId: ObjectId; cycleId: string; encryptedPayload: string; keyId: string;
  status: "pending" | "leased" | "sent"; attempts: number;
  availableAt: Date; expiresAt: Date; leaseId?: string; leaseUntil?: Date;
};
type Limit = { _id: string; recordType: "limit"; count: number; expiresAt: Date };
const newsletterSchemaMarkerId = "__newsletter_schema__";
type NewsletterSchema = { _id: typeof newsletterSchemaMarkerId; recordType: "schema"; schemaId: "wct-newsletter-v2" };
type MailPayload = { to: string; subject: string; text: string };
type RequestResult = "accepted" | "limited" | "unavailable";

const indexState = globalThis as typeof globalThis & { __wctNewsletterIndexes?: { client: MongoClient; ready: Promise<void> } };
const testMailbox: MailPayload[] = [];

function configuration() {
  authDatabaseConfig();
  const rawKey = process.env.AUTH_OUTBOX_KEY;
  const masterKey = rawKey ? Buffer.from(rawKey, "base64") : Buffer.alloc(0);
  const keyId = process.env.AUTH_OUTBOX_KEY_ID ?? "v1";
  if (masterKey.length !== 32 || !/^[A-Za-z0-9_-]{1,32}$/.test(keyId)) throw new Error("Newsletter service is not configured");
  const key = Buffer.from(hkdfSync("sha256", masterKey, Buffer.alloc(0), "wct-newsletter-outbox-v1", 32));
  transportConfig();
  const origin = siteOrigin();
  if (process.env.NODE_ENV === "production" && origin.protocol !== "https:") throw new Error("Newsletter origin is not secure");
  return { key, keyId, origin };
}

function collections(db: Db) {
  const name = appConfig.newsletter.collection;
  return {
    subscriptions: db.collection<Subscription>(name),
    pending: db.collection<Pending>(name),
    outbox: db.collection<Outbox>(name),
    limits: db.collection<Limit>(name),
  };
}

export async function createNewsletterIndexes(db: Db): Promise<void> {
  const c = collections(db);
  await Promise.all([
    c.subscriptions.createIndex({ email: 1 }, { unique: true, name: "subscription_email_unique", partialFilterExpression: { recordType: "subscription" } }),
    c.pending.createIndex({ email: 1, recordType: 1 }, { unique: true, name: "pending_email_unique", partialFilterExpression: { recordType: "pending" } }),
    c.subscriptions.createIndex({ purgeAt: 1 }, { expireAfterSeconds: 0 }),
    c.subscriptions.createIndex({ recordType: 1, cancelHashes: 1 }),
    c.subscriptions.createIndex({ recordType: 1, "statusCancelTokens.hash": 1 }),
    c.pending.createIndex({ recordType: 1, confirmHashes: 1 }),
    c.outbox.createIndex({ recordType: 1, status: 1, availableAt: 1 }),
    c.outbox.createIndex({ recordType: 1, ownerId: 1 }),
    c.outbox.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
  ]);
}

export async function prepareNewsletterSchema(db: Db): Promise<void> {
  const markers = db.collection<NewsletterSchema>(appConfig.newsletter.collection);
  const existing = await markers.findOne({ _id: newsletterSchemaMarkerId });
  if (existing && existing.schemaId !== "wct-newsletter-v2") throw new Error("Newsletter schema version mismatch");
  await createNewsletterIndexes(db);
  await markers.updateOne(
    { _id: newsletterSchemaMarkerId },
    { $setOnInsert: { recordType: "schema", schemaId: "wct-newsletter-v2" } },
    { upsert: true },
  );
  const marker = await markers.findOne({ _id: newsletterSchemaMarkerId });
  if (marker?.schemaId !== "wct-newsletter-v2" || marker.recordType !== "schema") throw new Error("Newsletter schema version mismatch");
}

export async function newsletterConnection(): Promise<AuthConnection> {
  configuration();
  const connection = await authConnection();
  if (indexState.__wctNewsletterIndexes?.client !== connection.client) {
    const ready = Promise.all([
      authCollections(connection.db).control.findOne({ _id: "singleton" }, { timeoutMS: appConfig.newsletter.newsletterDatabaseOperationTimeoutMilliseconds }),
      connection.db.collection<NewsletterSchema>(appConfig.newsletter.collection).findOne({ _id: newsletterSchemaMarkerId }, { timeoutMS: appConfig.newsletter.newsletterDatabaseOperationTimeoutMilliseconds }),
    ]).then(([authMarker, newsletterMarker]) => {
      if (authMarker?.schemaId !== "wct-auth-v1" || newsletterMarker?.schemaId !== "wct-newsletter-v2" || newsletterMarker.recordType !== "schema") {
        throw new Error("Newsletter database is not prepared");
      }
    });
    indexState.__wctNewsletterIndexes = { client: connection.client, ready };
  }
  try { await indexState.__wctNewsletterIndexes.ready; }
  catch (error) {
    if (indexState.__wctNewsletterIndexes?.client === connection.client) indexState.__wctNewsletterIndexes = undefined;
    throw error;
  }
  return connection;
}

export function normalizeNewsletterEmail(value: string): string {
  if (typeof value !== "string") throw new Error("Invalid newsletter email");
  const trimmed = value.trim();
  if (trimmed.length > appConfig.contact.emailMaxLength || /[\p{Cc}\p{Cf}\s<>()",;:]/u.test(trimmed)) throw new Error("Invalid newsletter email");
  const [local, domain, extra] = trimmed.split("@");
  if (!local || !domain || extra !== undefined || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(local) || local.startsWith(".") || local.endsWith(".") || local.includes("..") || local.length > 64 || domain.endsWith(".")) throw new Error("Invalid newsletter email");
  const asciiDomain = domainToASCII(domain);
  const email = `${local.toLowerCase()}@${asciiDomain.toLowerCase()}`;
  const labels = asciiDomain.toLowerCase().split(".");
  if (labels.length < 2 || labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
    || labels.at(-1)!.length < 2 || email.length > appConfig.contact.emailMaxLength) throw new Error("Invalid newsletter email");
  return email;
}

function dateAfterYears(date: Date, years: number): Date {
  const next = new Date(date);
  next.setUTCFullYear(next.getUTCFullYear() + years);
  return next;
}

async function databaseNow(db: Db): Promise<Date> {
  const result = await db.command({ hello: 1 }, { timeoutMS: appConfig.newsletter.newsletterDatabaseOperationTimeoutMilliseconds });
  return result.localTime instanceof Date ? result.localTime : new Date();
}

function link(path: string, locale: Locale, token: string): string {
  const url = new URL(localizedPath(path, locale), configuration().origin);
  url.hash = `token=${encodeURIComponent(token)}`;
  return url.toString();
}

function encrypt(payload: MailPayload, id: ObjectId): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", configuration().key, iv);
  cipher.setAAD(Buffer.from(`newsletter:${id.toHexString()}`));
  const body = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((part) => part.toString("base64url")).join(".");
}

function decrypt(entry: Outbox): MailPayload {
  const config = configuration();
  const previousKey = process.env.AUTH_OUTBOX_PREVIOUS_KEY;
  const previousMaster = previousKey ? Buffer.from(previousKey, "base64") : Buffer.alloc(0);
  const key = entry.keyId === config.keyId ? config.key
    : entry.keyId === process.env.AUTH_OUTBOX_PREVIOUS_KEY_ID && previousMaster.length === 32
      ? Buffer.from(hkdfSync("sha256", previousMaster, Buffer.alloc(0), "wct-newsletter-outbox-v1", 32))
      : Buffer.alloc(0);
  if (key.length !== 32) throw new Error("Newsletter mail key unavailable");
  const [iv, tag, body] = entry.encryptedPayload.split(".").map((part) => Buffer.from(part, "base64url"));
  if (!iv || !tag || !body || iv.length !== 12 || tag.length !== 16) throw new Error("Invalid newsletter payload");
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAAD(Buffer.from(`newsletter:${entry._id.toHexString()}`));
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8")) as MailPayload;
}

async function queueMail(db: Db, kind: Outbox["kind"], ownerId: ObjectId, payload: MailPayload, session: ClientSession, now: Date) {
  const _id = new ObjectId();
  const config = configuration();
  await collections(db).outbox.insertOne({
    _id, recordType: "outbox", kind, ownerId, cycleId: ownerId.toHexString(), encryptedPayload: encrypt(payload, _id), keyId: config.keyId,
    status: "pending", attempts: 0, availableAt: now,
    expiresAt: new Date(now.getTime() + appConfig.newsletter.outboxMilliseconds),
  }, { session });
}

function confirmationMail(email: string, locale: Locale, confirmToken: string, cancelToken: string): MailPayload {
  return locale === "bg" ? {
    to: email, subject: "Потвърдете абонамента си за WebCreativeTeam",
    text: `Поискахте абонамент за новини и полезно съдържание от WebCreativeTeam.\n\nПотвърдете абонамента си:\n${link(appConfig.paths.newsletterConfirm, locale, confirmToken)}\n\nОтказ:\n${link(appConfig.paths.newsletterDecline, locale, cancelToken)}\n\nАко не сте заявили абонамент, можете да откажете заявката или да игнорирате писмото.`,
  } : {
    to: email, subject: "Confirm your WebCreativeTeam subscription",
    text: `You requested WebCreativeTeam news and useful content.\n\nConfirm your subscription:\n${link(appConfig.paths.newsletterConfirm, locale, confirmToken)}\n\nDecline:\n${link(appConfig.paths.newsletterDecline, locale, cancelToken)}\n\nIf you did not request this, decline or ignore this email.`,
  };
}

function statusMail(email: string, locale: Locale, token: string): MailPayload {
  return locale === "bg" ? {
    to: email, subject: "Вече сте абонирани за WebCreativeTeam",
    text: `Вече сте абонирани за бюлетина на WebCreativeTeam. Няма нужда да се абонирате отново. Ако желаете, можете да се отпишете чрез този линк:\n${link(appConfig.paths.newsletterDecline, locale, token)}`,
  } : {
    to: email, subject: "You are already subscribed to WebCreativeTeam",
    text: `You're already subscribed to the WebCreativeTeam newsletter. You don't need to subscribe again. You can unsubscribe through this link:\n${link(appConfig.paths.newsletterDecline, locale, token)}`,
  };
}

const localAttempts = new Map<string, { count: number; until: number }>();
let localCleanupAt = 0;
function reserveLocal(key: string, limit: number): boolean {
  const now = Date.now();
  const previous = localAttempts.get(key);
  const current = previous && previous.until > now ? previous : { count: 0, until: now + 60_000 };
  if (current.count >= limit) return false;
  if (!previous && localAttempts.size >= appConfig.newsletter.localBucketLimit) {
    if (now >= localCleanupAt) {
      for (const [entry, value] of localAttempts) if (value.until <= now) localAttempts.delete(entry);
      localCleanupAt = now + 60_000;
    }
    if (localAttempts.size >= appConfig.newsletter.localBucketLimit) return false;
  }
  localAttempts.set(key, { count: current.count + 1, until: current.until });
  return true;
}

async function reserveShared(db: Db, key: string, limit: number, windowMilliseconds: number): Promise<boolean> {
  const now = await databaseNow(db);
  const until = new Date(now.getTime() + windowMilliseconds);
  const entry = await collections(db).limits.findOneAndUpdate({ _id: key }, [{ $set: {
    recordType: "limit",
    count: { $cond: [{ $gt: ["$expiresAt", now] }, { $add: ["$count", 1] }, 1] },
    expiresAt: { $cond: [{ $gt: ["$expiresAt", now] }, "$expiresAt", until] },
  } }], { upsert: true, returnDocument: "after", timeoutMS: appConfig.newsletter.newsletterDatabaseOperationTimeoutMilliseconds });
  return Boolean(entry && entry.count <= limit);
}

export async function reserveNewsletterIp(ipBucket: string): Promise<"allowed" | "limited" | "unavailable"> {
  try {
    const config = configuration();
    const ipKey = Buffer.from(hkdfSync("sha256", config.key, Buffer.alloc(0), "newsletter-ip-rate-limit", 32));
    const key = createHmac("sha256", ipKey).update(ipBucket).digest("hex");
    if (!reserveLocal(`ip:${key}`, appConfig.newsletter.localMinuteLimit)
      || !reserveLocal("global", appConfig.newsletter.localGlobalMinuteLimit)) return "limited";
    const { db } = await newsletterConnection();
    if (!await reserveShared(db, `ip15:${key}`, appConfig.newsletter.ipWindowLimit, appConfig.newsletter.ipWindowMilliseconds)) return "limited";
    if (!await reserveShared(db, `ip24:${key}`, appConfig.newsletter.ipDailyLimit, 24 * 60 * 60 * 1000)) return "limited";
    return "allowed";
  } catch { return "unavailable"; }
}

export function reserveNewsletterDecisionIp(ipBucket: string): boolean {
  return reserveLocal(`decision:${ipBucket}`, appConfig.newsletter.decisionMinuteLimit)
    && reserveLocal("decision-global", appConfig.newsletter.decisionGlobalMinuteLimit);
}

async function reserveGlobal(db: Db): Promise<boolean> {
  if (!await reserveShared(db, "global-hour", appConfig.newsletter.globalHourlyLimit, 60 * 60 * 1000)) return false;
  return reserveShared(db, "global-day", appConfig.newsletter.globalDailyLimit, 24 * 60 * 60 * 1000);
}

async function finalizeSentMail(db: Db, entry: Outbox): Promise<void> {
  const { pending, outbox } = collections(db);
  if (entry.kind !== "active-status") {
    await pending.updateOne({ _id: entry.ownerId, recordType: "pending", acceptedOutboxIds: { $ne: entry._id } }, {
      $addToSet: { acceptedOutboxIds: entry._id }, $inc: { acceptedCount: 1 }, $unset: { smtpStartedAt: "" },
    });
  }
  await outbox.deleteOne({ _id: entry._id, recordType: "outbox", status: "sent" });
}

export async function requestSubscription(email: string, locale: Locale, source: Source): Promise<RequestResult> {
  try {
    const connection = await newsletterConnection();
    const { client, db } = connection;
    if (!await reserveGlobal(db)) return "limited";
    const now = await databaseNow(db);
    const { subscriptions, pending, outbox } = collections(db);
    const session = client.startSession();
    let statusNoticeEvent: "queued" | "suppressed" | null = null;
    try {
      await session.withTransaction(async () => {
        statusNoticeEvent = null;
        const active = await subscriptions.findOne({ email, recordType: "subscription", status: "approved" }, { session });
        if (active) {
          if (!active.statusNoticeAt || active.statusNoticeAt.getTime() + appConfig.newsletter.statusNoticeWaitMilliseconds <= now.getTime()) {
            const token = randomBytes(32).toString("base64url");
            const changed = await subscriptions.updateOne({ _id: active._id, recordType: "subscription", status: "approved", statusNoticeAt: active.statusNoticeAt ?? { $exists: false } }, {
              $set: { statusNoticeAt: now }, $push: { statusCancelTokens: { hash: tokenHash(token) } },
            }, { session });
            if (changed.modifiedCount === 1) {
              await queueMail(db, "active-status", active._id, statusMail(email, active.locale, token), session, now);
              statusNoticeEvent = "queued";
            } else statusNoticeEvent = "suppressed";
          } else {
            statusNoticeEvent = "suppressed";
          }
          return;
        }
        const current = await pending.findOne({ email, recordType: "pending" }, { session });
        if (current && current.expiresAt > now) return;
        if (current) {
          await pending.deleteOne({ _id: current._id, recordType: "pending", expiresAt: { $lte: now } }, { session });
          await outbox.deleteMany({ recordType: "outbox", ownerId: current._id }, { session });
        }
        const confirmToken = randomBytes(32).toString("base64url");
        const cancelToken = randomBytes(32).toString("base64url");
        const expiresAt = new Date(now.getTime() + appConfig.newsletter.pendingMilliseconds);
        const record: Pending = {
          _id: new ObjectId(), recordType: "pending", status: "pending_approval", email, source, locale, consentVersion: `${source}-v1`, createdAt: now, expiresAt, purgeAt: expiresAt,
          confirmHashes: [tokenHash(confirmToken)], cancelHashes: [tokenHash(cancelToken)],
          lastMailAt: now, resends: 0, acceptedCount: 0,
        };
        await pending.insertOne(record, { session });
        await queueMail(db, "confirmation", record._id, confirmationMail(email, locale, confirmToken, cancelToken), session, now);
      }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary", timeoutMS: 10_000 });
      if (statusNoticeEvent) console.info(`Newsletter status-notice-${statusNoticeEvent}`);
    } finally { await session.endSession(); }
    return "accepted";
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === 11000) return "accepted";
    console.error("Newsletter request unavailable");
    return "unavailable";
  }
}

export async function resendConfirmation(email: string): Promise<RequestResult> {
  try {
    const { client, db } = await newsletterConnection();
    if (!await reserveGlobal(db)) return "limited";
    const now = await databaseNow(db);
    const { pending } = collections(db);
    const session = client.startSession();
    try {
      await session.withTransaction(async () => {
        const record = await pending.findOne({ email, recordType: "pending", expiresAt: { $gt: now } }, { session });
        if (!record || record.resends >= 2 || record.lastMailAt.getTime() + appConfig.newsletter.resendWaitMilliseconds > now.getTime()) return;
        const confirmToken = randomBytes(32).toString("base64url");
        const cancelToken = randomBytes(32).toString("base64url");
        const changed = await pending.updateOne({ _id: record._id, recordType: "pending", resends: record.resends, expiresAt: { $gt: now } }, {
          $inc: { resends: 1 }, $set: { lastMailAt: now },
          $push: { confirmHashes: tokenHash(confirmToken), cancelHashes: tokenHash(cancelToken) },
        }, { session });
        if (changed.modifiedCount === 1) await queueMail(db, "resend", record._id, confirmationMail(email, record.locale, confirmToken, cancelToken), session, now);
      }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary", timeoutMS: 10_000 });
    } finally { await session.endSession(); }
    return "accepted";
  } catch {
    console.error("Newsletter resend unavailable");
    return "unavailable";
  }
}

export async function decideSubscription(action: "confirm" | "decline", rawToken: string): Promise<"done" | "invalid" | "unavailable"> {
  if (!/^[A-Za-z0-9_-]{40,100}$/.test(rawToken)) return "invalid";
  try {
    const { client, db } = await newsletterConnection();
    const now = await databaseNow(db);
    const hash = tokenHash(rawToken);
    const { subscriptions, pending, outbox } = collections(db);
    const session = client.startSession();
    let done = false;
    try {
      await session.withTransaction(async () => {
        if (action === "confirm") {
          const request = await pending.findOne({ recordType: "pending", confirmHashes: hash, expiresAt: { $gt: now } }, { session });
          if (!request) return;
          const prior = await subscriptions.findOne({ recordType: "subscription", email: request.email }, { session });
          if (prior?.status === "approved") {
            await pending.deleteOne({ _id: request._id, recordType: "pending" }, { session });
            await outbox.deleteMany({ ownerId: request._id, recordType: "outbox" }, { session });
            done = true;
            return;
          }
          if (prior && prior.retainUntil && prior.retainUntil > now) {
            const changed = await subscriptions.updateOne({ _id: prior._id, recordType: "subscription", status: "unsubscribed", retainUntil: { $gt: now } }, {
              $set: { status: "approved", lastConfirmedAt: now, consentVersion: request.consentVersion, source: request.source, locale: request.locale, cancelHashes: request.cancelHashes, statusCancelTokens: [] },
              $unset: { unsubscribedAt: "", retainUntil: "", purgeAt: "", statusNoticeAt: "" },
            }, { session });
            if (changed.modifiedCount !== 1) throw new Error("Newsletter transition changed");
          } else {
            if (prior) await subscriptions.deleteOne({ _id: prior._id, recordType: "subscription", retainUntil: { $lte: now } }, { session });
            await subscriptions.insertOne({
              _id: new ObjectId(), recordType: "subscription", email: request.email, status: "approved", firstApprovedAt: now, lastConfirmedAt: now,
              consentVersion: request.consentVersion, source: request.source, locale: request.locale, cancelHashes: request.cancelHashes,
            }, { session });
          }
          const removed = await pending.deleteOne({ _id: request._id, recordType: "pending", confirmHashes: hash, expiresAt: { $gt: now } }, { session });
          if (removed.deletedCount !== 1) throw new Error("Newsletter confirmation changed");
          await outbox.deleteMany({ ownerId: request._id, recordType: "outbox" }, { session });
          done = true;
          return;
        }
        const request = await pending.findOne({ recordType: "pending", cancelHashes: hash, expiresAt: { $gt: now } }, { session });
        if (request) {
          const removed = await pending.deleteOne({ _id: request._id, recordType: "pending", cancelHashes: hash }, { session });
          if (removed.deletedCount !== 1) throw new Error("Newsletter decline changed");
          await outbox.deleteMany({ ownerId: request._id, recordType: "outbox" }, { session });
          done = true;
          return;
        }
        const validToken = { $or: [{ cancelHashes: hash }, { statusCancelTokens: { $elemMatch: { hash } } }] };
        const active = await subscriptions.findOne({ recordType: "subscription", status: "approved", ...validToken }, { session });
        if (!active) return;
        const retainUntil = dateAfterYears(now, appConfig.newsletter.unsubscribedYears);
        const changed = await subscriptions.updateOne({ _id: active._id, recordType: "subscription", status: "approved", ...validToken }, {
          $set: { status: "unsubscribed", unsubscribedAt: now, retainUntil, purgeAt: retainUntil, cancelHashes: [], statusCancelTokens: [] },
          $unset: { statusNoticeAt: "" },
        }, { session });
        if (changed.modifiedCount !== 1) throw new Error("Newsletter unsubscribe changed");
        await outbox.deleteMany({ ownerId: active._id, recordType: "outbox" }, { session });
        done = true;
      }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary", timeoutMS: 10_000 });
    } finally { await session.endSession(); }
    return done ? "done" : "invalid";
  } catch {
    console.error("Newsletter decision unavailable");
    return "unavailable";
  }
}

export async function runNewsletterOutboxOnce(): Promise<boolean> {
  const { db } = await newsletterConnection();
  const { outbox, pending, subscriptions } = collections(db);
  const now = await databaseNow(db);
  const sent = await outbox.findOne({ recordType: "outbox", status: "sent" });
  if (sent) { await finalizeSentMail(db, sent); return true; }
  const leaseId = randomBytes(16).toString("hex");
  const entry = await outbox.findOneAndUpdate({
    recordType: "outbox",
    $or: [{ status: "pending" }, { status: "leased", leaseUntil: { $lte: now } }],
    availableAt: { $lte: now }, expiresAt: { $gt: now },
  }, { $set: { status: "leased", leaseId, leaseUntil: new Date(now.getTime() + 5 * 60_000) }, $inc: { attempts: 1 } }, { sort: { availableAt: 1 }, returnDocument: "after" });
  if (!entry) return false;
  const isStatus = entry.kind === "active-status";
  const owner = isStatus
    ? await subscriptions.findOne({ _id: entry.ownerId, recordType: "subscription", status: "approved" })
    : await pending.findOne({ _id: entry.ownerId, recordType: "pending", expiresAt: { $gt: now } });
  if (!owner) {
    await outbox.deleteOne({ _id: entry._id, recordType: "outbox", status: "leased", leaseId });
    return true;
  }
  if (!await reserveShared(db, "smtp-hour", appConfig.newsletter.globalHourlyLimit, 60 * 60 * 1000)) {
    await outbox.updateOne({ _id: entry._id, recordType: "outbox", status: "leased", leaseId }, {
      $set: { status: "pending", availableAt: new Date(now.getTime() + 5 * 60_000) },
      $inc: { attempts: -1 }, $unset: { leaseId: "", leaseUntil: "" },
    });
    return true;
  }
  let accepted = false;
  let smtpStarted = false;
  let definitivelyRejected = false;
  try {
    const payload = decrypt(entry);
    const config = transportConfig();
    if (config) {
      const transport = nodemailer.createTransport(config);
      try {
        if (!isStatus) await pending.updateOne({ _id: entry.ownerId, recordType: "pending", expiresAt: { $gt: now } }, { $set: { smtpStartedAt: now } });
        smtpStarted = true;
        const result = await transport.sendMail({ from: config.from, to: payload.to, subject: payload.subject, text: payload.text, headers: { "Auto-Submitted": "auto-generated" } });
        if (!result.accepted?.some((value) => typeof value === "string" && value.toLowerCase() === payload.to)) {
          definitivelyRejected = true;
          throw new Error("Newsletter recipient rejected");
        }
      } finally { transport.close(); }
    } else testMailbox.push(payload);
    accepted = true;
    const marked = await outbox.updateOne({ _id: entry._id, recordType: "outbox", status: "leased", leaseId }, { $set: { status: "sent" }, $unset: { leaseId: "", leaseUntil: "" } });
    if (marked.modifiedCount !== 1) throw new Error("Newsletter lease changed");
    await finalizeSentMail(db, entry);
  } catch (error) {
    if (accepted) {
      console.error("Newsletter mail sent but finalization failed");
      return true;
    }
    if (isRecipientRejected(error)) definitivelyRejected = true;
    if (!isStatus && smtpStarted) {
      await pending.updateOne({ _id: entry.ownerId, recordType: "pending" }, definitivelyRejected
        ? { $unset: { smtpStartedAt: "" } }
        : { $set: { uncertainDelivery: true } });
    }
    if (definitivelyRejected || entry.attempts >= 5) {
      await outbox.deleteOne({ _id: entry._id, recordType: "outbox", status: "leased", leaseId });
      if (!isStatus && entry.kind === "confirmation") {
        const current = await pending.findOne({ _id: entry.ownerId, recordType: "pending" });
        if (current && current.acceptedCount === 0 && !current.uncertainDelivery
          && await outbox.countDocuments({ ownerId: entry.ownerId, recordType: "outbox" }) === 0) {
          await pending.deleteOne({ _id: entry.ownerId, recordType: "pending", acceptedCount: 0, uncertainDelivery: { $ne: true } });
        }
      }
      console.error("Newsletter mail permanently failed");
    } else {
      await outbox.updateOne({ _id: entry._id, recordType: "outbox", status: "leased", leaseId }, {
        $set: { status: "pending", availableAt: new Date(now.getTime() + Math.min(60_000 * 2 ** entry.attempts, 3_600_000)) },
        $unset: { leaseId: "", leaseUntil: "" },
      });
    }
  }
  return true;
}

export function startNewsletterWorker(): () => void {
  if (!process.env.AUTH_MONGODB_URI) return () => {};
  try { configuration(); }
  catch { console.error("Newsletter worker configuration unavailable"); return () => {}; }
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void runNewsletterOutboxOnce().catch(() => console.error("Newsletter worker unavailable")).finally(() => { running = false; });
  }, appConfig.newsletter.workerPollMilliseconds);
  timer.unref();
  return () => clearInterval(timer);
}

export function drainNewsletterTestMailbox(): MailPayload[] {
  if (process.env.NODE_ENV !== "test") throw new Error("Unavailable outside tests");
  return testMailbox.splice(0);
}
