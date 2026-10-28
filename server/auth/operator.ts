import { assertAdminCount, authCollections, authConnection, closeAuthConnection, createAuthIndexes, ensureAdminControl } from "./db.ts";
import { bootstrapOwner } from "./service.ts";
import { recoverOwner } from "./service.ts";
import { ObjectId } from "mongodb";
import { appConfig } from "../../lib/config.ts";
import { createNewsletterIndexes } from "../newsletter/service.ts";
import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

type OperatorCommand = "prepare" | "check-count" | "bootstrap" | "recover-owner";

export async function runAuthOperator(command: OperatorCommand) {
  const connection = await authConnection();
  const { db } = connection;
  if (command === "prepare") {
    const hello = await db.admin().command({ hello: 1 });
    if (!hello.setName && hello.msg !== "isdbgrid") throw new Error("Authentication database must support transactions");
    const names = (await db.listCollections({}, { nameOnly: true }).toArray()).map((collection) => collection.name);
    if (names.length) {
      const expected = new Set(["adminUsers", "authSessions", "authTokens", "adminControl", "authOutbox", "authAudit", "authRateLimits", ...Object.values(appConfig.newsletter.collections)]);
      if (names.some((name) => !expected.has(name))) throw new Error("Database contains unexpected collections");
      const marker = await authCollections(db).control.findOne({ _id: "singleton" });
      if (marker?.schemaId !== "wct-auth-v1") throw new Error("Authentication database ownership marker missing");
      await assertAdminCount(connection);
    }
    await createAuthIndexes(db);
    await ensureAdminControl(db);
    await createNewsletterIndexes(db);
    await authCollections(db).control.updateOne({ _id: "singleton", schemaId: "wct-auth-v1" }, { $set: { newsletterSchemaId: "wct-newsletter-v1" } });
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
  if (command !== "prepare" && command !== "check-count" && command !== "bootstrap" && command !== "recover-owner") {
    console.error("Usage: npm run auth:operator -- prepare|check-count|bootstrap|recover-owner");
    process.exitCode = 2;
    return;
  }
  try {
    await runAuthOperator(command);
    console.info(`Authentication ${command} completed`);
  } catch (error) {
    const safe = error && typeof error === "object" ? error as { name?: string; code?: number; codeName?: string } : {};
    console.error(`Authentication ${command} failed`, { name: safe.name, code: safe.code, codeName: safe.codeName });
    process.exitCode = 1;
  } finally {
    await closeAuthConnection().catch(() => {});
  }
}

void main();
