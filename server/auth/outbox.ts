import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import nodemailer from "nodemailer";
import { ObjectId, type ClientSession } from "mongodb";
import { appConfig } from "../../lib/config.ts";
import { authDatabaseConfig, authPublicOrigin } from "./config.ts";
import { authCollections, authConnection, type AuthOutbox } from "./db.ts";
import { normalizeEmail, tokenHash } from "./security.ts";

type MailPayload = { to: string; subject: string; text: string };
const testMailbox: MailPayload[] = [];
function recipientMatches(value: string | { address?: string }, expected: string): boolean {
  const address = typeof value === "string" ? value : value.address ?? "";
  return address.trim().toLowerCase() === expected.trim().toLowerCase();
}

function decodeKey(value: string | undefined): Buffer {
  const decoded = value ? Buffer.from(value, "base64") : Buffer.alloc(0);
  if (decoded.length !== 32) throw new Error("Authentication mail is not configured");
  return decoded;
}

function currentKey() {
  const keyId = process.env.AUTH_OUTBOX_KEY_ID ?? "v1";
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(keyId)) throw new Error("Authentication mail is not configured");
  return { keyId, key: decodeKey(process.env.AUTH_OUTBOX_KEY) };
}

function keyFor(keyId: string): Buffer {
  if (keyId === currentKey().keyId) return currentKey().key;
  if (keyId === process.env.AUTH_OUTBOX_PREVIOUS_KEY_ID) return decodeKey(process.env.AUTH_OUTBOX_PREVIOUS_KEY);
  throw new Error("Authentication mail key unavailable");
}

function encrypt(payload: MailPayload, aad: string, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(aad));
  const body = Buffer.concat([cipher.update(JSON.stringify(payload)), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((part) => part.toString("base64url")).join(".");
}

function decrypt(value: string, aad: string, keyId: string): MailPayload {
  const [iv, tag, body] = value.split(".").map((part) => Buffer.from(part, "base64url"));
  if (!iv || !tag || !body || iv.length !== 12 || tag.length !== 16) throw new Error("Invalid mail payload");
  const decipher = createDecipheriv("aes-256-gcm", keyFor(keyId), iv);
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(tag);
  return JSON.parse(Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8")) as MailPayload;
}

export function mailLink(path: string, rawToken: string): string {
  const url = new URL(path, authPublicOrigin());
  url.hash = `token=${encodeURIComponent(rawToken)}`;
  return url.toString();
}

export async function queueMail(payload: MailPayload, tokenId?: string, session?: ClientSession) {
  transportConfig();
  const { db } = await authConnection();
  const now = new Date();
  const _id = new ObjectId();
  const { keyId, key } = currentKey();
  const entry: AuthOutbox = {
    _id, kind: "auth", recipientHash: tokenHash(normalizeEmail(payload.to)), encryptedPayload: encrypt(payload, `${_id.toHexString()}:${tokenId ?? ""}`, key), keyId, tokenId,
    status: "pending", attempts: 0, availableAt: now,
    expiresAt: new Date(now.getTime() + appConfig.auth.outboxRetentionSeconds * 1000), createdAt: now,
  };
  await authCollections(db).outbox.insertOne(entry, { session });
}

function transportConfig() {
  if (process.env.AUTH_MAIL_TRANSPORT === "test") {
    if (process.env.NODE_ENV !== "test") throw new Error("Test mail transport is unavailable outside tests");
    return null;
  }
  const host = process.env.AUTH_SMTP_HOST;
  const port = Number(process.env.AUTH_SMTP_PORT);
  const user = process.env.AUTH_SMTP_USER;
  const pass = process.env.AUTH_SMTP_PASSWORD;
  const from = process.env.AUTH_SMTP_FROM;
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !user || !pass || !from) throw new Error("Authentication mail is not configured");
  return { host, port, secure: port === 465, auth: { user, pass }, from, connectionTimeout: 20_000, greetingTimeout: 20_000, socketTimeout: 30_000 };
}

async function finishOutboxEntry(entry: AuthOutbox, state?: "accepted" | "failed", sent = false) {
  const { client, db } = await authConnection();
  const { outbox, tokens } = authCollections(db);
  const transaction = client.startSession();
  try {
    await transaction.withTransaction(async () => {
      const token = entry.tokenId ? await tokens.findOne({ _id: entry.tokenId }, { session: transaction }) : null;
      const invitation = token?.kind === "invitation";
      const filter = sent ? { _id: entry._id, status: "sent" as const } : { _id: entry._id, status: "leased" as const, leaseId: entry.leaseId };
      const changed = state === "failed" && !invitation && (!entry.tokenId || token)
        ? await outbox.updateOne(filter, { $set: { status: "failed" }, $unset: { leaseUntil: "", leaseId: "" } }, { session: transaction })
        : await outbox.deleteOne(filter, { session: transaction });
      if ("modifiedCount" in changed ? changed.modifiedCount !== 1 : changed.deletedCount !== 1) return;
      if (invitation && token && !token.consumedAt && token.expiresAt > new Date() && token.mailState === "queued" && state) {
        const marked = await tokens.updateOne({ _id: token._id, mailState: "queued", consumedAt: { $exists: false }, expiresAt: { $gt: new Date() } }, { $set: { mailState: state, mailStateAt: new Date() } }, { session: transaction });
        if (marked.modifiedCount !== 1) throw new Error("Invitation state changed");
      }
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary", timeoutMS: 10_000 });
  } finally { await transaction.endSession(); }
}

export async function runOutboxOnce(): Promise<boolean> {
  const config = transportConfig();
  const { db } = await authConnection();
  const { outbox, tokens } = authCollections(db);
  const sent = await outbox.findOne({ status: "sent" });
  if (sent) { await finishOutboxEntry(sent, "accepted", true); return true; }
  const now = new Date();
  const leaseId = randomBytes(16).toString("hex");
  const entry = await outbox.findOneAndUpdate(
    { $or: [{ status: "pending" }, { status: "leased", leaseUntil: { $lte: now } }], availableAt: { $lte: now }, expiresAt: { $gt: now } },
    { $set: { status: "leased", leaseId, leaseUntil: new Date(now.getTime() + appConfig.auth.outboxLeaseSeconds * 1000) }, $inc: { attempts: 1 } },
    { sort: { createdAt: 1 }, returnDocument: "after" },
  );
  if (!entry) return false;
  let delivered = false;
  try {
    if (entry.tokenId) {
      const token = await tokens.findOne({ _id: entry.tokenId, consumedAt: { $exists: false }, expiresAt: { $gt: new Date() } });
      if (!token) { await finishOutboxEntry(entry); return true; }
    }
    const payload = decrypt(entry.encryptedPayload, `${entry._id.toHexString()}:${entry.tokenId ?? ""}`, entry.keyId);
    if (config) {
      const transport = nodemailer.createTransport(config);
      let renewal: Promise<void> | undefined;
      let leaseLost = false;
      const timer = setInterval(() => {
        if (renewal || leaseLost) return;
        renewal = outbox.updateOne({ _id: entry._id, status: "leased", leaseId }, { $set: { leaseUntil: new Date(Date.now() + appConfig.auth.outboxLeaseSeconds * 1000) } })
          .then((result) => { if (result.modifiedCount !== 1) { leaseLost = true; transport.close(); } })
          .catch(() => { leaseLost = true; transport.close(); })
          .finally(() => { renewal = undefined; });
      }, Math.min(60, appConfig.auth.outboxLeaseSeconds / 3) * 1000);
      timer.unref();
      try {
        const result = await transport.sendMail({ from: config.from, to: { address: payload.to }, subject: payload.subject, text: payload.text });
        if (renewal) await renewal;
        if (!result.accepted?.some((address) => recipientMatches(address, payload.to)) || result.rejected?.some((address) => recipientMatches(address, payload.to))) {
          throw Object.assign(new Error("Recipient rejected"), { recipientRejected: true, responseCode: 550 });
        }
      }
      finally { clearInterval(timer); if (renewal) await renewal; transport.close(); }
    } else {
      testMailbox.push(payload);
    }
    delivered = true;
    const marked = await outbox.updateOne({ _id: entry._id, leaseId, status: "leased" }, { $set: { status: "sent" }, $unset: { leaseUntil: "", leaseId: "" } });
    if (marked.modifiedCount !== 1) throw new Error("Outbox lease changed after SMTP acceptance");
    await finishOutboxEntry(entry, "accepted", true);
  } catch (error) {
    if (delivered) {
      console.error("Authentication mail sent but outbox finalization failed");
      return true;
    }
    const attempts = entry.attempts;
    const responseCode = error && typeof error === "object" && "responseCode" in error ? Number(error.responseCode) : 0;
    const command = error && typeof error === "object" && "command" in error ? String(error.command) : "";
    const rejected = error && typeof error === "object" && "recipientRejected" in error && error.recipientRejected === true;
    const failed = attempts >= 5 || rejected || [550, 551, 553].includes(responseCode) && command.startsWith("RCPT");
    if (failed) {
      console.error("Authentication mail permanently failed", { id: entry._id.toHexString(), attempts, responseCode });
      await finishOutboxEntry(entry, "failed");
    }
    else await outbox.updateOne({ _id: entry._id, status: "leased", leaseId }, {
      $set: { status: "pending", availableAt: new Date(Date.now() + Math.min(60_000 * 2 ** attempts, 3_600_000)) },
      $unset: { leaseUntil: "", leaseId: "" },
    });
  }
  return true;
}

export function startOutboxWorker() {
  if (!process.env.AUTH_MONGODB_URI) return () => {};
  authDatabaseConfig();
  authPublicOrigin();
  transportConfig();
  currentKey();
  let running = false;
  const timer = setInterval(() => {
    if (running) return;
    running = true;
    void runOutboxOnce().catch(() => { console.error("Authentication mail delivery failed"); }).finally(() => { running = false; });
  }, appConfig.auth.outboxPollMilliseconds);
  timer.unref();
  return () => clearInterval(timer);
}

export function drainTestMailbox() {
  if (process.env.NODE_ENV !== "test") throw new Error("Unavailable outside tests");
  return testMailbox.splice(0);
}
