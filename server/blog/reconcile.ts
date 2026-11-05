import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import nextEnv from "@next/env";
import { closeAuthConnection } from "../auth/db.js";
import { auditBlogImages, BlogError, deleteAuditedImages } from "./service.js";

const { loadEnvConfig } = nextEnv;

export async function runImageReconciliation(mode: "dry-run" | "execute", digest?: string, approval?: string) {
  if (mode === "execute" && !digest) throw new Error("Approved audit digest is required");
  if (mode === "execute" && approval !== "--approve-historical-delete") throw new Error("Explicit approval flag is required for historical deletion");
  const audit = await auditBlogImages();
  console.info("Blog image audit", {
    candidates: audit.candidates.length, pending: audit.pending, recent: audit.recent,
    unknownAge: audit.unknownAge, invalidReferences: audit.invalidReferences,
    foreignReferences: audit.foreignReferences, digest: audit.digest,
  });
  if (mode === "dry-run") {
    for (const candidate of audit.candidates) console.info("Candidate", candidate);
    for (const key of audit.invalidKeys) console.info("Invalid image key for manual review", { sha256: createHash("sha256").update(key).digest("hex") });
    return;
  }
  const result = await deleteAuditedImages(digest!);
  console.info("Blog image cleanup", result);
  if (result.failed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV === "development");
  const [mode, digest, approval] = process.argv.slice(2);
  if (mode !== "dry-run" && mode !== "execute") throw new Error("Choose dry-run or execute");
  void runImageReconciliation(mode, digest, approval).catch((error: unknown) => {
    console.error(error instanceof BlogError ? error.message : "Blog image reconciliation failed");
    process.exitCode = 1;
  }).finally(() => closeAuthConnection());
}
