import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MongoClient, ObjectId, type Db } from "mongodb";
import { appConfig } from "../../lib/config.js";
import {
  assertAdminCount, authCollections, createAuthIndexes, ensureAdminControl, transitionAdminStatus,
  type AdminUser, type AuthSession,
} from "../../server/auth/db.js";
import { authCookieConfig, authDatabaseConfig, authPublicOrigin, authTrustedProxies } from "../../server/auth/config.js";
import { clientIpBucket, hasRecentReauth, isSessionCurrent } from "../../server/auth/security.js";

describe("authentication configuration", () => {
  it("buckets IP addresses in the actual Node ESM runtime", () => {
    const moduleUrl = new URL("../../server/auth/security.ts", import.meta.url).href;
    const script = `
      import { clientIpBucket } from ${JSON.stringify(moduleUrl)};
      if (clientIpBucket("192.0.2.1") !== "192.0.2.1") throw new Error("IPv4 bucket failed");
      if (clientIpBucket("::ffff:192.0.2.1") !== clientIpBucket("192.0.2.1")) throw new Error("Mapped IPv4 bucket failed");
      if (clientIpBucket("2001:db8:abcd:1234::1") !== clientIpBucket("2001:db8:abcd:1234::ffff")) throw new Error("IPv6 /64 bucket failed");
      if (clientIpBucket("not-an-ip") !== "unknown" || clientIpBucket(undefined) !== "unknown") throw new Error("Unknown bucket failed");
    `;
    try {
      execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], { timeout: 10_000 });
    } catch (error) {
      const childError = error as Error & { stderr?: Buffer };
      throw new Error(childError.stderr?.toString() || childError.message, { cause: error });
    }
  }, 20_000);

  it("requires an explicit MongoDB target and keeps the cookie host-only in production", () => {
    expect(() => authDatabaseConfig({})).toThrow();
    expect(() => authDatabaseConfig({ RENDER: "true", AUTH_MONGODB_URI: "mongodb://db.example.test", AUTH_DB_NAME: "auth_test" })).toThrow();
    expect(() => authDatabaseConfig({ AUTH_MONGODB_URI: "mongodb://127.0.0.1", AUTH_DB_NAME: "bad.name" })).toThrow();
    expect(() => authDatabaseConfig({ AUTH_MONGODB_URI: "mongodb://127.0.0.1", AUTH_DB_NAME: "admin" })).toThrow();
    expect(() => authDatabaseConfig({ NODE_ENV: "production", NODE_TLS_REJECT_UNAUTHORIZED: "0", AUTH_MONGODB_URI: "mongodb://127.0.0.1", AUTH_DB_NAME: "auth_test" })).toThrow();
    expect(() => authDatabaseConfig({ NODE_ENV: "production", AUTH_MONGODB_URI: "mongodb://db.example.test", AUTH_DB_NAME: "auth_test" })).toThrow();
    expect(authDatabaseConfig({ NODE_ENV: "production", AUTH_MONGODB_URI: "mongodb+srv://db.example.test", AUTH_DB_NAME: "auth_test" }).databaseName).toBe("auth_test");
    expect(() => authDatabaseConfig({ NODE_ENV: "production", AUTH_MONGODB_URI: "mongodb+srv://db.example.test/?TLS=false", AUTH_DB_NAME: "auth_test" })).toThrow();
    expect(() => authDatabaseConfig({ NODE_ENV: "production", AUTH_MONGODB_URI: "mongodb+srv://db.example.test/?tlsAllowInvalidCertificates=true", AUTH_DB_NAME: "auth_test" })).toThrow();
    expect(() => authDatabaseConfig({ NODE_ENV: "production", AUTH_MONGODB_URI: "mongodb+srv://db.example.test/?tlsInsecure=true", AUTH_DB_NAME: "auth_test" })).toThrow();
    expect(() => authDatabaseConfig({ NODE_ENV: "production", AUTH_MONGODB_URI: "mongodb+srv://db.example.test/?tlsAllowInvalidHostnames=TRUE", AUTH_DB_NAME: "auth_test" })).toThrow();
    expect(() => authDatabaseConfig({ NODE_ENV: "production", AUTH_MONGODB_URI: "mongodb+srv://db.example.test/?tlsAllowInvalidCertificates=false&tlsAllowInvalidCertificates=true", AUTH_DB_NAME: "auth_test" })).toThrow();
    expect(() => authDatabaseConfig({ NODE_ENV: "production", AUTH_MONGODB_URI: "mongodb://db.example.test/?ssl=false&tls=true", AUTH_DB_NAME: "auth_test" })).toThrow();
    expect(authDatabaseConfig({ NODE_ENV: "production", AUTH_MONGODB_URI: "mongodb://db1.example.test:27017,db2.example.test:27017/?tls=true&replicaSet=rs0", AUTH_DB_NAME: "auth_test" }).tlsRequired).toBe(true);
    expect(() => authCookieConfig({})).toThrow();
    expect(() => authPublicOrigin({ NODE_ENV: "production", SITE_URL: "http://example.test" })).toThrow();
    expect(authPublicOrigin({ NODE_ENV: "production", SITE_URL: "https://example.test" }).origin).toBe("https://example.test");
    expect(authTrustedProxies({ AUTH_TRUSTED_PROXY_IPS: "127.0.0.1,::1/128" })).toEqual(["127.0.0.1", "::1/128"]);
    expect(authTrustedProxies({ RENDER: "true", RENDER_SERVICE_TYPE: "web" })).toBe(1);
    expect(authTrustedProxies({ RENDER: "true", RENDER_SERVICE_TYPE: "worker" })).toEqual([]);
    expect(clientIpBucket("::ffff:192.0.2.1")).toBe(clientIpBucket("192.0.2.1"));
    expect(clientIpBucket("2001:db8:abcd:1234::1")).toBe(clientIpBucket("2001:db8:abcd:1234::ffff"));
    expect(clientIpBucket("2001:db8:abcd:1234::1")).not.toBe(clientIpBucket("2001:db8:abcd:1235::1"));
    expect(() => authTrustedProxies({ AUTH_TRUSTED_PROXY_IPS: "0.0.0.0/999" })).toThrow();
    expect(authCookieConfig({ NODE_ENV: "production" })).toMatchObject({
      name: "__Host-wct_admin", secure: true, httpOnly: true, path: "/",
    });
    expect(authCookieConfig({ NODE_ENV: "development" })).toMatchObject({
      name: "wct_admin_dev", secure: false,
    });
  });

  it("caps new and previously issued sessions at two days from sign-in", () => {
    const now = new Date("2026-10-21T12:00:00.000Z");
    const twoDays = appConfig.auth.absoluteSeconds * 1000;
    const session: AuthSession = {
      _id: "test-session", userId: new ObjectId(), authGeneration: 0,
      createdAt: new Date(now.getTime() - twoDays + 1), lastSeenAt: now,
      idleExpiresAt: new Date(now.getTime() + 60_000),
      absoluteExpiresAt: new Date(now.getTime() + 12 * 24 * 60 * 60 * 1000),
      deviceLabel: "test", csrfSecret: "test",
    };
    expect(appConfig.auth.absoluteSeconds).toBe(2 * 24 * 60 * 60);
    expect(authCookieConfig({ NODE_ENV: "development" }).maxAge).toBe(twoDays);
    expect(isSessionCurrent(session, now)).toBe(true);
    session.reauthUntil = new Date(now.getTime() + 1);
    expect(hasRecentReauth(session, now)).toBe(true);
    session.reauthUntil = now;
    expect(hasRecentReauth(session, now)).toBe(false);
    session.createdAt = new Date(now.getTime() - twoDays);
    expect(isSessionCurrent(session, now)).toBe(false);
    session.createdAt = new Date(now.getTime() - twoDays + 1);
    session.idleExpiresAt = now;
    expect(isSessionCurrent(session, now)).toBe(false);
    session.idleExpiresAt = new Date(now.getTime() + 60_000);
    session.absoluteExpiresAt = now;
    expect(isSessionCurrent(session, now)).toBe(false);
    session.absoluteExpiresAt = new Date(now.getTime() + 60_000);
    session.createdAt = new Date(now.getTime() + 30_000);
    expect(isSessionCurrent(session, now)).toBe(true);
    session.createdAt = new Date(now.getTime() + 60_001);
    expect(isSessionCurrent(session, now)).toBe(false);
    session.createdAt = new Date(Number.NaN);
    expect(isSessionCurrent(session, now)).toBe(false);
    expect(isSessionCurrent({ ...session, createdAt: "invalid" } as unknown as AuthSession, now)).toBe(false);
  });
});

const integration = process.env.AUTH_TEST_MONGODB_URI ? describe : describe.skip;

integration("admin count transactions on an isolated local replica set", () => {
  let client: MongoClient;
  let db: Db;

  beforeAll(async () => {
    const uri = process.env.AUTH_TEST_MONGODB_URI!;
    const target = new URL(uri);
    if (!["127.0.0.1", "localhost"].includes(target.hostname) || target.username || target.password) {
      throw new Error("Auth integration tests require an unauthenticated loopback MongoDB replica set");
    }
    client = new MongoClient(uri, { serverSelectionTimeoutMS: 3000 });
    await client.connect();
    db = client.db(`wct_auth_test_${randomBytes(6).toString("hex")}`);
    await createAuthIndexes(db);
    await ensureAdminControl(db);
  });

  afterAll(async () => {
    if (db) await db.dropDatabase();
    if (client) await client.close();
  });

  beforeEach(async () => {
    const { users, control } = authCollections(db);
    await users.deleteMany({});
    await control.updateOne({ _id: "singleton" }, { $set: { activeCount: 0, bootstrapState: "uninitialized" } });
  });

  function user(email: string, status: AdminUser["status"] = "active"): AdminUser {
    const now = new Date();
    return { _id: new ObjectId(), email, username: email, passwordHash: "test-only", authGeneration: 0, status, createdAt: now, updatedAt: now };
  }

  it("keeps count correct when two requests disable the same account", async () => {
    const { users, control } = authCollections(db);
    const records = [user("a@example.test"), user("b@example.test"), user("c@example.test")];
    await users.insertMany(records);
    await control.updateOne({ _id: "singleton" }, { $set: { activeCount: 3 } });
    const results = await Promise.allSettled([
      transitionAdminStatus({ client, db }, records[0]._id, "active", "disabled"),
      transitionAdminStatus({ client, db }, records[0]._id, "active", "disabled"),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await assertAdminCount({ client, db })).toBe(2);
  });

  it("does not let two requests disable the final two administrators", async () => {
    const { users, control } = authCollections(db);
    const records = [user("a@example.test"), user("b@example.test")];
    await users.insertMany(records);
    await control.updateOne({ _id: "singleton" }, { $set: { activeCount: 2 } });
    const results = await Promise.allSettled(records.map((record) => transitionAdminStatus({ client, db }, record._id, "active", "disabled")));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await assertAdminCount({ client, db })).toBe(1);
  });

  it("rejects duplicate reactivation and inconsistent stored counts", async () => {
    const { users, control } = authCollections(db);
    const active = user("a@example.test");
    const disabled = user("b@example.test", "disabled");
    await users.insertMany([active, disabled]);
    await control.updateOne({ _id: "singleton" }, { $set: { activeCount: 1 } });
    await transitionAdminStatus({ client, db }, disabled._id, "disabled", "active");
    await expect(transitionAdminStatus({ client, db }, disabled._id, "disabled", "active")).rejects.toThrow();
    expect(await assertAdminCount({ client, db })).toBe(2);
    await control.updateOne({ _id: "singleton" }, { $set: { activeCount: 1 } });
    await expect(transitionAdminStatus({ client, db }, disabled._id, "active", "disabled")).rejects.toThrow("Administrator count mismatch");
  });

  it("creates TTL indexes for later cleanup", async () => {
    const { sessions, tokens } = authCollections(db);
    const sessionIndexes = await sessions.listIndexes().toArray();
    const tokenIndexes = await tokens.listIndexes().toArray();
    expect(sessionIndexes.some((index) => index.key.absoluteExpiresAt === 1 && index.expireAfterSeconds === 0)).toBe(true);
    expect(tokenIndexes.some((index) => index.key.expiresAt === 1 && index.expireAfterSeconds === 0)).toBe(true);
  });
});
