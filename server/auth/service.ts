import { ObjectId, type ClientSession } from "mongodb";
import { appConfig } from "../../lib/config.ts";
import { authCollections, authConnection, type AdminUser, type AuthAudit, type AuthToken, type TokenKind } from "./db.ts";
import { mailLink, queueMail } from "./outbox.ts";
import { hashPassword } from "./password.ts";
import { assertRecentReauth, normalizeEmail, randomToken, tokenHash, validateUsername, type VerifiedSession } from "./security.ts";

const transactionOptions = { readConcern: { level: "snapshot" as const }, writeConcern: { w: "majority" as const }, readPreference: "primary" as const, timeoutMS: 10_000 };
export class AuthFlowError extends Error {}

function expiry(seconds: number) { return new Date(Date.now() + seconds * 1000); }

export async function audit(kind: string, outcome: AuthAudit["outcome"], actorId?: ObjectId, targetId?: ObjectId, session?: ClientSession) {
  const { db } = await authConnection();
  const now = new Date();
  await authCollections(db).audit.insertOne({
    _id: new ObjectId(), kind, outcome, at: now,
    expiresAt: new Date(now.getTime() + appConfig.auth.auditRetentionSeconds * 1000), actorId, targetId,
  }, { session });
}

async function revokeTokens(kind: TokenKind, email: string, session: ClientSession) {
  const { db } = await authConnection();
  const { tokens, outbox } = authCollections(db);
  const previous = await tokens.find({ kind, email, consumedAt: { $exists: false } }, { session, projection: { _id: 1 } }).toArray();
  if (!previous.length) return;
  const ids = previous.map((item) => item._id);
  await tokens.deleteMany({ _id: { $in: ids } }, { session });
  await outbox.deleteMany({ tokenId: { $in: ids } }, { session });
}

export async function revokeUserTokens(userId: ObjectId, session: ClientSession) {
  const { db } = await authConnection();
  const { tokens, outbox } = authCollections(db);
  const filter = { $or: [{ userId }, { createdBy: userId }] };
  const previous = await tokens.find(filter, { session, projection: { _id: 1 } }).toArray();
  if (!previous.length) return;
  await tokens.deleteMany(filter, { session });
  await outbox.deleteMany({ tokenId: { $in: previous.map((item) => item._id) } }, { session });
}

async function assertActiveActor(actor: AdminUser, session: ClientSession) {
  const { db } = await authConnection();
  const changed = await authCollections(db).users.updateOne(
    { _id: actor._id, status: "active", authGeneration: actor.authGeneration },
    { $inc: { authorizationSerial: 1 } }, { session },
  );
  if (changed.modifiedCount !== 1) throw new AuthFlowError("Administrator unavailable");
}

export async function notifyAdministrators(subject: string, text: string, session: ClientSession) {
  const { db } = await authConnection();
  const recipients = await authCollections(db).users.find({ status: "active" }, { session, projection: { email: 1 } }).toArray();
  for (const recipient of recipients) await queueMail({ to: recipient.email, subject, text }, undefined, session);
}

async function issueToken(kind: TokenKind, email: string, userId: ObjectId | undefined, createdBy: ObjectId | undefined, session: ClientSession) {
  const { db } = await authConnection();
  const raw = randomToken();
  const token: AuthToken = {
    _id: tokenHash(raw), kind, email, userId, createdBy, createdAt: new Date(),
    expiresAt: expiry(kind === "reset" ? appConfig.auth.resetSeconds : appConfig.auth.invitationSeconds),
    ...(kind === "invitation" ? { mailState: "queued" as const, mailStateAt: new Date() } : {}),
  };
  await authCollections(db).tokens.insertOne(token, { session });
  const path = kind === "reset" ? `${appConfig.paths.admin}/reset` : kind === "email-change" ? `${appConfig.paths.admin}/email` : `${appConfig.paths.admin}/invite`;
  const link = mailLink(path, raw);
  const subject = kind === "reset" ? "WebCreativeTeam password reset" : kind === "email-change" ? "WebCreativeTeam email confirmation" : "WebCreativeTeam administrator invitation";
  await queueMail({ to: email, subject, text: `${subject}\n\n${link}\n` }, token._id, session);
}

export async function bootstrapOwner(rawEmail: string) {
  const email = normalizeEmail(rawEmail);
  const { client, db } = await authConnection();
  const { control, users } = authCollections(db);
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      const state = await control.findOne({ _id: "singleton" }, { session });
      if (!state || state.schemaId !== "wct-auth-v1" || state.bootstrapState === "consumed" || state.activeCount !== 0 || (state.bootstrapState === "pending" && state.bootstrapEmail !== email)) throw new AuthFlowError("Bootstrap unavailable");
      if (await users.findOne({ email }, { session, collation: { locale: "en", strength: 2 } })) throw new AuthFlowError("Bootstrap email already exists");
      await revokeTokens("bootstrap", email, session);
      await issueToken("bootstrap", email, undefined, undefined, session);
      const result = await control.updateOne(
        { _id: "singleton", schemaId: "wct-auth-v1", activeCount: 0, bootstrapState: state.bootstrapState },
        { $set: { bootstrapState: "pending", bootstrapEmail: email } }, { session },
      );
      if (result.matchedCount !== 1) throw new AuthFlowError("Bootstrap race");
      await audit("bootstrap-invite", "success", undefined, undefined, session);
    }, transactionOptions);
  } finally { await session.endSession(); }
}

export async function inviteAdministrator(rawEmail: string, actor: AdminUser, verified: VerifiedSession) {
  const email = normalizeEmail(rawEmail);
  const { client, db } = await authConnection();
  const { users, control } = authCollections(db);
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      await assertRecentReauth(verified, session);
      await assertActiveActor(actor, session);
      const marker = await control.updateOne({ _id: "singleton", schemaId: "wct-auth-v1" }, { $inc: { tokenSerial: 1 } }, { session });
      if (marker.matchedCount !== 1) throw new AuthFlowError("Administrator control unavailable");
      if (await users.findOne({ email }, { session, collation: { locale: "en", strength: 2 } })) throw new AuthFlowError("Account already exists");
      await revokeTokens("invitation", email, session);
      await issueToken("invitation", email, undefined, actor._id, session);
      await notifyAdministrators("WebCreativeTeam administrator invitation", "An administrator invitation was created.", session);
      await audit("administrator-invite", "success", actor._id, undefined, session);
    }, transactionOptions);
  } finally { await session.endSession(); }
}

export async function cancelInvitation(id: string, actor: AdminUser, verified: VerifiedSession) {
  const { client, db } = await authConnection();
  const { tokens, outbox } = authCollections(db);
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      await assertRecentReauth(verified, session);
      await assertActiveActor(actor, session);
      const removed = await tokens.deleteOne({ _id: id, kind: "invitation" }, { session });
      if (removed.deletedCount !== 1) return;
      await outbox.deleteMany({ tokenId: id }, { session });
      await audit("invitation-cancelled", "success", actor._id, undefined, session);
    }, transactionOptions);
  } finally { await session.endSession(); }
}

export async function validateOneTimeToken(raw: string, kind: TokenKind) {
  if (raw.length !== Math.ceil(appConfig.auth.tokenBytes * 8 / 6) || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  const { db } = await authConnection();
  return authCollections(db).tokens.findOne({ _id: tokenHash(raw), kind, consumedAt: { $exists: false }, expiresAt: { $gt: new Date() } });
}

export async function acceptInvitation(raw: string, username: string, password: string) {
  const existing = await validateOneTimeToken(raw, "bootstrap") ?? await validateOneTimeToken(raw, "invitation");
  if (!existing) throw new AuthFlowError("Invitation unavailable");
  const name = validateUsername(username);
  const passwordHash = await hashPassword(password);
  const { client, db } = await authConnection();
  const { tokens, users, control, outbox } = authCollections(db);
  const session = client.startSession();
  let newUserId: ObjectId | undefined;
  try {
    await session.withTransaction(async () => {
      const token = await tokens.findOne({ _id: tokenHash(raw), kind: { $in: ["bootstrap", "invitation"] }, consumedAt: { $exists: false }, expiresAt: { $gt: new Date() } }, { session });
      if (!token) throw new AuthFlowError("Invitation unavailable");
      if (token.kind === "invitation" && (!token.createdBy || !await users.findOne({ _id: token.createdBy, status: "active" }, { session }))) throw new AuthFlowError("Invitation unavailable");
      if (await users.findOne({ email: token.email }, { session, collation: { locale: "en", strength: 2 } })) throw new AuthFlowError("Invitation unavailable");
      const state = await control.findOne({ _id: "singleton" }, { session });
      if (!state || state.schemaId !== "wct-auth-v1" || (token.kind === "bootstrap" && (state.bootstrapState !== "pending" || state.bootstrapEmail !== token.email || state.activeCount !== 0))) throw new AuthFlowError("Invitation unavailable");
      newUserId = new ObjectId();
      const now = new Date();
      await users.insertOne({ _id: newUserId, email: token.email, username: name, passwordHash, authGeneration: 0, createdBy: token.createdBy, status: "active", createdAt: now, updatedAt: now }, { session });
      const filter = token.kind === "bootstrap" ? { _id: "singleton" as const, bootstrapState: "pending" as const, activeCount: 0 } : { _id: "singleton" as const };
      const change = token.kind === "bootstrap" ? { $inc: { activeCount: 1 }, $set: { bootstrapState: "consumed" as const, ownerUserId: newUserId } } : { $inc: { activeCount: 1 } };
      const result = await control.updateOne(filter, change, { session });
      if (result.modifiedCount !== 1) throw new AuthFlowError("Invitation race");
      const consumed = await tokens.updateOne({ _id: token._id, consumedAt: { $exists: false }, expiresAt: { $gt: new Date() } }, { $set: { consumedAt: new Date() } }, { session });
      if (consumed.modifiedCount !== 1) throw new AuthFlowError("Invitation race");
      await outbox.deleteMany({ tokenId: token._id }, { session });
      await notifyAdministrators("WebCreativeTeam administrator joined", "An administrator invitation was accepted.", session);
      await audit("invitation-accepted", "success", newUserId, newUserId, session);
    }, transactionOptions);
  } finally { await session.endSession(); }
}

export async function requestPasswordReset(rawEmail: string) {
  let email: string;
  try { email = normalizeEmail(rawEmail); } catch { return; }
  const { client, db } = await authConnection();
  const { users } = authCollections(db);
  const user = await users.findOne({ email, status: "active" }, { collation: { locale: "en", strength: 2 } });
  if (!user) return;
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      const current = await users.updateOne({ _id: user._id, status: "active" }, { $inc: { resetGeneration: 1 } }, { session });
      if (current.matchedCount !== 1) throw new AuthFlowError("Reset unavailable");
      await revokeTokens("reset", email, session);
      await issueToken("reset", email, user._id, undefined, session);
      await audit("password-reset-request", "success", user._id, user._id, session);
    }, transactionOptions);
  } finally { await session.endSession(); }
}

export async function completePasswordReset(raw: string, password: string) {
  if (!await validateOneTimeToken(raw, "reset")) throw new AuthFlowError("Reset unavailable");
  const passwordHash = await hashPassword(password);
  const { client, db } = await authConnection();
  const { tokens, users, sessions } = authCollections(db);
  const session = client.startSession();
  let userId: ObjectId | undefined;
  try {
    await session.withTransaction(async () => {
      const token = await tokens.findOne({ _id: tokenHash(raw), kind: "reset", consumedAt: { $exists: false }, expiresAt: { $gt: new Date() } }, { session });
      if (!token?.userId) throw new AuthFlowError("Reset unavailable");
      const changed = await users.updateOne({ _id: token.userId, status: "active" }, { $set: { passwordHash, updatedAt: new Date() }, $inc: { authGeneration: 1 } }, { session });
      if (changed.modifiedCount !== 1) throw new AuthFlowError("Reset unavailable");
      userId = token.userId;
      await sessions.deleteMany({ userId }, { session });
      await revokeUserTokens(userId, session);
      await notifyAdministrators("WebCreativeTeam password reset", "An administrator password was reset.", session);
      await audit("password-reset", "success", userId, userId, session);
    }, transactionOptions);
  } finally { await session.endSession(); }
}

export async function requestEmailChange(user: AdminUser, rawEmail: string) {
  const email = normalizeEmail(rawEmail);
  if (email === user.email) throw new AuthFlowError("Email unchanged");
  const { client, db } = await authConnection();
  const { users } = authCollections(db);
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      const current = await users.updateOne({ _id: user._id, status: "active", authGeneration: user.authGeneration }, { $inc: { emailChangeGeneration: 1 } }, { session });
      if (current.matchedCount !== 1) throw new AuthFlowError("Email change unavailable");
      if (await users.findOne({ email }, { session, collation: { locale: "en", strength: 2 } })) throw new AuthFlowError("Email already registered");
      const previous = await authCollections(db).tokens.find({ kind: "email-change", userId: user._id }, { session, projection: { _id: 1 } }).toArray();
      await authCollections(db).tokens.deleteMany({ kind: "email-change", userId: user._id }, { session });
      if (previous.length) await authCollections(db).outbox.deleteMany({ tokenId: { $in: previous.map((item) => item._id) } }, { session });
      await issueToken("email-change", email, user._id, user._id, session);
      await queueMail({ to: user.email, subject: "WebCreativeTeam email change requested", text: "An email change was requested for your administrator account. If this was not you, contact the site owner." }, undefined, session);
      await audit("email-change-request", "success", user._id, user._id, session);
    }, transactionOptions);
  } finally { await session.endSession(); }
}

export async function confirmEmailChange(raw: string) {
  const token = await validateOneTimeToken(raw, "email-change");
  if (!token?.userId) throw new AuthFlowError("Email confirmation unavailable");
  const { client, db } = await authConnection();
  const { users, tokens, outbox, sessions } = authCollections(db);
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      const current = await tokens.findOne({ _id: tokenHash(raw), kind: "email-change", consumedAt: { $exists: false }, expiresAt: { $gt: new Date() } }, { session });
      if (!current?.userId) throw new AuthFlowError("Email confirmation unavailable");
      const user = await users.findOne({ _id: current.userId, status: "active" }, { session });
      if (!user) throw new AuthFlowError("Email confirmation unavailable");
      if (await users.findOne({ email: current.email, _id: { $ne: user._id } }, { session, collation: { locale: "en", strength: 2 } })) throw new AuthFlowError("Email confirmation unavailable");
      const changed = await users.updateOne({ _id: user._id, status: "active" }, { $set: { email: current.email, updatedAt: new Date() }, $addToSet: { previousEmailHashes: tokenHash(user.email) }, $inc: { authGeneration: 1 } }, { session });
      if (changed.modifiedCount !== 1) throw new AuthFlowError("Email confirmation unavailable");
      const old = await tokens.find({ userId: user._id, kind: { $in: ["reset", "email-change"] } }, { session, projection: { _id: 1 } }).toArray();
      await tokens.deleteMany({ userId: user._id, kind: { $in: ["reset", "email-change"] } }, { session });
      if (old.length) await outbox.deleteMany({ tokenId: { $in: old.map((item) => item._id) } }, { session });
      await sessions.deleteMany({ userId: user._id }, { session });
      await queueMail({ to: user.email, subject: "WebCreativeTeam email changed", text: "The email address on your administrator account was changed. If this was not you, contact the site owner immediately." }, undefined, session);
      await notifyAdministrators("WebCreativeTeam administrator email changed", "An administrator account email address was changed.", session);
      await audit("email-changed", "success", user._id, user._id, session);
    }, transactionOptions);
  } finally { await session.endSession(); }
}

export async function requestReactivation(userId: ObjectId, actor: AdminUser, verified: VerifiedSession) {
  const { client, db } = await authConnection();
  const { users, tokens, outbox } = authCollections(db);
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      await assertRecentReauth(verified, session);
      await assertActiveActor(actor, session);
      const target = await users.findOne({ _id: userId, status: "disabled" }, { session });
      if (!target) throw new AuthFlowError("Administrator unavailable");
      await users.updateOne({ _id: userId, status: "disabled" }, { $inc: { reactivationGeneration: 1 } }, { session });
      const previous = await tokens.find({ kind: "reactivation", userId }, { session, projection: { _id: 1 } }).toArray();
      await tokens.deleteMany({ kind: "reactivation", userId }, { session });
      if (previous.length) await outbox.deleteMany({ tokenId: { $in: previous.map((item) => item._id) } }, { session });
      await issueToken("reactivation", target.email, userId, actor._id, session);
      await audit("reactivation-request", "success", actor._id, userId, session);
    }, transactionOptions);
  } finally { await session.endSession(); }
}

export async function acceptReactivation(raw: string, password: string) {
  if (!await validateOneTimeToken(raw, "reactivation")) throw new AuthFlowError("Reactivation unavailable");
  const passwordHash = await hashPassword(password);
  const { client, db } = await authConnection();
  const { control, users, tokens, outbox } = authCollections(db);
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      const token = await tokens.findOne({ _id: tokenHash(raw), kind: "reactivation", consumedAt: { $exists: false }, expiresAt: { $gt: new Date() } }, { session });
      if (!token?.userId || !token.createdBy || !await users.findOne({ _id: token.createdBy, status: "active" }, { session })) throw new AuthFlowError("Reactivation unavailable");
      const state = await control.findOne({ _id: "singleton" }, { session });
      const actual = await users.countDocuments({ status: "active" }, { session });
      if (!state || state.activeCount !== actual) throw new AuthFlowError("Administrator count mismatch");
      const changed = await users.updateOne({ _id: token.userId, status: "disabled" }, { $set: { status: "active", passwordHash, updatedAt: new Date() }, $inc: { authGeneration: 1 } }, { session });
      if (changed.modifiedCount !== 1) throw new AuthFlowError("Reactivation unavailable");
      const count = await control.updateOne({ _id: "singleton", activeCount: state.activeCount }, { $inc: { activeCount: 1 } }, { session });
      if (count.modifiedCount !== 1) throw new AuthFlowError("Reactivation race");
      await authCollections(db).sessions.deleteMany({ userId: token.userId }, { session });
      await tokens.deleteMany({ kind: "reactivation", userId: token.userId }, { session });
      await outbox.deleteMany({ tokenId: token._id }, { session });
      await audit("administrator-reactivated", "success", token.createdBy, token.userId, session);
    }, transactionOptions);
  } finally { await session.endSession(); }
}

export async function deleteAdministrator(userId: ObjectId, confirmation: string, actor: AdminUser, verified: VerifiedSession) {
  const { client, db } = await authConnection();
  const { control, users, sessions, tokens, outbox } = authCollections(db);
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      await assertRecentReauth(verified, session);
      await assertActiveActor(actor, session);
      const state = await control.findOne({ _id: "singleton" }, { session });
      const target = await users.findOne({ _id: userId, status: "disabled" }, { session });
      if (!state || !target || state.ownerUserId?.equals(userId) || target.email !== confirmation) throw new AuthFlowError("Deletion unavailable");
      const active = await users.countDocuments({ status: "active" }, { session });
      if (state.activeCount !== active || active < 1) throw new AuthFlowError("Administrator count mismatch");
      const stale = await tokens.find({ $or: [{ userId }, { createdBy: userId }] }, { session, projection: { _id: 1 } }).toArray();
      await tokens.deleteMany({ $or: [{ userId }, { createdBy: userId }] }, { session });
      if (stale.length) await outbox.deleteMany({ tokenId: { $in: stale.map((item) => item._id) } }, { session });
      await outbox.deleteMany({ recipientHash: { $in: [tokenHash(target.email), ...(target.previousEmailHashes ?? [])] } }, { session });
      await sessions.deleteMany({ userId }, { session });
      const deleted = await users.deleteOne({ _id: userId, status: "disabled" }, { session });
      if (deleted.deletedCount !== 1) throw new AuthFlowError("Deletion unavailable");
      await authCollections(db).audit.updateMany({ actorId: userId }, { $unset: { actorId: "" } }, { session });
      await authCollections(db).audit.updateMany({ targetId: userId }, { $unset: { targetId: "" } }, { session });
      await notifyAdministrators("WebCreativeTeam administrator deleted", "A disabled administrator account was permanently deleted.", session);
      await audit("administrator-deleted", "success", actor._id, undefined, session);
    }, transactionOptions);
  } finally { await session.endSession(); }
}

export async function recoverOwner(rawEmail: string, compromisedIds: ObjectId[]) {
  const email = normalizeEmail(rawEmail);
  const lockedHash = await hashPassword(randomToken());
  const { client, db } = await authConnection();
  const { control, users, sessions, tokens, outbox } = authCollections(db);
  const state = await control.findOne({ _id: "singleton" });
  if (!state?.ownerUserId || state.bootstrapState !== "consumed") throw new AuthFlowError("Owner unavailable");
  const ownerId = state.ownerUserId;
  const suspectIds = compromisedIds.filter((id) => !id.equals(ownerId));
  let createdIds: string[] = [];
  let pendingIds: string[] = [];
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
      const controlState = await control.findOne({ _id: "singleton" }, { session });
      const owner = await users.findOne({ _id: ownerId }, { session });
      const conflict = await users.findOne({ email, _id: { $ne: ownerId } }, { session, collation: { locale: "en", strength: 2 } });
      const activeCount = await users.countDocuments({ status: "active" }, { session });
      if (!controlState || !owner || conflict || controlState.activeCount !== activeCount) throw new AuthFlowError("Recovery unavailable");
      const lineage = await users.find({}, { session, projection: { _id: 1, createdBy: 1 } }).toArray();
      const suspected = new Set(suspectIds.map((id) => id.toHexString()));
      let expanded = true;
      while (expanded) {
        expanded = false;
        for (const account of lineage) {
          const id = account._id.toHexString();
          if (account.createdBy && suspected.has(account.createdBy.toHexString()) && !suspected.has(id) && !account._id.equals(ownerId)) {
            suspected.add(id);
            expanded = true;
          }
        }
      }
      const allSuspectIds = [...suspected].map((id) => new ObjectId(id));
      createdIds = lineage.filter((account) => account.createdBy && suspected.has(account.createdBy.toHexString())).map((account) => account._id.toHexString());
      const pending = await tokens.find({ kind: "invitation", createdBy: { $in: allSuspectIds } }, { session, projection: { _id: 1 } }).toArray();
      pendingIds = pending.map((item) => item._id);
      const compromised = await users.find({ _id: { $in: allSuspectIds }, status: "active" }, { session, projection: { _id: 1 } }).toArray();
      if (compromised.length) await users.updateMany({ _id: { $in: compromised.map((item) => item._id) }, status: "active" }, { $set: { status: "disabled", updatedAt: new Date() }, $inc: { authGeneration: 1 } }, { session });
      const ownerDelta = owner.status === "disabled" ? 1 : 0;
      await users.updateOne({ _id: ownerId }, { $set: { status: "active", email, passwordHash: lockedHash, updatedAt: new Date() }, $inc: { authGeneration: 1 } }, { session });
      const newCount = activeCount - compromised.length + ownerDelta;
      if (newCount < 1) throw new AuthFlowError("Recovery unavailable");
      const countChange = await control.updateOne({ _id: "singleton", activeCount }, { $set: { activeCount: newCount } }, { session });
      if (countChange.matchedCount !== 1) throw new AuthFlowError("Recovery race");
      const revokedIds = [ownerId, ...allSuspectIds];
      const stale = await tokens.find({ $or: [{ userId: { $in: revokedIds } }, { createdBy: { $in: revokedIds } }] }, { session, projection: { _id: 1 } }).toArray();
      await tokens.deleteMany({ $or: [{ userId: { $in: revokedIds } }, { createdBy: { $in: revokedIds } }] }, { session });
      if (stale.length) await outbox.deleteMany({ tokenId: { $in: stale.map((item) => item._id) } }, { session });
      await sessions.deleteMany({ userId: { $in: revokedIds } }, { session });
      await issueToken("reset", email, ownerId, undefined, session);
      await audit("owner-recovery", "success", ownerId, ownerId, session);
    }, transactionOptions);
    return { createdIds, pendingIds };
  } finally { await session.endSession(); }
}
