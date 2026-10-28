import { MongoClient, ObjectId, type ClientSession, type Db } from "mongodb";
import { authDatabaseConfig } from "./config.ts";

export type AdminStatus = "active" | "disabled";
export type BootstrapState = "uninitialized" | "pending" | "consumed";
export type TokenKind = "bootstrap" | "invitation" | "reset" | "email-change" | "reactivation";

export type AdminUser = {
  _id: ObjectId;
  email: string;
  username: string;
  passwordHash: string;
  authGeneration: number;
  authorizationSerial?: number;
  previousEmailHashes?: string[];
  createdBy?: ObjectId;
  resetGeneration?: number;
  emailChangeGeneration?: number;
  reactivationGeneration?: number;
  status: AdminStatus;
  createdAt: Date;
  updatedAt: Date;
};

export type AuthSession = {
  _id: string;
  userId: ObjectId;
  authGeneration: number;
  createdAt: Date;
  lastSeenAt: Date;
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
  deviceLabel: string;
  csrfSecret: string;
  reauthUntil?: Date;
  sensitiveSerial?: number;
};

export type AuthToken = {
  _id: string;
  kind: TokenKind;
  userId?: ObjectId;
  email: string;
  createdAt: Date;
  expiresAt: Date;
  consumedAt?: Date;
  createdBy?: ObjectId;
  mailState?: "queued" | "accepted" | "failed";
  mailStateAt?: Date;
};

export type AdminControl = {
  _id: "singleton";
  schemaId: "wct-auth-v1";
  newsletterSchemaId?: "wct-newsletter-v1";
  bootstrapState: BootstrapState;
  bootstrapEmail?: string;
  ownerUserId?: ObjectId;
  activeCount: number;
  tokenSerial?: number;
};

export type AuthOutbox = {
  _id: ObjectId;
  kind: string;
  recipientHash: string;
  encryptedPayload: string;
  keyId: string;
  tokenId?: string;
  status: "pending" | "leased" | "failed" | "sent";
  attempts: number;
  availableAt: Date;
  expiresAt: Date;
  leaseUntil?: Date;
  leaseId?: string;
  createdAt: Date;
};

export type AuthAudit = {
  _id: ObjectId;
  kind: string;
  at: Date;
  expiresAt: Date;
  actorId?: ObjectId;
  targetId?: ObjectId;
  outcome: "success" | "failure";
  ipPrefix?: string;
};

export type AuthRateLimit = {
  _id: string;
  count: number;
  expiresAt: Date;
};

export type AuthCollections = ReturnType<typeof authCollections>;

export function authCollections(db: Db) {
  return {
    users: db.collection<AdminUser>("adminUsers"),
    sessions: db.collection<AuthSession>("authSessions"),
    tokens: db.collection<AuthToken>("authTokens"),
    control: db.collection<AdminControl>("adminControl"),
    outbox: db.collection<AuthOutbox>("authOutbox"),
    audit: db.collection<AuthAudit>("authAudit"),
    limits: db.collection<AuthRateLimit>("authRateLimits"),
  };
}

export type AuthConnection = { client: MongoClient; db: Db };
const shared = globalThis as typeof globalThis & { __wctAuthConnection?: Promise<AuthConnection> };

export async function authConnection(): Promise<AuthConnection> {
  if (!shared.__wctAuthConnection) {
    const { uri, databaseName, tlsRequired } = authDatabaseConfig();
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 4000, appName: "wct-admin", ...(tlsRequired ? { tls: true, tlsAllowInvalidCertificates: false, tlsAllowInvalidHostnames: false } : {}) });
    shared.__wctAuthConnection = client.connect().then(() => ({ client, db: client.db(databaseName) })).catch(async (error: unknown) => {
      shared.__wctAuthConnection = undefined;
      await client.close().catch(() => {});
      throw error;
    });
  }
  return shared.__wctAuthConnection;
}

export async function closeAuthConnection() {
  const connection = shared.__wctAuthConnection;
  shared.__wctAuthConnection = undefined;
  if (connection) await (await connection).client.close();
}

export async function createAuthIndexes(db: Db) {
  const collections = authCollections(db);
  await collections.users.createIndex({ email: 1 }, { unique: true, collation: { locale: "en", strength: 2 } });
  await collections.users.createIndex({ status: 1 });
  await collections.sessions.createIndex({ userId: 1 });
  await collections.sessions.createIndex({ absoluteExpiresAt: 1 }, { expireAfterSeconds: 0 });
  await collections.tokens.createIndex({ kind: 1, email: 1 });
  await collections.tokens.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await collections.outbox.createIndex({ status: 1, availableAt: 1 });
  await collections.outbox.createIndex({ recipientHash: 1 });
  await collections.outbox.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await collections.limits.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  await collections.audit.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
}

export async function ensureAdminControl(db: Db, session?: ClientSession) {
  const { control } = authCollections(db);
  await control.updateOne(
    { _id: "singleton" },
    { $setOnInsert: { schemaId: "wct-auth-v1", bootstrapState: "uninitialized", activeCount: 0 } },
    { upsert: true, session },
  );
}

export async function assertAdminCount(connection: AuthConnection) {
  const { client, db } = connection;
  const { control, users } = authCollections(db);
  const session = client.startSession();
  try {
    return await session.withTransaction(async () => {
      const record = await control.findOne({ _id: "singleton" }, { session });
      const actual = await users.countDocuments({ status: "active" }, { session });
      if (!record || record.schemaId !== "wct-auth-v1" || record.activeCount !== actual) throw new AdminTransitionError("Administrator count mismatch");
      return actual;
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary", timeoutMS: 10_000 });
  } finally {
    await session.endSession();
  }
}

export class AdminTransitionError extends Error {
  constructor(message: string) { super(message); }
}

export async function transitionAdminStatus(
  connection: AuthConnection,
  userId: ObjectId,
  from: AdminStatus,
  to: AdminStatus,
  actor?: AdminUser,
  onTransition?: (session: ClientSession) => Promise<void>,
  assertActorSession?: (session: ClientSession) => Promise<void>,
): Promise<void> {
  const { client, db } = connection;
  if (from === to) throw new AdminTransitionError("Status must change");
  const delta = to === "active" ? 1 : -1;
  const { control, users, tokens, outbox, sessions } = authCollections(db);
  const session = client.startSession();
  try {
    await session.withTransaction(async () => {
        const snapshot = await control.findOne({ _id: "singleton" }, { session });
        const actual = await users.countDocuments({ status: "active" }, { session });
        if (!snapshot || snapshot.schemaId !== "wct-auth-v1" || snapshot.activeCount !== actual) throw new AdminTransitionError("Administrator count mismatch");
        if (actor) {
          if (assertActorSession) await assertActorSession(session);
          const checked = await users.updateOne({ _id: actor._id, status: "active", authGeneration: actor.authGeneration }, { $inc: { authorizationSerial: 1 } }, { session });
          if (checked.modifiedCount !== 1) throw new AdminTransitionError("Acting administrator unavailable");
        }
        const user = await users.updateOne({ _id: userId, status: from }, { $set: { status: to, updatedAt: new Date() }, $inc: { authGeneration: 1 } }, { session });
        if (user.modifiedCount !== 1) throw new AdminTransitionError("Administrator status changed");
        const controlResult = await control.updateOne(
          delta < 0 ? { _id: "singleton", activeCount: { $gt: 1 } } : { _id: "singleton" },
          { $inc: { activeCount: delta } },
          { session },
        );
        if (controlResult.modifiedCount !== 1) throw new AdminTransitionError("Cannot remove the final administrator");
        if (to === "disabled") {
          const stale = await tokens.find({ $or: [{ userId }, { kind: "invitation", createdBy: userId }] }, { session, projection: { _id: 1 } }).toArray();
          await tokens.deleteMany({ $or: [{ userId }, { kind: "invitation", createdBy: userId }] }, { session });
          if (stale.length) await outbox.deleteMany({ tokenId: { $in: stale.map((item) => item._id) } }, { session });
          await sessions.deleteMany({ userId }, { session });
        }
        if (onTransition) await onTransition(session);
    }, { readConcern: { level: "snapshot" }, writeConcern: { w: "majority" }, readPreference: "primary", timeoutMS: 10_000 });
  } finally {
    await session.endSession();
  }
}
