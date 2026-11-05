import { createHash, randomBytes } from "node:crypto";
import { Storage } from "@google-cloud/storage";
import { ObjectId, type Collection } from "mongodb";
import sanitizeHtml from "sanitize-html";
import sharp from "sharp";
import { appConfig, blogLinkUrl, type Locale } from "../../lib/config.ts";
import { authCollections, authConnection } from "../auth/db.ts";

export type BlogText = { title: string; subtitle?: string; category?: string; html: string; seoTitle: string; seoDescription: string; heroAlt: string; thumbnailAlt: string; updatedAt: Date };
export type Article = {
  _id: ObjectId; slug: string; legacyId?: string; createKey?: string; publishedAt: Date; updatedAt: Date;
  version: number; createdBy: ObjectId; updatedBy: ObjectId; heroUrl: string; thumbnailUrl: string;
  locales: { bg: BlogText; en?: BlogText };
  state?: "active" | "deleting" | "deleted"; deletedAt?: Date;
  pendingImageCleanup?: string[]; cleanupAttempts?: number; cleanupNextAt?: Date; cleanupClaimUntil?: Date; cleanupClaim?: string; cleanupStuck?: boolean;
};
type CleanupMarker = {
  _id: ObjectId; dueAt: Date; createKey?: string;
  cleanupAttempts?: number; cleanupNextAt?: Date; cleanupClaimUntil?: Date; cleanupClaim?: string; cleanupStuck?: boolean;
};
export type Upload = { name: string; bytes: Buffer };
export type LegacyArticle = { _id: ObjectId; articleTitle: string; articleImage: string; articleThumbnailImage: string; articleAlt: string; articleContent: string; articleMetaTitle: string; articleMetaDescription: string; dateCreated: string };
export class BlogError extends Error { constructor(public status: number, message: string) { super(message); } }

const storage = new Storage({ retryOptions: { totalTimeout: appConfig.blog.storageRetryTotalTimeoutSeconds } });
let indexes: Promise<void> | undefined;

export type StorageErrorInfo = { name: string; status?: number; numericCode?: number; code?: string; reason?: string };
const accessReasons = new Set(["invalid_grant", "invalid_client", "unauthorized_client", "invalid_target", "no_credentials"]);
const httpStatus = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 100 && value <= 599;
function field(value: unknown, key: string): unknown {
  return value && typeof value === "object" && key in value ? (value as Record<string, unknown>)[key] : undefined;
}
function firstEntry(value: unknown): unknown { return Array.isArray(value) ? value[0] : undefined; }
// Only fixed-shape fields leave this function: never messages, request config, headers, URLs or object keys.
export function storageErrorInfo(error: unknown): StorageErrorInfo {
  const info: StorageErrorInfo = { name: error instanceof Error && /^[A-Za-z]{1,40}$/.test(error.name) ? error.name : "Unknown" };
  const response = field(error, "response");
  const code = field(error, "code");
  // A numeric code is an HTTP status only on Google API errors (they carry `errors` or `response`); MongoDB codes stay separate.
  const googleError = Boolean(error && typeof error === "object" && ("errors" in error || "response" in error));
  const status = [field(error, "status"), field(response, "status"), googleError ? code : undefined].find(httpStatus);
  if (status !== undefined) info.status = status;
  else if (typeof code === "number" && Number.isSafeInteger(code)) info.numericCode = code;
  if (typeof code === "string" && /^[A-Z0-9_]{1,40}$/.test(code)) info.code = code;
  const responseError = field(field(response, "data"), "error");
  const reason = [responseError, field(firstEntry(field(responseError, "errors")), "reason"), field(firstEntry(field(error, "errors")), "reason")]
    .find((value): value is string => typeof value === "string" && /^[A-Za-z_]{1,40}$/.test(value));
  if (reason) info.reason = reason;
  // Missing ADC, or GOOGLE_APPLICATION_CREDENTIALS pointing at a missing file.
  else if (error instanceof Error && (error.message.startsWith("Could not load the default credentials") || code === "ENOENT")) info.reason = "no_credentials";
  return info;
}
export function storageAccessFailure(info: StorageErrorInfo): boolean {
  return info.status === 401 || info.status === 403 || Boolean(info.reason && accessReasons.has(info.reason));
}
export function logStorageFailure(context: string, error: unknown): StorageErrorInfo {
  const info = storageErrorInfo(error);
  if (storageAccessFailure(info)) console.error("Blog storage access failed", { context, ...info });
  else console.warn(context, info);
  return info;
}

export function bucketName(): string | undefined {
  const name = process.env[appConfig.blog.bucketEnv];
  if (!name) return undefined;
  if (!/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(name) || name.includes("..")) throw Object.assign(new Error("Invalid blog storage configuration"), { code: "BLOG_STORAGE_CONFIG" });
  return name;
}
function bucket() { const name = bucketName(); if (!name) throw new BlogError(503, "Blog storage is not configured"); return storage.bucket(name); }
const publicImagePrefix = `${appConfig.paths.blogApi}${appConfig.blog.imageRoute}/`;
function imageUrl(key: string) { return `${publicImagePrefix}${key.slice(`${appConfig.blog.imagePrefix}/`.length)}`; }
export function objectKey(url: string, articleId?: ObjectId): string {
  if (!url.startsWith(publicImagePrefix)) throw new BlogError(400, "Invalid article image");
  const suffix = url.slice(publicImagePrefix.length);
  const match = /^([a-f0-9]{24})\/(hero|thumbnail|inline-(?:[0-9]|1[0-9]))\/([a-f0-9]{64}-[a-f0-9]{16}\.webp)$/.exec(suffix);
  if (!match || articleId && match[1] !== articleId.toHexString()) throw new BlogError(400, "Invalid article image");
  return `${appConfig.blog.imagePrefix}/${suffix}`;
}
export function blogImageFile(url: string, generation?: string) { const key = objectKey(url); return bucket().file(key, generation ? { generation } : undefined); }

// Proves identity, bucket existence, list and (when an image exists) the object read used by the image route.
// Write permission surfaces on upload.
export async function checkBlogStorage(): Promise<void> {
  const [files] = await bucket().getFiles({ prefix: `${appConfig.blog.imagePrefix}/`, maxResults: 1, autoPaginate: false });
  if (files[0]) await files[0].getMetadata();
}
export function startBlogStorageMonitor(): () => void {
  if (!process.env.AUTH_MONGODB_URI) return () => {};
  if (!bucketName()) { console.error("Blog storage is not configured"); return () => {}; }
  let stopped = false;
  let running = false;
  let state: "ready" | "access" | "failed" | undefined;
  const report = (next: NonNullable<typeof state>, info?: StorageErrorInfo) => {
    if (stopped || next === state) return;
    state = next;
    if (next === "ready") console.info("Blog storage ready");
    else console.error(next === "access" ? "Blog storage access failed" : "Blog storage check failed", { context: "check", ...info });
  };
  const run = () => {
    if (running || stopped) return;
    running = true;
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error("Blog storage check timed out"), { code: "TIMEOUT" })), appConfig.blog.storageCheckTimeoutMilliseconds);
      timer.unref();
    });
    const check = checkBlogStorage();
    // The timeout reports a hung check, but a new check starts only after this one settles.
    void check.finally(() => { clearTimeout(timer); running = false; }).catch(() => {});
    void Promise.race([check, timeout]).then(() => report("ready"), (error: unknown) => {
      const info = storageErrorInfo(error);
      report(storageAccessFailure(info) ? "access" : "failed", info);
    });
  };
  run();
  const interval = setInterval(run, appConfig.blog.storageCheckMilliseconds);
  interval.unref();
  return () => { stopped = true; clearInterval(interval); };
}

function text(value: unknown, max: number, required = true): string {
  if (typeof value !== "string") throw new BlogError(400, "Invalid article field");
  const result = value.normalize("NFC").trim();
  if (result.length > max || required && !result || /[\p{Cc}\p{Cf}]/u.test(result)) throw new BlogError(400, "Invalid article field");
  return result;
}
export function normalizeSubtitle(value: unknown, required = false): string | undefined {
  return value === undefined && !required ? undefined : text(value, 240, required);
}
function normalizeCategory(value: unknown, required = false): string | undefined {
  if (!required && (value === undefined || typeof value === "string" && !value.trim())) return undefined;
  return text(value, 60, required);
}
function slugTitle(title: string, id: ObjectId): string {
  const map: Record<string, string> = { а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ж: "zh", з: "z", и: "i", й: "y", к: "k", л: "l", м: "m", н: "n", о: "o", п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "h", ц: "ts", ч: "ch", ш: "sh", щ: "sht", ъ: "a", ь: "y", ю: "yu", я: "ya" };
  const stem = [...title.toLowerCase()].map((char) => map[char] ?? char).join("").normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60).replace(/-$/g, "") || "article";
  return `${stem}-${id.toHexString().slice(-8)}`;
}
export function cleanHtml(value: unknown, articleId: ObjectId): string {
  if (typeof value !== "string") throw new BlogError(400, "Invalid article content");
  const source = value.normalize("NFC").replace(/\r\n?/g, "\n").trim();
  if (!source || Buffer.byteLength(source, "utf8") > appConfig.blog.maxHtmlBytes || [...source].some((char) => { const code = char.codePointAt(0)!; return code < 32 && code !== 9 && code !== 10 || code === 127 || /\p{Cf}/u.test(char); })) throw new BlogError(400, "Invalid article content");
  const colorValues = appConfig.blog.textColors.flatMap(({ value }) => {
    const [red, green, blue] = [1, 3, 5].map((at) => parseInt(value.slice(at, at + 2), 16));
    return [value, `rgb\\(\\s*${red}\\s*,\\s*${green}\\s*,\\s*${blue}\\s*\\)`];
  });
  const allowedColor = new RegExp(`^(?:${colorValues.join("|")})$`, "i");
  const tokenRule = (value: string) => new RegExp(`^var\\(${value.slice(4, -1)}\\)$`);
  const textColorRules = [allowedColor, ...appConfig.blog.globalTextColors.map(({ value }) => tokenRule(value))];
  const highlightRules = appConfig.blog.highlightColors.map(({ value }) => tokenRule(value));
  const safeInlineStyle = (attrs: Record<string, string>): Record<string, string> => attrs.style && !attrs.style.includes("!") ? { style: attrs.style } : {};
  const inlineTag = (tagName: string, attrs: Record<string, string>) => ({ tagName, attribs: safeInlineStyle(attrs) });
  const clean = sanitizeHtml(source, {
    allowedTags: ["p", "br", "h2", "h3", "h4", "strong", "em", "u", "s", "span", "blockquote", "pre", "code", "ol", "ul", "li", "a", "img"],
    allowedAttributes: { a: ["href", "target", "rel", "style"], span: ["style"], strong: ["style"], em: ["style"], u: ["style"], s: ["style"], img: ["src", "alt"], p: ["class"], h2: ["class"], h3: ["class"], h4: ["class"], li: ["class"], pre: ["class"] },
    allowedStyles: Object.fromEntries(["a", "span", "strong", "em", "u", "s"].map((tag) => [tag, { color: textColorRules, "background-color": highlightRules }])),
    allowedClasses: { p: ["ql-align-center", "ql-align-right", "ql-align-justify"], h2: ["ql-align-center", "ql-align-right", "ql-align-justify"], h3: ["ql-align-center", "ql-align-right", "ql-align-justify"], h4: ["ql-align-center", "ql-align-right", "ql-align-justify"], li: ["ql-indent-1", "ql-indent-2"], pre: ["ql-syntax"] },
    allowedSchemes: ["http", "https", "mailto"], allowedSchemesByTag: { img: ["https"] }, allowProtocolRelative: false,
    transformTags: {
      span: inlineTag, strong: inlineTag, em: inlineTag, u: inlineTag, s: inlineTag,
      img: (_tag, attrs) => {
        objectKey(attrs.src ?? "", articleId);
        if (!attrs.alt || !attrs.alt.trim() || attrs.alt.length > 180) throw new BlogError(400, "Image alt text is required");
        return { tagName: "img", attribs: { src: attrs.src, alt: text(attrs.alt, 180) } };
      },
      a: (_tag, attrs) => {
        const href = blogLinkUrl(attrs.href ?? "");
        if (!href) return { tagName: "span", attribs: safeInlineStyle(attrs) };
        return { tagName: "a", attribs: { href, rel: "noopener noreferrer", target: "_blank", ...safeInlineStyle(attrs) } };
      },
    },
  });
  const words = sanitizeHtml(clean, { allowedTags: [], allowedAttributes: {} }).trim().split(/\s+/u).filter(Boolean);
  if (!words.length || words.length > appConfig.blog.maxWords || Buffer.byteLength(clean, "utf8") > appConfig.blog.maxHtmlBytes) throw new BlogError(400, "Invalid article content");
  return clean;
}
function fields(input: Record<string, unknown>, html: string, id: ObjectId): BlogText {
  const subtitle = normalizeSubtitle(input.subtitle);
  const category = normalizeCategory(input.category);
  return { title: text(input.title, 80), ...(subtitle === undefined ? {} : { subtitle }), ...(category === undefined ? {} : { category }), html: cleanHtml(html, id), seoTitle: text(input.seoTitle, 70), seoDescription: text(input.seoDescription, 160), heroAlt: text(input.heroAlt, 180), thumbnailAlt: text(input.thumbnailAlt, 180), updatedAt: new Date() };
}
function ensureKeys(input: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(input).some((key) => !allowed.includes(key))) throw new BlogError(400, "Unexpected article field");
}
async function articles(): Promise<Collection<Article>> { return (await authConnection()).db.collection<Article>(appConfig.blog.collection); }
async function markers(): Promise<Collection<CleanupMarker>> { return (await authConnection()).db.collection<CleanupMarker>(appConfig.blog.cleanupCollection); }
const activeArticle = { state: { $nin: ["deleting", "deleted"] } } as const;
export async function imageArticleVisible(id: string): Promise<boolean> {
  if (!/^[a-f0-9]{24}$/.test(id)) return false;
  return Boolean(await (await articles()).findOne({ _id: new ObjectId(id), ...activeArticle }, { projection: { _id: 1 } }));
}
async function ensureIndexes() {
  indexes ??= (async () => { const collection = await articles(); await collection.createIndex({ slug: 1 }, { unique: true }); await collection.createIndex({ legacyId: 1 }, { unique: true, partialFilterExpression: { legacyId: { $exists: true } } }); await collection.createIndex({ createKey: 1 }, { unique: true, partialFilterExpression: { createKey: { $exists: true } } }); await collection.createIndex({ publishedAt: -1 }); await (await markers()).createIndex({ createKey: 1 }, { unique: true, partialFilterExpression: { createKey: { $exists: true } } }); })().catch((error: unknown) => { indexes = undefined; throw error; });
  await indexes;
}
async function upload(id: ObjectId, item: Upload, batchId: string, deadline: number, existing = false): Promise<{ url: string; created: boolean }> {
  const role = item.name;
  if (!/^(hero|thumbnail|inline-(?:[0-9]|1[0-9]))$/.test(role) || item.bytes.length > appConfig.blog.maxFileBytes) throw new BlogError(400, "Invalid image");
  let processed: Buffer;
  try {
    const image = sharp(item.bytes, { limitInputPixels: appConfig.blog.maxPixels, animated: false, failOn: "error" });
    const metadata = await image.metadata();
    if (!["jpeg", "png", "webp"].includes(metadata.format ?? "") || (metadata.pages ?? 1) !== 1) throw new BlogError(400, "Invalid image format");
    const width = role === "thumbnail" ? 800 : role === "hero" ? 2400 : 1600;
    processed = await image.rotate().resize({ width, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer();
    if (processed.length > appConfig.blog.maxFileBytes) throw new BlogError(413, "Image too large");
  } catch (error) { throw error instanceof BlogError ? error : new BlogError(400, "Invalid image format"); }
  const hash = createHash("sha256").update(processed).digest("hex");
  const key = `${appConfig.blog.imagePrefix}/${id.toHexString()}/${role}/${hash}-${batchId}.webp`;
  if (Date.now() >= deadline) throw new BlogError(503, "Image upload timed out");
  if (existing && !await imageArticleVisible(id.toHexString())) throw new BlogError(409, "Article is being deleted");
  if (Date.now() >= deadline) throw new BlogError(503, "Image upload timed out");
  try {
    await bucket().file(key).save(processed, { resumable: false, timeout: appConfig.blog.imageUploadRequestTimeoutMilliseconds, contentType: "image/webp", metadata: { cacheControl: appConfig.blog.imageCacheControl }, preconditionOpts: { ifGenerationMatch: 0 } });
    return { url: imageUrl(key), created: true };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === 412) return { url: imageUrl(key), created: false };
    throw error;
  }
}
async function discardImages(id: ObjectId, urls: string[]) {
  await Promise.allSettled(urls.map(async (url) => {
    try { await bucket().file(objectKey(url, id)).delete({ ignoreNotFound: true }); }
    catch (error) { logStorageFailure("Blog image cleanup failed", error); }
  }));
}
export function resolveInlinePlaceholders(html: string, urls: ReadonlyMap<string, string>): string {
  let result = html;
  for (const [name, url] of urls) if (name.startsWith("inline-")) {
    const marker = `src="pending:${name}"`;
    if (!result.includes(marker)) throw new BlogError(400, "Unused image upload");
    result = result.replaceAll(marker, `src="${url}"`);
  }
  if (result.includes('src="pending:')) throw new BlogError(400, "Missing image upload");
  return result;
}
async function uploadedHtml(input: Record<string, unknown>, files: Upload[], id: ObjectId, existing?: Article, batchId = randomBytes(8).toString("hex"), deadline = Date.now() + appConfig.blog.imageUploadDeadlineMilliseconds) {
  const created: string[] = [];
  const urls = new Map<string, string>();
  try {
    if (typeof input.html !== "string") throw new BlogError(400, "Invalid article content");
    for (const file of files) if (file.name.startsWith("inline-") && !input.html.includes(`src="pending:${file.name}"`)) throw new BlogError(400, "Unused image upload");
    for (const file of files) {
      if (urls.has(file.name)) throw new BlogError(400, "Duplicate image");
      const result = await upload(id, file, batchId, deadline, Boolean(existing));
      urls.set(file.name, result.url);
      if (result.created) created.push(result.url);
    }
    if (typeof input.html !== "string") throw new BlogError(400, "Invalid article content");
    const html = resolveInlinePlaceholders(input.html, urls);
    const heroUrl = urls.get("hero") ?? existing?.heroUrl;
    const thumbnailUrl = urls.get("thumbnail") ?? existing?.thumbnailUrl;
    if (!heroUrl || !thumbnailUrl) throw new BlogError(400, "Main and thumbnail images are required");
    objectKey(heroUrl, id); objectKey(thumbnailUrl, id);
    return { text: fields(input, html, id), heroUrl, thumbnailUrl, created, accepted: [...urls.values()] };
  } catch (error) {
    await discardImages(id, created);
    throw error;
  }
}
function refs(article: Article): Set<string> {
  const urls = [article.heroUrl, article.thumbnailUrl];
  for (const entry of [article.locales.bg, article.locales.en].filter((item): item is BlogText => Boolean(item))) {
    sanitizeHtml(entry.html, { allowedTags: ["img"], allowedAttributes: { img: ["src"] }, transformTags: { img: (_tag, attrs) => {
      if (attrs.src) urls.push(attrs.src);
      return { tagName: "img", attribs: {} };
    } } });
  }
  return new Set(urls);
}
export type ImageAudit = {
  candidates: { key: string; reason: "missing_article" | "unreferenced" }[];
  foreignReferences: { articleId: string; ownerId: string }[];
  invalidKeys: string[]; invalidReferences: number;
  pending: number; recent: number; unknownAge: number; digest: string;
};
export async function auditBlogImages(): Promise<ImageAudit> {
  const auditStartedAt = Date.now();
  const objects: { key: string; created: number }[] = [];
  let pageToken: string | undefined;
  do {
    const [files, next] = await bucket().getFiles({ prefix: `${appConfig.blog.imagePrefix}/`, maxResults: appConfig.blog.imageAuditPageSize, autoPaginate: false, ...(pageToken ? { pageToken } : {}) });
    for (const file of files) {
      const created = Date.parse(String(file.metadata?.timeCreated ?? ""));
      objects.push({ key: file.name, created });
    }
    pageToken = next?.pageToken;
  } while (pageToken);
  const collection = await articles();
  const known = new Set<string>();
  const referenced = new Set<string>();
  const pending = new Set<string>();
  const blocked = new Set<string>();
  const invalidKeys: string[] = [];
  let invalidReferences = 0;
  const foreignReferences: ImageAudit["foreignReferences"] = [];
  for await (const article of collection.find({})) {
    const articleId = article._id.toHexString();
    known.add(articleId);
    if (!activeState(article)) blocked.add(articleId);
    for (const url of refs(article)) {
      let key: string;
      try { key = objectKey(url); }
      catch { invalidReferences++; continue; }
      referenced.add(key);
      const ownerId = key.split("/")[1];
      if (ownerId !== articleId) foreignReferences.push({ articleId, ownerId });
    }
    for (const url of article.pendingImageCleanup ?? []) {
      try { pending.add(objectKey(url, article._id)); }
      catch { invalidReferences++; }
    }
  }
  for await (const marker of (await markers()).find({}, { projection: { _id: 1 } })) blocked.add(marker._id.toHexString());
  const candidates: ImageAudit["candidates"] = [];
  let recent = 0, unknownAge = 0, pendingCount = 0;
  for (const { key, created } of objects) {
    if (!key.startsWith(`${appConfig.blog.imagePrefix}/`) || key.startsWith(`${appConfig.blog.imagePrefix}/_ops/`)) continue;
    try { if (objectKey(imageUrl(key)) !== key) { invalidKeys.push(key); continue; } }
    catch { invalidKeys.push(key); continue; }
    const articleId = key.split("/")[1];
    if (referenced.has(key) || blocked.has(articleId)) continue;
    if (pending.has(key)) { pendingCount++; continue; }
    if (!Number.isFinite(created)) { unknownAge++; continue; }
    if (auditStartedAt - created < appConfig.blog.imageDeleteGraceMilliseconds) { recent++; continue; }
    candidates.push({ key, reason: known.has(articleId) ? "unreferenced" : "missing_article" });
  }
  candidates.sort((a, b) => a.key.localeCompare(b.key));
  const digest = createHash("sha256").update(candidates.map(({ key }) => key).join("\n")).digest("hex");
  return { candidates, foreignReferences, invalidKeys, invalidReferences, pending: pendingCount, recent, unknownAge, digest };
}
async function deleteAuditCandidates(audit: ImageAudit): Promise<{ deleted: number; failed: number }> {
  let deleted = 0, failed = 0;
  for (const { key } of audit.candidates) {
    try { await bucket().file(key).delete({ ignoreNotFound: true }); deleted++; }
    catch (error) { failed++; logStorageFailure("Blog orphan cleanup failed", error); }
  }
  return { deleted, failed };
}
export async function deleteAuditedImages(expectedDigest: string): Promise<{ deleted: number; failed: number }> {
  if (!appConfig.blog.lifecycleWritesEnabled) throw new BlogError(503, "Image cleanup is temporarily unavailable");
  if (!/^[a-f0-9]{64}$/.test(expectedDigest)) throw new BlogError(400, "Invalid audit digest");
  const audit = await auditBlogImages();
  if (audit.digest !== expectedDigest || audit.foreignReferences.length || audit.invalidReferences) throw new BlogError(409, "Image audit changed or needs review");
  return deleteAuditCandidates(audit);
}
function activeState(article: Article) { return article.state !== "deleting" && article.state !== "deleted"; }
function articlePrefix(id: ObjectId) { return `${appConfig.blog.imagePrefix}/${id.toHexString()}/`; }
async function sweepArticlePrefix(id: ObjectId, deadline: number): Promise<{ empty: boolean; remaining: number }> {
  const prefix = articlePrefix(id);
  while (Date.now() < deadline) {
    const [files] = await bucket().getFiles({ prefix, maxResults: appConfig.blog.imageCleanupPageSize, autoPaginate: false });
    if (!files.length) return { empty: true, remaining: 0 };
    for (const file of files) {
      if (!file.name.startsWith(prefix)) throw new BlogError(503, "Storage returned an invalid article prefix");
      await file.delete({ ignoreNotFound: true });
      if (Date.now() >= deadline) return { empty: false, remaining: files.length };
    }
  }
  return { empty: false, remaining: 0 };
}
async function assertNoForeignReferences(id: ObjectId) {
  const prefix = articlePrefix(id);
  for await (const article of (await articles()).find({ _id: { $ne: id } }, { projection: { _id: 1, heroUrl: 1, thumbnailUrl: 1, locales: 1 } })) {
    for (const url of refs(article)) {
      let key: string;
      try { key = objectKey(url); }
      catch { if (url.startsWith(`${publicImagePrefix}${id.toHexString()}/`)) throw new BlogError(409, "Existing image references need review before deleting"); else continue; }
      if (key.startsWith(prefix)) throw new BlogError(409, "Another article still uses this image");
    }
  }
}
async function claimCleanup(id: ObjectId, force = false): Promise<Article | null> {
  const now = new Date();
  const token = randomBytes(12).toString("hex");
  return (await articles()).findOneAndUpdate({ _id: id,
    $and: [
      { $or: [{ cleanupClaimUntil: { $exists: false } }, { cleanupClaimUntil: { $lte: now } }] },
      ...(force ? [] : [{ $or: [{ cleanupNextAt: { $exists: false } }, { cleanupNextAt: { $lte: now } }] }]),
    ],
  }, { $set: { cleanupClaim: token, cleanupClaimUntil: new Date(now.getTime() + appConfig.blog.imageCleanupClaimMilliseconds) } }, { returnDocument: "after" });
}
async function releaseCleanup(article: Article, failed: boolean) {
  const attempts = failed ? (article.cleanupAttempts ?? 0) + 1 : 0;
  if (failed && (attempts === 1 || attempts === appConfig.blog.imageCleanupMaxAttempts)) console.error("Blog image cleanup retry needed", { articleId: article._id.toHexString(), attempts, stage: activeState(article) ? "image" : "article" });
  const collection = await articles();
  if (activeState(article)) {
    const moved = await collection.updateOne({ _id: article._id, cleanupClaim: article.cleanupClaim, state: { $in: ["deleting", "deleted"] } }, {
      $set: { cleanupNextAt: new Date(), cleanupAttempts: 0, cleanupStuck: false }, $unset: { cleanupClaim: "", cleanupClaimUntil: "" },
    });
    if (moved.matchedCount) return;
  }
  await collection.updateOne({ _id: article._id, cleanupClaim: article.cleanupClaim }, {
    $set: { cleanupAttempts: attempts, cleanupStuck: attempts >= appConfig.blog.imageCleanupMaxAttempts,
      cleanupNextAt: new Date(Date.now() + (failed ? Math.min(attempts, appConfig.blog.imageCleanupBackoffCap) : 1) * appConfig.blog.imageCleanupRetryMilliseconds) },
    $unset: { cleanupClaim: "", cleanupClaimUntil: "" },
  });
}
async function cleanArticle(article: Article): Promise<{ complete: boolean; remaining: number }> {
  const collection = await articles();
  let failed = false;
  let remaining = 0;
  const deadline = Date.now() + appConfig.blog.imageCleanupBatchMilliseconds;
  try {
    if (activeState(article)) {
      for (const url of article.pendingImageCleanup ?? []) {
        if (Date.now() >= deadline) break;
        try {
          const key = objectKey(url, article._id);
          const latest = await collection.findOne({ _id: article._id }, { projection: { heroUrl: 1, thumbnailUrl: 1, locales: 1, pendingImageCleanup: 1 } });
          if (!latest?.pendingImageCleanup?.includes(url)) continue;
          if (refs(latest).has(url)) { await collection.updateOne({ _id: article._id, pendingImageCleanup: url }, { $pull: { pendingImageCleanup: url } }); continue; }
          await bucket().file(key).delete({ ignoreNotFound: true });
          await collection.updateOne({ _id: article._id, pendingImageCleanup: url }, { $pull: { pendingImageCleanup: url } });
        } catch (error) { failed = true; logStorageFailure("Blog image cleanup failed", error); }
      }
      remaining = (await collection.findOne({ _id: article._id }, { projection: { pendingImageCleanup: 1 } }))?.pendingImageCleanup?.length ?? 0;
      return { complete: remaining === 0, remaining };
    }
    const swept = await sweepArticlePrefix(article._id, deadline);
    if (!swept.empty) return { complete: false, remaining: swept.remaining };
    await ensureIndexes();
    await (await markers()).updateOne({ _id: article._id }, { $setOnInsert: {
      _id: article._id, dueAt: new Date(Date.now() + appConfig.blog.imageDeleteGraceMilliseconds),
      ...(article.createKey ? { createKey: article.createKey } : {}),
    } }, { upsert: true });
    await collection.deleteOne({ _id: article._id, state: { $in: ["deleting", "deleted"] }, cleanupClaim: article.cleanupClaim });
    return { complete: false, remaining: 0 };
  } catch (error) { failed = true; logStorageFailure("Blog image cleanup failed", error); return { complete: false, remaining }; }
  finally { await releaseCleanup(article, failed).catch((error: unknown) => { logStorageFailure("Blog image cleanup state failed", error); }); }
}
async function claimMarker(id: ObjectId): Promise<CleanupMarker | null> {
  const now = new Date();
  return (await markers()).findOneAndUpdate({ _id: id, dueAt: { $lte: now },
    $and: [
      { $or: [{ cleanupClaimUntil: { $exists: false } }, { cleanupClaimUntil: { $lte: now } }] },
      { $or: [{ cleanupNextAt: { $exists: false } }, { cleanupNextAt: { $lte: now } }] },
    ],
  }, { $set: { cleanupClaim: randomBytes(12).toString("hex"), cleanupClaimUntil: new Date(now.getTime() + appConfig.blog.imageCleanupClaimMilliseconds) } }, { returnDocument: "after" });
}
async function releaseMarker(marker: CleanupMarker, failed: boolean) {
  const attempts = failed ? (marker.cleanupAttempts ?? 0) + 1 : 0;
  if (failed && (attempts === 1 || attempts === appConfig.blog.imageCleanupMaxAttempts)) console.error("Blog image cleanup retry needed", { articleId: marker._id.toHexString(), attempts, stage: "marker" });
  await (await markers()).updateOne({ _id: marker._id, cleanupClaim: marker.cleanupClaim }, {
    $set: { cleanupAttempts: attempts, cleanupStuck: attempts >= appConfig.blog.imageCleanupMaxAttempts,
      cleanupNextAt: new Date(Date.now() + (failed ? Math.min(attempts, appConfig.blog.imageCleanupBackoffCap) : 1) * appConfig.blog.imageCleanupRetryMilliseconds) },
    $unset: { cleanupClaim: "", cleanupClaimUntil: "" },
  });
}
async function cleanMarker(marker: CleanupMarker): Promise<void> {
  let failed = false;
  try {
    const article = await (await articles()).findOne({ _id: marker._id }, { projection: { state: 1 } });
    if (article) {
      if (activeState(article)) { failed = true; console.error("Blog cleanup marker conflicts with active article", { articleId: marker._id.toHexString() }); }
      return;
    }
    const swept = await sweepArticlePrefix(marker._id, Date.now() + appConfig.blog.imageCleanupBatchMilliseconds);
    if (swept.empty) await (await markers()).deleteOne({ _id: marker._id, cleanupClaim: marker.cleanupClaim });
  } catch (error) { failed = true; logStorageFailure("Blog image cleanup failed", error); }
  finally { await releaseMarker(marker, failed).catch((error: unknown) => { logStorageFailure("Blog image cleanup state failed", error); }); }
}
let cleanupRunning = false;
let orphanRunning = false;
async function processOrphanCleanup() {
  if (!appConfig.blog.orphanCleanupEnabled || orphanRunning) return;
  orphanRunning = true;
  try {
    const audit = await auditBlogImages();
    if (audit.foreignReferences.length || audit.invalidReferences) { console.error("Blog orphan audit needs review", { foreignReferences: audit.foreignReferences.length, invalidReferences: audit.invalidReferences }); return; }
    if (audit.invalidKeys.length || audit.unknownAge) console.warn("Blog orphan audit skipped unusual objects", { invalidKeys: audit.invalidKeys.length, unknownAge: audit.unknownAge });
    const result = await deleteAuditCandidates(audit);
    if (result.failed) console.error("Blog orphan cleanup incomplete", result);
  } catch (error) { logStorageFailure("Blog orphan audit failed", error); }
  finally { orphanRunning = false; }
}
export async function processDueBlogCleanup(): Promise<void> {
  if (!appConfig.blog.lifecycleWritesEnabled || cleanupRunning || !process.env.AUTH_MONGODB_URI) return;
  cleanupRunning = true;
  try {
    const collection = await articles();
    const now = new Date();
    const candidates = await collection.find({
      $and: [
        { $or: [{ state: { $in: ["deleting", "deleted"] } }, { "pendingImageCleanup.0": { $exists: true } }] },
        { $or: [{ cleanupNextAt: { $exists: false } }, { cleanupNextAt: { $lte: now } }] },
      ],
    }, { projection: { _id: 1 }, limit: appConfig.blog.imageCleanupBatchSize, sort: { cleanupNextAt: 1 } }).toArray();
    for (const candidate of candidates) {
      const claimed = await claimCleanup(candidate._id);
      if (claimed) await cleanArticle(claimed);
    }
    const dueMarkers = await (await markers()).find({ dueAt: { $lte: new Date() },
      $or: [{ cleanupNextAt: { $exists: false } }, { cleanupNextAt: { $lte: new Date() } }],
    }, { projection: { _id: 1 }, limit: appConfig.blog.imageCleanupBatchSize, sort: { dueAt: 1 } }).toArray();
    for (const marker of dueMarkers) {
      const claimed = await claimMarker(marker._id);
      if (claimed) await cleanMarker(claimed);
    }
  } catch (error) { logStorageFailure("Blog image cleanup scan failed", error); }
  finally { cleanupRunning = false; }
}
export function startBlogImageCleanupWorker(): () => void {
  if (!appConfig.blog.lifecycleWritesEnabled || !process.env.AUTH_MONGODB_URI) return () => {};
  void processDueBlogCleanup();
  void processOrphanCleanup();
  const interval = setInterval(() => { void processDueBlogCleanup(); }, appConfig.blog.imageCleanupRetryMilliseconds);
  const orphanInterval = setInterval(() => { void processOrphanCleanup(); }, appConfig.blog.imageOrphanCheckMilliseconds);
  interval.unref();
  orphanInterval.unref();
  return () => { clearInterval(interval); clearInterval(orphanInterval); };
}
async function removeUnused(previous: Article, current?: Article) {
  const currentRefs = current ? refs(current) : new Set<string>();
  for (const url of refs(previous)) {
    if (!currentRefs.has(url)) await discardImages(previous._id, [url]);
  }
}
export async function listArticles(locale: Locale, page = 1) {
  if (!Number.isSafeInteger(page) || page < 1 || page > 100000) throw new BlogError(404, "Page not found");
  const collection = await articles();
  const filter = locale === "en" ? { ...activeArticle, "locales.en": { $exists: true } } : activeArticle;
  const total = await collection.countDocuments(filter);
  if (page > 1 && (page - 1) * appConfig.blog.pageSize >= total) throw new BlogError(404, "Page not found");
  const rows = await collection.find(filter, { projection: { "locales.bg.html": 0, "locales.en.html": 0 } }).sort({ publishedAt: -1, _id: -1 }).skip((page - 1) * appConfig.blog.pageSize).limit(appConfig.blog.pageSize).toArray();
  return { rows, total, pages: Math.max(1, Math.ceil(total / appConfig.blog.pageSize)) };
}
export async function getArticle(slug: string, locale: Locale) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 90) return null;
  const article = await (await articles()).findOne({ slug, ...activeArticle });
  if (!article || !article.locales[locale]) return null;
  article.locales[locale].html = cleanHtml(article.locales[locale].html, article._id);
  return article;
}
export async function getLegacyArticle(id: string) {
  if (!ObjectId.isValid(id) || id.length !== 24) return null;
  return (await articles()).findOne({ legacyId: id.toLowerCase(), ...activeArticle }, { projection: { slug: 1 } });
}
export async function adminArticles() { return (await articles()).find(activeArticle, { projection: { "locales.bg.html": 0, "locales.en.html": 0 } }).sort({ publishedAt: -1 }).toArray(); }
export async function adminArticle(id: string) {
  if (!ObjectId.isValid(id) || id.length !== 24) return null;
  const article = await (await articles()).findOne({ _id: new ObjectId(id), ...activeArticle });
  if (article) for (const locale of ["bg", "en"] as const) if (article.locales[locale]) article.locales[locale].html = cleanHtml(article.locales[locale].html, article._id);
  return article;
}
export async function createArticle(input: Record<string, unknown>, files: Upload[], actor: ObjectId) {
  ensureKeys(input, ["locale", "title", "subtitle", "category", "html", "seoTitle", "seoDescription", "heroAlt", "thumbnailAlt", "createKey"]);
  if (input.locale !== "bg") throw new BlogError(400, "Create in Bulgarian first");
  normalizeSubtitle(input.subtitle, true);
  normalizeCategory(input.category, true);
  const createKey = text(input.createKey, 80);
  if (!/^[0-9a-f-]{36}$/.test(createKey)) throw new BlogError(400, "Invalid request key");
  await ensureIndexes();
  const collection = await articles();
  const prior = await collection.findOne({ createKey });
  if (prior) { if (!activeState(prior)) throw new BlogError(409, "Previous article is being deleted"); return prior; }
  if (await (await markers()).findOne({ createKey }, { projection: { _id: 1 } })) throw new BlogError(409, "Previous article is being deleted");
  const id = new ObjectId();
  const uploaded = await uploadedHtml(input, files, id);
  const now = new Date();
  const article: Article = { _id: id, slug: slugTitle(uploaded.text.title, id), createKey, publishedAt: now, updatedAt: now, version: 1, createdBy: actor, updatedBy: actor, heroUrl: uploaded.heroUrl, thumbnailUrl: uploaded.thumbnailUrl, locales: { bg: uploaded.text } };
  try {
    if (await (await markers()).findOne({ createKey }, { projection: { _id: 1 } })) throw new BlogError(409, "Previous article is being deleted");
    await collection.insertOne(article); return article;
  }
  catch (error) {
    const duplicate = await collection.findOne({ createKey });
    await discardImages(id, uploaded.created);
    if (duplicate) { if (!activeState(duplicate)) throw new BlogError(409, "Previous article is being deleted"); return duplicate; }
    if (await (await markers()).findOne({ createKey }, { projection: { _id: 1 } })) throw new BlogError(409, "Previous article is being deleted");
    throw error;
  }
}
export async function updateArticle(id: string, input: Record<string, unknown>, files: Upload[], actor: ObjectId) {
  const deadline = Date.now() + appConfig.blog.imageUploadDeadlineMilliseconds;
  ensureKeys(input, ["locale", "title", "subtitle", "category", "html", "seoTitle", "seoDescription", "heroAlt", "thumbnailAlt", "version"]);
  if (!ObjectId.isValid(id) || id.length !== 24 || input.locale !== "bg" && input.locale !== "en") throw new BlogError(400, "Invalid article");
  const version = Number(input.version);
  if (!Number.isSafeInteger(version) || version < 1) throw new BlogError(400, "Invalid version");
  const locale = input.locale;
  if (locale === "en" && files.length) throw new BlogError(400, "Use existing article images for translation");
  const collection = await articles();
  const previous = await collection.findOne({ _id: new ObjectId(id) });
  if (!previous) throw new BlogError(404, "Article not found");
  if (previous.state === "deleting" || previous.state === "deleted") throw new BlogError(409, "Article is being deleted");
  if (previous.version !== version) throw new BlogError(409, "Article changed; reload before saving");
  if ((locale === "en" && !previous.locales.en) || previous.locales[locale]?.subtitle) normalizeSubtitle(input.subtitle ?? previous.locales[locale]?.subtitle, true);
  const category = input.category ?? previous.locales[locale]?.category;
  normalizeCategory(category, (locale === "en" && !previous.locales.en) || Boolean(previous.locales[locale]?.category));
  const uploaded = await uploadedHtml({ ...input, subtitle: input.subtitle ?? previous.locales[locale]?.subtitle, category }, files, previous._id, previous, undefined, deadline);
  const permitted = new Set([...refs(previous), ...uploaded.accepted]);
  for (const url of refs({ ...previous, heroUrl: uploaded.heroUrl, thumbnailUrl: uploaded.thumbnailUrl, locales: { ...previous.locales, [locale]: uploaded.text } })) {
    if (!permitted.has(url) || previous.pendingImageCleanup?.includes(url)) {
      await discardImages(previous._id, uploaded.created);
      throw new BlogError(400, previous.pendingImageCleanup?.includes(url) ? "Re-upload an image that was removed from this article" : "Article image must already be in this article or uploaded now");
    }
  }
  const now = new Date();
  const next = { ...previous, heroUrl: uploaded.heroUrl, thumbnailUrl: uploaded.thumbnailUrl, locales: { ...previous.locales, [locale]: uploaded.text } };
  const nextRefs = refs(next);
  const obsolete = [...refs(previous)].filter((url) => !nextRefs.has(url));
  const update = { $set: { [`locales.${locale}`]: uploaded.text, heroUrl: uploaded.heroUrl, thumbnailUrl: uploaded.thumbnailUrl, updatedAt: now, updatedBy: actor,
    ...(appConfig.blog.lifecycleWritesEnabled && obsolete.length ? { cleanupNextAt: now, cleanupStuck: false } : {}) }, $inc: { version: 1 },
    ...(appConfig.blog.lifecycleWritesEnabled && obsolete.length ? { $addToSet: { pendingImageCleanup: { $each: obsolete } } } : {}) };
  let before: Article | null;
  try { before = await collection.findOneAndUpdate({ _id: previous._id, version, ...activeArticle }, update, { returnDocument: "before" }); }
  catch (error) { await discardImages(previous._id, uploaded.created); throw error; }
  if (!before) {
    await discardImages(previous._id, uploaded.created);
    throw new BlogError(409, "Article changed; reload before saving");
  }
  const current = await collection.findOne({ _id: previous._id });
  if (appConfig.blog.lifecycleWritesEnabled) void processDueBlogCleanup();
  else if (current) await removeUnused(before, current);
  if (!current || !activeState(current)) throw new BlogError(409, "Article changed; reload before saving");
  return current;
}
export async function deleteArticle(id: string, version: number): Promise<{ complete: boolean; remaining: number }> {
  if (!appConfig.blog.lifecycleWritesEnabled) throw new BlogError(503, "Article deletion is temporarily unavailable");
  if (!ObjectId.isValid(id) || id.length !== 24 || !Number.isSafeInteger(version)) throw new BlogError(400, "Invalid article");
  const collection = await articles();
  const articleId = new ObjectId(id);
  const previous = await collection.findOne({ _id: articleId });
  if (!previous) return { complete: !await (await markers()).findOne({ _id: articleId }, { projection: { _id: 1 } }), remaining: 0 };
  if (activeState(previous)) {
    if (previous.version !== version) throw new BlogError(409, "Article changed; reload before deleting");
    await assertNoForeignReferences(articleId);
    if (previous.legacyId) {
      const { db } = await authConnection();
      const closed = await authCollections(db).control.updateOne({ _id: "singleton" }, { $set: { blogMigrationClosed: true } });
      if (closed.matchedCount !== 1) throw new BlogError(503, "Legacy migration state unavailable");
    }
    const changed = await collection.findOneAndUpdate({ _id: articleId, version, ...activeArticle }, { $set: { state: "deleting", cleanupNextAt: new Date() }, $inc: { version: 1 } }, { returnDocument: "after" });
    if (!changed) {
      const latest = await collection.findOne({ _id: articleId }, { projection: { state: 1 } });
      if (!latest) return { complete: true, remaining: 0 };
      if (!activeState(latest)) return { complete: false, remaining: 0 };
      throw new BlogError(409, "Article changed; reload before deleting");
    }
  }
  const claimed = await claimCleanup(articleId, true);
  if (!claimed) return { complete: false, remaining: 0 };
  return cleanArticle(claimed);
}
export async function retryArticleImageCleanup(id: string): Promise<{ complete: boolean; remaining: number }> {
  if (!appConfig.blog.lifecycleWritesEnabled) throw new BlogError(503, "Image cleanup is temporarily unavailable");
  if (!/^[a-f0-9]{24}$/.test(id)) throw new BlogError(400, "Invalid article");
  const articleId = new ObjectId(id);
  const article = await (await articles()).findOne({ _id: articleId });
  if (!article) throw new BlogError(404, "Article not found");
  if (!activeState(article)) throw new BlogError(409, "Use article deletion retry");
  if (!article.pendingImageCleanup?.length) return { complete: true, remaining: 0 };
  const claimed = await claimCleanup(articleId, true);
  if (!claimed) return { complete: false, remaining: article.pendingImageCleanup.length };
  return cleanArticle(claimed);
}

export async function importLegacyArticle(raw: LegacyArticle, actor: ObjectId, files: Upload[], html: string, allowedLegacyIds?: ReadonlySet<string>) {
  if (!(raw._id instanceof ObjectId)) throw new BlogError(400, "Invalid legacy article ID");
  const id = raw._id;
  const idString = id.toHexString();
  const importAllowed = async () => {
    const { db } = await authConnection();
    const control = await authCollections(db).control.findOne({ _id: "singleton" }, { projection: { blogMigrationClosed: 1 } });
    if (!control || control.blogMigrationClosed && !allowedLegacyIds?.has(idString)) throw new BlogError(409, "Legacy migration requires an explicit allowed ID");
    if (allowedLegacyIds && !allowedLegacyIds.has(idString)) throw new BlogError(409, "Legacy article is not in the allowed ID list");
    if (await (await markers()).findOne({ _id: id }, { projection: { _id: 1 } })) throw new BlogError(409, "Article image cleanup is still running");
  };
  await ensureIndexes();
  const collection = await articles();
  const existing = await collection.findOne({ legacyId: id.toHexString() });
  if (existing) return false;
  await importAllowed();
  const date = new Date(raw.dateCreated);
  if (!Number.isFinite(date.getTime())) throw new BlogError(400, "Invalid legacy article date");
  const input = { title: raw.articleTitle, html, seoTitle: raw.articleMetaTitle, seoDescription: raw.articleMetaDescription, heroAlt: raw.articleAlt, thumbnailAlt: raw.articleAlt };
  const uploaded = await uploadedHtml(input, files, id, undefined, "0000000000000000");
  const article: Article = { _id: id, legacyId: id.toHexString(), slug: slugTitle(uploaded.text.title, id), publishedAt: date, updatedAt: date, version: 1, createdBy: actor, updatedBy: actor, heroUrl: uploaded.heroUrl, thumbnailUrl: uploaded.thumbnailUrl, locales: { bg: { ...uploaded.text, updatedAt: date } } };
  try { await importAllowed(); await collection.insertOne(article); return true; }
  catch (error) {
    await discardImages(id, uploaded.created);
    throw error;
  }
}

export function validateLegacyArticle(raw: LegacyArticle, html: string) {
  if (!(raw._id instanceof ObjectId) || !Number.isFinite(new Date(raw.dateCreated).getTime()) || !bucketName()) throw new BlogError(400, "Invalid legacy article");
  let candidate = html;
  for (let index = 0; index < appConfig.blog.maxImages; index++) {
    const name = `inline-${index}`;
    const key = `${appConfig.blog.imagePrefix}/${raw._id.toHexString()}/${name}/${"0".repeat(64)}-0000000000000000.webp`;
    candidate = candidate.replaceAll(`src="pending:${name}"`, `src="${imageUrl(key)}"`);
  }
  if (candidate.includes("pending:")) throw new BlogError(400, "Invalid legacy article images");
  fields({ title: raw.articleTitle, seoTitle: raw.articleMetaTitle, seoDescription: raw.articleMetaDescription, heroAlt: raw.articleAlt, thumbnailAlt: raw.articleAlt }, candidate, raw._id);
}
