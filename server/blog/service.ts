import { createHash, randomBytes } from "node:crypto";
import { Storage } from "@google-cloud/storage";
import { ObjectId, type Collection } from "mongodb";
import sanitizeHtml from "sanitize-html";
import sharp from "sharp";
import { appConfig, type Locale } from "../../lib/config.ts";
import { authConnection } from "../auth/db.ts";

export type BlogText = { title: string; subtitle?: string; html: string; seoTitle: string; seoDescription: string; heroAlt: string; thumbnailAlt: string; updatedAt: Date };
export type Article = {
  _id: ObjectId; slug: string; legacyId?: string; createKey?: string; publishedAt: Date; updatedAt: Date;
  version: number; createdBy: ObjectId; updatedBy: ObjectId; heroUrl: string; thumbnailUrl: string;
  locales: { bg: BlogText; en?: BlogText };
};
export type Upload = { name: string; bytes: Buffer };
export type LegacyArticle = { _id: ObjectId; articleTitle: string; articleImage: string; articleThumbnailImage: string; articleAlt: string; articleContent: string; articleMetaTitle: string; articleMetaDescription: string; dateCreated: string };
export class BlogError extends Error { constructor(public status: number, message: string) { super(message); } }

const storage = new Storage();
let indexes: Promise<void> | undefined;

export function bucketName(): string | undefined {
  const name = process.env[appConfig.blog.bucketEnv];
  if (!name) return undefined;
  if (!/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/.test(name) || name.includes("..")) throw new Error("Invalid blog storage configuration");
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

function text(value: unknown, max: number, required = true): string {
  if (typeof value !== "string") throw new BlogError(400, "Invalid article field");
  const result = value.normalize("NFC").trim();
  if (result.length > max || required && !result || /[\p{Cc}\p{Cf}]/u.test(result)) throw new BlogError(400, "Invalid article field");
  return result;
}
export function normalizeSubtitle(value: unknown, required = false): string | undefined {
  return value === undefined && !required ? undefined : text(value, 240, required);
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
  const clean = sanitizeHtml(source, {
    allowedTags: ["p", "br", "h2", "h3", "h4", "strong", "em", "u", "s", "blockquote", "pre", "code", "ol", "ul", "li", "a", "img"],
    allowedAttributes: { a: ["href", "target", "rel"], img: ["src", "alt"], p: ["class"], h2: ["class"], h3: ["class"], h4: ["class"], li: ["class"], pre: ["class"] },
    allowedClasses: { p: ["ql-align-center", "ql-align-right", "ql-align-justify"], h2: ["ql-align-center", "ql-align-right", "ql-align-justify"], h3: ["ql-align-center", "ql-align-right", "ql-align-justify"], h4: ["ql-align-center", "ql-align-right", "ql-align-justify"], li: ["ql-indent-1", "ql-indent-2"], pre: ["ql-syntax"] },
    allowedSchemes: ["http", "https", "mailto"], allowedSchemesByTag: { img: ["https"] }, allowProtocolRelative: false,
    transformTags: {
      img: (_tag, attrs) => {
        objectKey(attrs.src ?? "", articleId);
        if (!attrs.alt || !attrs.alt.trim() || attrs.alt.length > 180) throw new BlogError(400, "Image alt text is required");
        return { tagName: "img", attribs: { src: attrs.src, alt: text(attrs.alt, 180) } };
      },
      a: (_tag, attrs) => {
        if (!attrs.href || !/^(https?:\/\/|mailto:)/i.test(attrs.href)) return { tagName: "span", attribs: {} as Record<string, string> };
        return { tagName: "a", attribs: { href: attrs.href, rel: "noopener noreferrer", target: "_blank" } };
      },
    },
  });
  const words = sanitizeHtml(clean, { allowedTags: [], allowedAttributes: {} }).trim().split(/\s+/u).filter(Boolean);
  if (!words.length || words.length > appConfig.blog.maxWords || Buffer.byteLength(clean, "utf8") > appConfig.blog.maxHtmlBytes) throw new BlogError(400, "Invalid article content");
  return clean;
}
function fields(input: Record<string, unknown>, html: string, id: ObjectId): BlogText {
  const subtitle = normalizeSubtitle(input.subtitle);
  return { title: text(input.title, 80), ...(subtitle === undefined ? {} : { subtitle }), html: cleanHtml(html, id), seoTitle: text(input.seoTitle, 70), seoDescription: text(input.seoDescription, 160), heroAlt: text(input.heroAlt, 180), thumbnailAlt: text(input.thumbnailAlt, 180), updatedAt: new Date() };
}
function ensureKeys(input: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(input).some((key) => !allowed.includes(key))) throw new BlogError(400, "Unexpected article field");
}
async function articles(): Promise<Collection<Article>> { return (await authConnection()).db.collection<Article>(appConfig.blog.collection); }
async function ensureIndexes() {
  indexes ??= (async () => { const collection = await articles(); await collection.createIndex({ slug: 1 }, { unique: true }); await collection.createIndex({ legacyId: 1 }, { unique: true, partialFilterExpression: { legacyId: { $exists: true } } }); await collection.createIndex({ createKey: 1 }, { unique: true, partialFilterExpression: { createKey: { $exists: true } } }); await collection.createIndex({ publishedAt: -1 }); })().catch((error: unknown) => { indexes = undefined; throw error; });
  await indexes;
}
async function upload(id: ObjectId, item: Upload, batchId: string): Promise<{ url: string; created: boolean }> {
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
  try {
    await bucket().file(key).save(processed, { resumable: false, contentType: "image/webp", metadata: { cacheControl: "public, max-age=31536000, immutable" }, preconditionOpts: { ifGenerationMatch: 0 } });
    return { url: imageUrl(key), created: true };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === 412) return { url: imageUrl(key), created: false };
    throw error;
  }
}
async function discardImages(id: ObjectId, urls: string[]) {
  await Promise.allSettled(urls.map(async (url) => {
    try { await bucket().file(objectKey(url, id)).delete({ ignoreNotFound: true }); }
    catch (error) { console.warn("Blog image cleanup failed", { name: error instanceof Error ? error.name : "Unknown" }); }
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
async function uploadedHtml(input: Record<string, unknown>, files: Upload[], id: ObjectId, existing?: Article, batchId = randomBytes(8).toString("hex")) {
  const created: string[] = [];
  const urls = new Map<string, string>();
  try {
    if (typeof input.html !== "string") throw new BlogError(400, "Invalid article content");
    for (const file of files) if (file.name.startsWith("inline-") && !input.html.includes(`src="pending:${file.name}"`)) throw new BlogError(400, "Unused image upload");
    for (const file of files) {
      if (urls.has(file.name)) throw new BlogError(400, "Duplicate image");
      const result = await upload(id, file, batchId);
      urls.set(file.name, result.url);
      if (result.created) created.push(result.url);
    }
    if (typeof input.html !== "string") throw new BlogError(400, "Invalid article content");
    const html = resolveInlinePlaceholders(input.html, urls);
    const heroUrl = urls.get("hero") ?? existing?.heroUrl;
    const thumbnailUrl = urls.get("thumbnail") ?? existing?.thumbnailUrl;
    if (!heroUrl || !thumbnailUrl) throw new BlogError(400, "Main and thumbnail images are required");
    objectKey(heroUrl, id); objectKey(thumbnailUrl, id);
    return { text: fields(input, html, id), heroUrl, thumbnailUrl, created };
  } catch (error) {
    await discardImages(id, created);
    throw error;
  }
}
function refs(article: Article): Set<string> {
  return new Set([article.heroUrl, article.thumbnailUrl, ...[article.locales.bg, article.locales.en].filter((entry): entry is BlogText => Boolean(entry)).flatMap((entry) => [...entry.html.matchAll(/<img\s+[^>]*src="([^"]+)"/g)].map((match) => match[1]))]);
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
  const filter = locale === "en" ? { "locales.en": { $exists: true } } : {};
  const total = await collection.countDocuments(filter);
  if (page > 1 && (page - 1) * appConfig.blog.pageSize >= total) throw new BlogError(404, "Page not found");
  const rows = await collection.find(filter, { projection: { "locales.bg.html": 0, "locales.en.html": 0 } }).sort({ publishedAt: -1, _id: -1 }).skip((page - 1) * appConfig.blog.pageSize).limit(appConfig.blog.pageSize).toArray();
  return { rows, total, pages: Math.max(1, Math.ceil(total / appConfig.blog.pageSize)) };
}
export async function getArticle(slug: string, locale: Locale) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 90) return null;
  const article = await (await articles()).findOne({ slug });
  if (!article || !article.locales[locale]) return null;
  article.locales[locale].html = cleanHtml(article.locales[locale].html, article._id);
  return article;
}
export async function getLegacyArticle(id: string) {
  if (!ObjectId.isValid(id) || id.length !== 24) return null;
  return (await articles()).findOne({ legacyId: id.toLowerCase() }, { projection: { slug: 1 } });
}
export async function adminArticles() { return (await articles()).find({}, { projection: { "locales.bg.html": 0, "locales.en.html": 0 } }).sort({ publishedAt: -1 }).toArray(); }
export async function adminArticle(id: string) {
  if (!ObjectId.isValid(id) || id.length !== 24) return null;
  const article = await (await articles()).findOne({ _id: new ObjectId(id) });
  if (article) for (const locale of ["bg", "en"] as const) if (article.locales[locale]) article.locales[locale].html = cleanHtml(article.locales[locale].html, article._id);
  return article;
}
export async function createArticle(input: Record<string, unknown>, files: Upload[], actor: ObjectId) {
  ensureKeys(input, ["locale", "title", "subtitle", "html", "seoTitle", "seoDescription", "heroAlt", "thumbnailAlt", "createKey"]);
  if (input.locale !== "bg") throw new BlogError(400, "Create in Bulgarian first");
  normalizeSubtitle(input.subtitle, true);
  const createKey = text(input.createKey, 80);
  if (!/^[0-9a-f-]{36}$/.test(createKey)) throw new BlogError(400, "Invalid request key");
  await ensureIndexes();
  const collection = await articles();
  const prior = await collection.findOne({ createKey });
  if (prior) return prior;
  const id = new ObjectId();
  const uploaded = await uploadedHtml(input, files, id);
  const now = new Date();
  const article: Article = { _id: id, slug: slugTitle(uploaded.text.title, id), createKey, publishedAt: now, updatedAt: now, version: 1, createdBy: actor, updatedBy: actor, heroUrl: uploaded.heroUrl, thumbnailUrl: uploaded.thumbnailUrl, locales: { bg: uploaded.text } };
  try { await collection.insertOne(article); return article; }
  catch (error) {
    const duplicate = await collection.findOne({ createKey });
    await discardImages(id, uploaded.created);
    if (duplicate) return duplicate;
    throw error;
  }
}
export async function updateArticle(id: string, input: Record<string, unknown>, files: Upload[], actor: ObjectId) {
  ensureKeys(input, ["locale", "title", "subtitle", "html", "seoTitle", "seoDescription", "heroAlt", "thumbnailAlt", "version"]);
  if (!ObjectId.isValid(id) || id.length !== 24 || input.locale !== "bg" && input.locale !== "en") throw new BlogError(400, "Invalid article");
  const version = Number(input.version);
  if (!Number.isSafeInteger(version) || version < 1) throw new BlogError(400, "Invalid version");
  const locale = input.locale;
  if (locale === "en" && files.length) throw new BlogError(400, "Use existing article images for translation");
  const collection = await articles();
  const previous = await collection.findOne({ _id: new ObjectId(id) });
  if (!previous) throw new BlogError(404, "Article not found");
  if (previous.version !== version) throw new BlogError(409, "Article changed; reload before saving");
  if ((locale === "en" && !previous.locales.en) || previous.locales[locale]?.subtitle) normalizeSubtitle(input.subtitle ?? previous.locales[locale]?.subtitle, true);
  const uploaded = await uploadedHtml({ ...input, subtitle: input.subtitle ?? previous.locales[locale]?.subtitle }, files, previous._id, previous);
  if (locale === "en") {
    const permitted = refs(previous);
    for (const match of uploaded.text.html.matchAll(/<img\s+[^>]*src="([^"]+)"/g)) {
      if (!permitted.has(match[1])) throw new BlogError(400, "Translation must use existing article images");
    }
  }
  const now = new Date();
  const update = { $set: { [`locales.${locale}`]: uploaded.text, heroUrl: uploaded.heroUrl, thumbnailUrl: uploaded.thumbnailUrl, updatedAt: now, updatedBy: actor }, $inc: { version: 1 } };
  const before = await collection.findOneAndUpdate({ _id: previous._id, version }, update, { returnDocument: "before" });
  if (!before) {
    await discardImages(previous._id, uploaded.created);
    throw new BlogError(409, "Article changed; reload before saving");
  }
  const current = await collection.findOne({ _id: previous._id });
  if (current) await removeUnused(before, current);
  return current;
}
export async function deleteArticle(id: string, version: number) {
  if (!ObjectId.isValid(id) || id.length !== 24 || !Number.isSafeInteger(version)) throw new BlogError(400, "Invalid article");
  const previous = await (await articles()).findOneAndDelete({ _id: new ObjectId(id), version });
  if (!previous) throw new BlogError(409, "Article changed or missing");
  await removeUnused(previous);
}

export async function importLegacyArticle(raw: LegacyArticle, actor: ObjectId, files: Upload[], html: string) {
  if (!(raw._id instanceof ObjectId)) throw new BlogError(400, "Invalid legacy article ID");
  const id = raw._id;
  await ensureIndexes();
  const collection = await articles();
  const existing = await collection.findOne({ legacyId: id.toHexString() });
  if (existing) return false;
  const date = new Date(raw.dateCreated);
  if (!Number.isFinite(date.getTime())) throw new BlogError(400, "Invalid legacy article date");
  const input = { title: raw.articleTitle, html, seoTitle: raw.articleMetaTitle, seoDescription: raw.articleMetaDescription, heroAlt: raw.articleAlt, thumbnailAlt: raw.articleAlt };
  const uploaded = await uploadedHtml(input, files, id, undefined, "0000000000000000");
  const article: Article = { _id: id, legacyId: id.toHexString(), slug: slugTitle(uploaded.text.title, id), publishedAt: date, updatedAt: date, version: 1, createdBy: actor, updatedBy: actor, heroUrl: uploaded.heroUrl, thumbnailUrl: uploaded.thumbnailUrl, locales: { bg: { ...uploaded.text, updatedAt: date } } };
  try { await collection.insertOne(article); return true; }
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
