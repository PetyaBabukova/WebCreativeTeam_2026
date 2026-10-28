import { assertAdminCount, authCollections, authConnection, closeAuthConnection, createAuthIndexes, ensureAdminControl } from "./db.ts";
import { bootstrapOwner } from "./service.ts";
import { recoverOwner } from "./service.ts";
import { ObjectId } from "mongodb";
import { appConfig } from "../../lib/config.ts";
import { prepareNewsletterSchema } from "../newsletter/service.ts";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

type OperatorCommand = "prepare" | "prepare-newsletter" | "check-count" | "bootstrap" | "recover-owner";

const expectedCollections = new Set([
  "adminUsers", "authSessions", "authTokens", "adminControl", "authOutbox", "authAudit", "authRateLimits",
  appConfig.newsletter.collection,
  ...appConfig.newsletter.legacyCollections,
]);

export async function runAuthOperator(command: OperatorCommand) {
  const connection = await authConnection();
  const { db } = connection;
  if (command === "prepare" || command === "prepare-newsletter") {
    const hello = await db.admin().command({ hello: 1 });
    if (!hello.setName && hello.msg !== "isdbgrid") throw new Error("Authentication database must support transactions");
    const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((collection) => collection.name);
    if (names.length || command === "prepare-newsletter") {
      if (names.some((name) => !expectedCollections.has(name))) throw new Error("Database contains unexpected collections");
      const marker = await authCollections(db).control.findOne({ _id: "singleton" });
      if (marker?.schemaId !== "wct-auth-v1") throw new Error("Authentication database ownership marker missing");
      await assertAdminCount(connection);
    }
    if (command === "prepare") {
      await createAuthIndexes(db);
      await ensureAdminControl(db);
    }
    const legacy = appConfig.newsletter.legacyCollections.filter((name) => names.includes(name));
    if (legacy.length && !db.databaseName.startsWith(appConfig.newsletter.legacyDatabasePrefix)) {
      throw new Error("Legacy newsletter cleanup database mismatch");
    }
    for (const name of legacy) {
      if (await db.collection(name).countDocuments({}) !== 0) throw new Error("Legacy newsletter collection is not empty");
    }
    for (const name of legacy) {
      if (await db.collection(name).countDocuments({}) !== 0) throw new Error("Legacy newsletter collection is not empty");
      await db.dropCollection(name);
    }
    await prepareNewsletterSchema(db);
    await assertAdminCount(connection);
    return;
  }
  if (command === "bootstrap") {
    const email = process.env.AUTH_FIRST_ADMIN_EMAIL;
    if (!email) throw new Error("Missing first administrator email");
    await bootstrapOwner(email);
    return;
  }
  if (command === "recover-owner") {
    if (process.env.AUTH_RECOVERY_VERIFIED !== "yes-independent-verification" || !process.env.AUTH_RECOVERY_EMAIL) throw new Error("Recovery verification missing");
    const ids = (process.env.AUTH_COMPROMISED_ADMIN_IDS ?? "").split(",").map((value) => value.trim()).filter(Boolean);
    if (ids.some((value) => !ObjectId.isValid(value) || value.length !== 24)) throw new Error("Invalid administrator ID");
    const report = await recoverOwner(process.env.AUTH_RECOVERY_EMAIL, ids.map((value) => new ObjectId(value)));
    console.info("Disabled accounts created by compromised administrators; review before reactivation", report.createdIds);
    console.info("Review invitation identifiers", report.pendingIds);
    return;
  }
  await assertAdminCount(connection);
}

async function main() {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV === "development");
  const command = process.argv[2];
  if (command !== "prepare" && command !== "prepare-newsletter" && command !== "check-count" && command !== "bootstrap" && command !== "recover-owner") {
    console.error("Usage: npm run auth:operator -- prepare|prepare-newsletter|check-count|bootstrap|recover-owner");
    process.exitCode = 2;
    return;
  }
  try {
    await runAuthOperator(command);
    console.info(`Authentication ${command} completed`);
  } catch (error) {
    const safe = error && typeof error === "object" ? error as { name?: string; code?: number; codeName?: string } : {};
    // Only expose known, static application errors. Driver messages may contain connection details.
    const knownReasons = new Set([
      "Authentication database must support transactions",
      "Database contains unexpected collections",
      "Authentication database ownership marker missing",
      "Administrator count mismatch",
      "Newsletter schema version mismatch",
      "Legacy newsletter collection is not empty",
      "Legacy newsletter cleanup database mismatch",
    ]);
    const reason = error instanceof Error && knownReasons.has(error.message) ? error.message : undefined;
    console.error(`Authentication ${command} failed`, { name: safe.name, code: safe.code, codeName: safe.codeName, reason });
    process.exitCode = 1;
  } finally {
    await closeAuthConnection().catch(() => {});
  }
}

void main();
