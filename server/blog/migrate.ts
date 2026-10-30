import { pathToFileURL } from "node:url";
import nextEnv from "@next/env";
import { ObjectId } from "mongodb";
import sanitizeHtml from "sanitize-html";
import sharp from "sharp";
import { appConfig } from "../../lib/config.ts";
import { authCollections, authConnection, closeAuthConnection } from "../auth/db.ts";
import { BlogError, bucketName, importLegacyArticle, validateLegacyArticle, type LegacyArticle, type Upload } from "./service.ts";

const { loadEnvConfig } = nextEnv;
function checkedLegacyUrl(value: string): string {
  const prefix = appConfig.blog.legacyImagePrefix;
  if (typeof value !== "string") throw new BlogError(400, "Invalid legacy image URL");
  const url = new URL(value);
  const expected = new URL(prefix);
  if (url.origin !== expected.origin || !url.pathname.startsWith(expected.pathname) || url.search || url.hash || url.username || url.password || /%(?:2f|5c)|\.\./i.test(url.pathname) || decodeURIComponent(url.pathname).includes("..")) throw new BlogError(400, "Invalid legacy image URL");
  return url.href;
}
async function fetchImage(value: string): Promise<Buffer> {
  const response = await fetch(checkedLegacyUrl(value), { redirect: "manual", signal: AbortSignal.timeout(15000) });
  if (!response.ok || !response.body) throw new BlogError(422, "Legacy image unavailable");
  const chunks: Buffer[] = [];
  let length = 0;
  const reader = response.body.getReader();
  for (;;) {
    const { value: chunk, done } = await reader.read();
    if (done) break;
    length += chunk.length;
    if (length > appConfig.blog.maxFileBytes) { await reader.cancel().catch(() => {}); throw new BlogError(413, "Legacy image too large"); }
    chunks.push(Buffer.from(chunk));
  }
  const bytes = Buffer.concat(chunks, length);
  const meta = await sharp(bytes, { limitInputPixels: appConfig.blog.maxPixels, animated: false, failOn: "error" }).metadata();
  if (!["jpeg", "png", "webp"].includes(meta.format ?? "") || (meta.pages ?? 1) !== 1) throw new BlogError(400, "Invalid legacy image format");
  return bytes;
}
function imageList(raw: LegacyArticle): { html: string; sources: { name: string; url: string }[] } {
  const sources = [{ name: "hero", url: checkedLegacyUrl(raw.articleImage) }, { name: "thumbnail", url: checkedLegacyUrl(raw.articleThumbnailImage) }];
  const html = sanitizeHtml(raw.articleContent, {
    allowedTags: ["p", "br", "h1", "h2", "h3", "h4", "b", "i", "strong", "em", "u", "s", "blockquote", "pre", "code", "ol", "ul", "li", "a", "img", "span"],
    allowedAttributes: { a: ["href"], img: ["src", "alt"], p: ["class"], li: ["class"] },
    allowedSchemes: ["http", "https", "mailto", "pending"], allowProtocolRelative: false,
    transformTags: { b: "strong", i: "em", h1: "h2", img: (_tag, attrs) => {
      const name = `inline-${sources.length - 2}`;
      if (sources.length >= appConfig.blog.maxImages) throw new BlogError(400, "Too many legacy images");
      sources.push({ name, url: checkedLegacyUrl(attrs.src) });
      return { tagName: "img", attribs: { src: `pending:${name}`, alt: attrs.alt?.trim() || raw.articleAlt } };
    } },
  });
  return { html, sources };
}
export async function runMigration(databaseName: string, execute = false) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(databaseName) || databaseName.startsWith("wct_2026") || ["admin", "local", "config"].includes(databaseName.toLowerCase())) throw new Error("Invalid legacy database name");
  if (!bucketName()) throw new Error("Blog bucket name is not configured");
  const connection = await authConnection();
  if (databaseName === connection.db.databaseName) throw new Error("Source and destination databases must differ");
  const owner = await authCollections(connection.db).control.findOne({ _id: "singleton" });
  if (!owner?.ownerUserId) throw new Error("Blog migration requires an active owner");
  const source = connection.client.db(databaseName).collection<LegacyArticle>(appConfig.blog.collection);
  let checked = 0, imported = 0, skipped = 0, failed = 0;
  const ids = await source.find({}, { projection: { _id: 1 } }).map((record) => record._id).toArray();
  for (const id of ids) {
    const raw = await source.findOne({ _id: id });
    if (!raw) { failed++; continue; }
    if (!(raw._id instanceof ObjectId)) { failed++; continue; }
    try {
      if (execute && await connection.db.collection(appConfig.blog.collection).findOne({ legacyId: raw._id.toHexString() }, { projection: { _id: 1 } })) { skipped++; continue; }
      const { html, sources } = imageList(raw);
      validateLegacyArticle(raw, html);
      const files: Upload[] = [];
      for (const sourceImage of sources) files.push({ name: sourceImage.name, bytes: await fetchImage(sourceImage.url) });
      checked++;
      if (execute) { if (await importLegacyArticle(raw, owner.ownerUserId, files, html)) imported++; else skipped++; }
    } catch (error) {
      failed++;
      console.warn("Legacy article skipped", { id: raw._id.toHexString(), reason: error instanceof BlogError ? error.message : "Validation or network failure" });
    }
  }
  console.info("Blog migration result", { mode: execute ? "execute" : "dry-run", checked, imported, skipped, failed });
  if (failed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  loadEnvConfig(process.cwd(), process.env.NODE_ENV === "development");
  const [mode, databaseName] = process.argv.slice(2);
  if (!databaseName || mode !== "dry-run" && mode !== "execute") { console.error("Usage: npm run blog:migrate:dev -- dry-run|execute LEGACY_DB_NAME"); process.exitCode = 2; }
  else void runMigration(databaseName, mode === "execute").catch((error: unknown) => { console.error("Blog migration failed", { name: error instanceof Error ? error.name : "Unknown" }); process.exitCode = 1; }).finally(() => void closeAuthConnection());
}
