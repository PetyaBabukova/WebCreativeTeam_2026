import { afterEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { Storage } from "@google-cloud/storage";
import { appConfig } from "../../lib/config.js";
import { adminArticle, adminArticles, auditBlogImages, BlogError, bucketName, cleanHtml, createArticle, deleteArticle, deleteAuditedImages, importLegacyArticle, normalizeSubtitle, objectKey, processDueBlogCleanup, resolveInlinePlaceholders, startBlogStorageMonitor, storageAccessFailure, storageErrorInfo, updateArticle, type LegacyArticle } from "../../server/blog/service.js";
import * as db from "../../server/auth/db.js";
import { runImageReconciliation } from "../../server/blog/reconcile.js";

const id = new ObjectId("507f1f77bcf86cd799439011");
const ownImage = `/api/blog/images/${id.toHexString()}/inline-0/${"a".repeat(64)}-${"b".repeat(16)}.webp`;
afterEach(() => vi.unstubAllEnvs());

describe("blog HTML boundary", () => {
  it("normalizes optional legacy subtitles and requires safe text for new articles", () => {
    expect(normalizeSubtitle(undefined)).toBeUndefined();
    expect(normalizeSubtitle("  Hello  ", true)).toBe("Hello");
    for (const subtitle of [undefined, "  ", "x".repeat(241), "Hello\u0000world"]) {
      expect(() => normalizeSubtitle(subtitle, true)).toThrow(BlogError);
    }
  });
  it("rejects missing, blank, unsafe and oversized categories for new articles", async () => {
    const connection = vi.spyOn(db, "authConnection").mockRejectedValue(new Error("Unexpected database access"));
    const valid = { locale: "bg", title: "Example", subtitle: "Subtitle", html: "<p>Hello</p>", seoTitle: "Example", seoDescription: "Description", heroAlt: "Hero", thumbnailAlt: "Thumbnail", createKey: "00000000-0000-0000-0000-000000000001" };
    try {
      for (const category of [undefined, "  ", "x".repeat(61), "Brand\u0000ing"]) {
        await expect(createArticle({ ...valid, category }, [], id)).rejects.toMatchObject({ status: 400 });
      }
      expect(connection).not.toHaveBeenCalled();
    } finally { connection.mockRestore(); }
  });
  it("keeps permitted formatting while stripping scripts and unsafe links", () => {
    vi.stubEnv("BLOG_GCS_BUCKET", "blog-test");
    const html = cleanHtml('<h2>Hello</h2><script>alert(1)</script><p><a href="javascript:alert(1)" onclick="alert(2)">link</a></p>', id);
    expect(html).toContain("<h2>Hello</h2>");
    expect(html).not.toMatch(/script|onclick|javascript|alert/);
    expect(html).toContain("link");
  });
  it("keeps safe internal links in the same tab and rejects disguised external paths", () => {
    const internal = cleanHtml('<p><a href="/contacts" target="_blank" rel="noopener">Contact</a> <a href="https://example.com/">External</a></p>', id);
    expect(internal).toContain('<a href="/contacts">Contact</a>');
    expect(internal).toContain('href="https://example.com/" rel="noopener noreferrer" target="_blank"');
    expect(cleanHtml(internal, id)).toBe(internal);
    for (const href of ["//evil.com", "/.//evil.com", "/%2e//evil.com", "/..//evil.com", "/blog/../..//evil.com", "/%2E%2E/x", "/a/%2F/b", "/.", "/%2f%2fevil.com", "/%5cevil.com", "/&#47;/evil.com", "&#x2F;&#x2F;evil.com", "javascript:alert(1)"]) {
      const cleaned = cleanHtml(`<p><a href="${href}">Unsafe destination</a></p>`, id);
      expect(cleaned).not.toContain("<a ");
      expect(cleaned).toContain("Unsafe destination");
    }
  });
  it("accepts only images from the same article with alt text", () => {
    vi.stubEnv("BLOG_GCS_BUCKET", "blog-test");
    expect(cleanHtml(`<p>Text</p><img src="${ownImage}" alt="Example">`, id)).toContain(ownImage);
    for (const url of [ownImage.replace(id.toHexString(), "507f1f77bcf86cd799439012"), `${ownImage}?token=1`, `//example.com${ownImage}`, ownImage.replace("/api/blog/images/", "/api/contact/"), "https://example.com/photo.webp"]) {
      expect(() => cleanHtml(`<p>Text</p><img src="${url}" alt="Example">`, id)).toThrow(BlogError);
    }
    expect(() => cleanHtml(`<p>Text</p><img src="${ownImage}">`, id)).toThrow(BlogError);
  });
  it("accepts only the exact blog image path", () => {
    expect(objectKey(ownImage, id)).toBe(`blog/${id.toHexString()}/inline-0/${"a".repeat(64)}-${"b".repeat(16)}.webp`);
    for (const url of [ownImage.replace("inline-0", "inline-20"), ownImage.replace("/images/", "//images/"), `${ownImage}/`, `${ownImage}#x`, `${ownImage}%2f`, `${ownImage}?x=1`, ownImage.replace("/inline-0/", "/../")]) {
      expect(() => objectKey(url, id)).toThrow(BlogError);
    }
  });
  it("replaces inline image 1 without corrupting inline image 10", () => {
    const html = '<p><img src="pending:inline-1" alt="One"><img src="pending:inline-10" alt="Ten"></p>';
    expect(resolveInlinePlaceholders(html, new Map([["inline-1", "https://example.test/one.webp"], ["inline-10", "https://example.test/ten.webp"]])))
      .toContain('<img src="https://example.test/ten.webp"');
    expect(() => resolveInlinePlaceholders(html, new Map([["inline-1", "https://example.test/one.webp"]]))).toThrow(BlogError);
  });
  it("allows ordinary text containing pending:", () => {
    expect(resolveInlinePlaceholders("<p>Status pending: review</p>", new Map())).toBe("<p>Status pending: review</p>");
  });
});

describe("blog storage diagnostics", () => {
  it("extracts only safe fields from each storage error shape", () => {
    const oauth = Object.assign(new Error("token ya29.secret"), { status: 400, response: { status: 400, data: { error: "invalid_grant", error_subtype: "invalid_rapt" } }, config: { headers: { authorization: "Bearer ya29.secret" } } });
    const gcsJson = Object.assign(new Error("denied for blog-bucket/blog/key.webp"), { response: { status: 403, data: { error: { errors: [{ reason: "forbidden" }] } } } });
    const apiError = Object.assign(new Error("No such object"), { code: 404, errors: [{ reason: "notFound" }] });
    const network = Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
    const noCredentials = new Error("Could not load the default credentials. Browse to https://cloud.google.com/docs/authentication/getting-started for more information.");
    const missingKeyFile = Object.assign(new Error("ENOENT: no such file, open '/etc/secrets/key.json'"), { code: "ENOENT" });
    const mongo = Object.assign(new Error("Authentication failed for mongodb://user:pw@host"), { code: 18, codeName: "AuthenticationFailed" });
    const mongoConflict = Object.assign(new Error("conflict"), { code: 403 });
    expect(storageErrorInfo(missingKeyFile)).toEqual({ name: "Error", code: "ENOENT", reason: "no_credentials" });
    expect(storageErrorInfo(mongo)).toEqual({ name: "Error", numericCode: 18 });
    expect(storageAccessFailure(storageErrorInfo(mongoConflict))).toBe(false);
    const hostile = Object.assign(new Error("x"), { name: "Bearer ya29", code: "lower-case secret", response: { status: 99, data: { error: "reason with spaces" } } });
    expect(storageErrorInfo(oauth)).toEqual({ name: "Error", status: 400, reason: "invalid_grant" });
    expect(storageErrorInfo(gcsJson)).toEqual({ name: "Error", status: 403, reason: "forbidden" });
    expect(storageErrorInfo(apiError)).toEqual({ name: "Error", status: 404, reason: "notFound" });
    expect(storageErrorInfo(network)).toEqual({ name: "Error", code: "ECONNRESET" });
    expect(storageErrorInfo(noCredentials)).toEqual({ name: "Error", reason: "no_credentials" });
    expect(storageErrorInfo(hostile)).toEqual({ name: "Unknown" });
    expect(storageErrorInfo("plain string")).toEqual({ name: "Unknown" });
    expect(JSON.stringify([oauth, gcsJson, hostile, missingKeyFile, mongo].map(storageErrorInfo))).not.toMatch(/ya29|authorization|blog-bucket|key\.webp|spaces|secrets|mongodb:|pw@/);
    expect([oauth, gcsJson, noCredentials].map((error) => storageAccessFailure(storageErrorInfo(error)))).toEqual([true, true, true]);
    expect([apiError, network].map((error) => storageAccessFailure(storageErrorInfo(error)))).toEqual([false, false]);
  });
  it("fails startup on an invalid bucket name with a loggable code", () => {
    vi.stubEnv("BLOG_GCS_BUCKET", "Bad_Bucket..name");
    expect(() => bucketName()).toThrow(expect.objectContaining({ code: "BLOG_STORAGE_CONFIG" }));
  });
});

describe("blog image reconciliation", () => {
  it("excludes hidden deletions from both admin reads", async () => {
    const find = vi.fn((filter: unknown) => { void filter; return { sort: () => ({ toArray: async () => [] }) }; });
    const findOne = vi.fn(async (filter: unknown) => { void filter; return null; });
    const connection = vi.spyOn(db, "authConnection").mockResolvedValue({ db: { collection: () => ({ find, findOne }) } } as never);
    try {
      await adminArticles();
      await adminArticle(id.toHexString());
      expect(find.mock.calls[0][0]).toEqual({ state: { $nin: ["deleting", "deleted"] } });
      expect(findOne.mock.calls[0][0]).toEqual({ _id: id, state: { $nin: ["deleting", "deleted"] } });
    } finally { connection.mockRestore(); }
  });
  it("requires explicit historical-delete approval before scanning", async () => {
    await expect(runImageReconciliation("execute", "0".repeat(64))).rejects.toThrow("Explicit approval flag is required");
  });
  it("does not execute a manual deletion while lifecycle writes are disabled", async () => {
    vi.stubEnv("BLOG_IMAGE_LIFECYCLE_WRITES", "");
    await expect(deleteAuditedImages("0".repeat(64))).rejects.toMatchObject({ status: 503 });
  });
  it("measures orphan age at audit start even when scanning is slow", async () => {
    vi.stubEnv("BLOG_GCS_BUCKET", "blog-test");
    const started = Date.now();
    const key = `blog/507f1f77bcf86cd799439012/hero/${"e".repeat(64)}-${"f".repeat(16)}.webp`;
    const clock = vi.spyOn(Date, "now").mockReturnValueOnce(started).mockReturnValue(started + 2 * 60_000);
    const bucket = vi.spyOn(Storage.prototype, "bucket").mockReturnValue({ getFiles: vi.fn().mockResolvedValue([[{ name: key, metadata: { timeCreated: new Date(started - appConfig.blog.imageDeleteGraceMilliseconds + 1).toISOString() } }], null]) } as never);
    const connection = vi.spyOn(db, "authConnection").mockResolvedValue({ db: { collection: () => ({ find: () => ({ async *[Symbol.asyncIterator]() { /* No articles. */ } }) }) } } as never);
    try {
      const audit = await auditBlogImages();
      expect(audit.candidates).toEqual([]);
      expect(audit.recent).toBe(1);
    } finally { clock.mockRestore(); bucket.mockRestore(); connection.mockRestore(); }
  });
  it("queues a replaced inline image in the same versioned article update", async () => {
    vi.stubEnv("BLOG_IMAGE_LIFECYCLE_WRITES", "true");
    vi.stubEnv("AUTH_MONGODB_URI", "");
    const hero = `/api/blog/images/${id.toHexString()}/hero/${"1".repeat(64)}-${"2".repeat(16)}.webp`;
    const thumbnail = `/api/blog/images/${id.toHexString()}/thumbnail/${"3".repeat(64)}-${"4".repeat(16)}.webp`;
    const old = { title: "Example", category: "Branding", html: `<p>Hello <img src="${ownImage}" alt="Example"></p>`, seoTitle: "Example", seoDescription: "Example", heroAlt: "Hero", thumbnailAlt: "Thumbnail", updatedAt: new Date() };
    const previous = { _id: id, version: 2, heroUrl: hero, thumbnailUrl: thumbnail, locales: { bg: old } };
    const current = { ...previous, version: 3, locales: { bg: { ...old, html: "<p>Hello</p>" } }, pendingImageCleanup: [ownImage] };
    const findOne = vi.fn().mockResolvedValueOnce(previous).mockResolvedValueOnce(current);
    const findOneAndUpdate = vi.fn().mockResolvedValue(previous);
    const connection = vi.spyOn(db, "authConnection").mockResolvedValue({ db: { collection: () => ({ findOne, findOneAndUpdate }) } } as never);
    try {
      const saved = await updateArticle(id.toHexString(), { locale: "bg", title: "Example", html: "<p>Hello</p>", seoTitle: "Example", seoDescription: "Example", heroAlt: "Hero", thumbnailAlt: "Thumbnail", version: 2 }, [], id);
      expect(saved).toBe(current);
      const update = findOneAndUpdate.mock.calls[0][1];
      expect(update.$addToSet.pendingImageCleanup.$each).toEqual([ownImage]);
      expect(update.$set.cleanupNextAt).toBeInstanceOf(Date);
      expect(update.$inc.version).toBe(1);
      expect(update.$set["locales.bg"].category).toBe("Branding");
    } finally { connection.mockRestore(); }
  });
  it("does not allow clearing an existing category during an update", async () => {
    const hero = ownImage.replace("/inline-0/", "/hero/");
    const thumbnail = ownImage.replace("/inline-0/", "/thumbnail/");
    const previous = { _id: id, version: 2, heroUrl: hero, thumbnailUrl: thumbnail, locales: { bg: { title: "Example", category: "Branding", html: "<p>Hello</p>", seoTitle: "Example", seoDescription: "Description", heroAlt: "Hero", thumbnailAlt: "Thumbnail" } } };
    const input = { locale: "bg", title: "Example", category: "", html: "<p>Hello</p>", seoTitle: "Example", seoDescription: "Description", heroAlt: "Hero", thumbnailAlt: "Thumbnail", version: 2 };
    const findOne = vi.fn().mockResolvedValue(previous);
    const connection = vi.spyOn(db, "authConnection").mockResolvedValue({ db: { collection: () => ({ findOne }) } } as never);
    try {
      await expect(updateArticle(id.toHexString(), input, [], id)).rejects.toMatchObject({ status: 400 });
      expect(findOne).toHaveBeenCalledTimes(1);
    } finally { connection.mockRestore(); }
  });
  it("allows an uncategorized legacy article to save and requires a category for its first English translation", async () => {
    const hero = ownImage.replace("/inline-0/", "/hero/");
    const thumbnail = ownImage.replace("/inline-0/", "/thumbnail/");
    const old = { title: "Example", html: "<p>Hello</p>", seoTitle: "Example", seoDescription: "Description", heroAlt: "Hero", thumbnailAlt: "Thumbnail" };
    const previous = { _id: id, version: 2, heroUrl: hero, thumbnailUrl: thumbnail, locales: { bg: old } };
    const current = { ...previous, version: 3 };
    const findOne = vi.fn().mockResolvedValueOnce(previous).mockResolvedValueOnce(current).mockResolvedValueOnce(previous);
    const findOneAndUpdate = vi.fn().mockResolvedValue(previous);
    const connection = vi.spyOn(db, "authConnection").mockResolvedValue({ db: { collection: () => ({ findOne, findOneAndUpdate }) } } as never);
    const input = { title: "Example", html: "<p>Hello</p>", seoTitle: "Example", seoDescription: "Description", heroAlt: "Hero", thumbnailAlt: "Thumbnail", version: 2, category: "" };
    try {
      await updateArticle(id.toHexString(), { ...input, locale: "bg" }, [], id);
      expect(findOneAndUpdate.mock.calls[0][1].$set["locales.bg"].category).toBeUndefined();
      await expect(updateArticle(id.toHexString(), { ...input, locale: "en", subtitle: "English subtitle" }, [], id)).rejects.toMatchObject({ status: 400 });
      expect(findOneAndUpdate).toHaveBeenCalledTimes(1);
    } finally { connection.mockRestore(); }
  });
  it("pages through storage and deletes only aged, unreferenced article images", async () => {
    vi.stubEnv("BLOG_GCS_BUCKET", "blog-test");
    vi.stubEnv("BLOG_IMAGE_LIFECYCLE_WRITES", "true");
    const base = `blog/${id.toHexString()}`;
    const live = `${base}/inline-0/${"a".repeat(64)}-${"b".repeat(16)}.webp`;
    const orphan = `${base}/inline-1/${"c".repeat(64)}-${"d".repeat(16)}.webp`;
    const missing = `blog/507f1f77bcf86cd799439012/hero/${"e".repeat(64)}-${"f".repeat(16)}.webp`;
    const recent = `${base}/inline-2/${"1".repeat(64)}-${"2".repeat(16)}.webp`;
    const invalid = "blog/notes.txt";
    const oldTime = new Date(Date.now() - 60 * 60_000).toISOString();
    const getFiles = vi.fn(async (options: { pageToken?: string }) => options.pageToken
      ? [[{ name: missing, metadata: { timeCreated: oldTime } }, { name: recent, metadata: { timeCreated: new Date().toISOString() } }, { name: invalid, metadata: { timeCreated: oldTime } }], null]
      : [[{ name: live, metadata: { timeCreated: oldTime } }, { name: orphan, metadata: { timeCreated: oldTime } }], { pageToken: "next" }]);
    const remove = vi.fn().mockResolvedValue(undefined);
    const bucket = vi.spyOn(Storage.prototype, "bucket").mockReturnValue({ getFiles, file: vi.fn(() => ({ delete: remove })) } as never);
    const article = { _id: id, heroUrl: ownImage, thumbnailUrl: ownImage, locales: { bg: { html: `<p><img src="${ownImage}" alt="Live"></p>` } } };
    const connection = vi.spyOn(db, "authConnection").mockResolvedValue({ db: { collection: (name: string) => ({ find: () => ({ async *[Symbol.asyncIterator]() { if (name === appConfig.blog.collection) yield article; } }) }) } } as never);
    try {
      const audit = await auditBlogImages();
      expect(audit.candidates.map((candidate) => candidate.key)).toEqual([orphan, missing]);
      expect(audit.recent).toBe(1);
      expect(audit.invalidKeys).toEqual([invalid]);
      expect(audit.foreignReferences).toEqual([]);
      await expect(deleteAuditedImages("0".repeat(64))).rejects.toMatchObject({ status: 409 });
      expect(await deleteAuditedImages(audit.digest)).toEqual({ deleted: 2, failed: 0 });
      expect(remove).toHaveBeenCalledTimes(2);
      expect(getFiles).toHaveBeenCalledWith(expect.objectContaining({ prefix: "blog/", autoPaginate: false }));
    } finally { bucket.mockRestore(); connection.mockRestore(); }
  });
  it("removes the article after the first sweep and keeps a marker for the second", async () => {
    vi.stubEnv("BLOG_GCS_BUCKET", "blog-test");
    vi.stubEnv("BLOG_IMAGE_LIFECYCLE_WRITES", "true");
    vi.stubEnv("AUTH_MONGODB_URI", "mongodb://127.0.0.1");
    const events: string[] = [];
    const article = { _id: id, version: 1, state: "active", cleanupClaim: "" };
    let removed = false;
    let marker: { _id: ObjectId; dueAt: Date; cleanupClaim?: string } | null = null;
    const getFiles = vi.fn()
      .mockResolvedValueOnce([[{ name: `blog/${id.toHexString()}/hero/file.webp`, delete: vi.fn(async () => { events.push("gcs-delete"); }) }]])
      .mockResolvedValueOnce([[]])
      .mockResolvedValueOnce([[]]);
    const bucket = vi.spyOn(Storage.prototype, "bucket").mockReturnValue({ getFiles } as never);
    const collection = {
      createIndex: vi.fn().mockResolvedValue("index"),
      findOne: vi.fn(async () => removed ? null : article),
      find: vi.fn(() => ({ async *[Symbol.asyncIterator]() { /* No foreign references. */ }, toArray: async () => [] })),
      findOneAndUpdate: vi.fn(async (_filter: unknown, update: { $set: Record<string, unknown>; $inc?: Record<string, number> }) => {
        Object.assign(article, update.$set);
        if (update.$inc?.version) article.version += update.$inc.version;
        return { ...article };
      }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
      deleteOne: vi.fn(async () => { expect(marker).not.toBeNull(); events.push("mongo-delete"); removed = true; return { deletedCount: 1 }; }),
    };
    const markerCollection = {
      createIndex: vi.fn().mockResolvedValue("index"),
      findOne: vi.fn(async () => marker),
      find: vi.fn(() => ({ toArray: async () => marker ? [{ _id: id }] : [] })),
      updateOne: vi.fn(async (_filter: unknown, update: { $setOnInsert?: { _id: ObjectId; dueAt: Date } }) => { if (!marker && update.$setOnInsert) marker = { ...update.$setOnInsert }; return { matchedCount: 1 }; }),
      findOneAndUpdate: vi.fn(async (_filter: unknown, update: { $set: { cleanupClaim: string } }) => { if (!marker) return null; marker.cleanupClaim = update.$set.cleanupClaim; return { ...marker }; }),
      deleteOne: vi.fn(async () => { marker = null; events.push("marker-delete"); return { deletedCount: 1 }; }),
    };
    const connection = vi.spyOn(db, "authConnection").mockResolvedValue({ db: { collection: (name: string) => name === appConfig.blog.cleanupCollection ? markerCollection : collection } } as never);
    try {
      expect(await deleteArticle(id.toHexString(), 1)).toEqual({ complete: false, remaining: 0 });
      expect(removed).toBe(true);
      expect(marker).toMatchObject({ _id: id, dueAt: expect.any(Date) });
      expect(await deleteArticle(id.toHexString(), 1)).toEqual({ complete: false, remaining: 0 });
      marker!.dueAt = new Date(Date.now() - 1);
      removed = false;
      article.state = "active";
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      try { await processDueBlogCleanup(); } finally { error.mockRestore(); }
      expect(marker).not.toBeNull();
      expect(getFiles).toHaveBeenCalledTimes(2);
      removed = true;
      await processDueBlogCleanup();
      expect(await deleteArticle(id.toHexString(), 1)).toEqual({ complete: true, remaining: 0 });
      expect(events).toEqual(["gcs-delete", "mongo-delete", "marker-delete"]);
    } finally { bucket.mockRestore(); connection.mockRestore(); }
  });
  it("keeps a failed GCS deletion hidden and available for retry", async () => {
    vi.stubEnv("BLOG_GCS_BUCKET", "blog-test");
    vi.stubEnv("BLOG_IMAGE_LIFECYCLE_WRITES", "true");
    const article = { _id: id, version: 1, state: "active", cleanupClaim: "" };
    const bucket = vi.spyOn(Storage.prototype, "bucket").mockReturnValue({ getFiles: vi.fn().mockRejectedValue(new Error("storage unavailable")) } as never);
    const collection = {
      findOne: vi.fn(async () => article),
      find: vi.fn(() => ({ async *[Symbol.asyncIterator]() { /* No foreign references. */ } })),
      findOneAndUpdate: vi.fn(async (_filter: unknown, update: { $set: Record<string, unknown>; $inc?: { version?: number } }) => { Object.assign(article, update.$set); article.version += update.$inc?.version ?? 0; return { ...article }; }),
      updateOne: vi.fn().mockResolvedValue({ matchedCount: 1 }),
      deleteOne: vi.fn(),
    };
    const markerCollection = { updateOne: vi.fn() };
    const connection = vi.spyOn(db, "authConnection").mockResolvedValue({ db: { collection: (name: string) => name === appConfig.blog.cleanupCollection ? markerCollection : collection } } as never);
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await deleteArticle(id.toHexString(), 1)).toEqual({ complete: false, remaining: 0 });
      expect(article.state).toBe("deleting");
      expect(collection.deleteOne).not.toHaveBeenCalled();
      expect(markerCollection.updateOne).not.toHaveBeenCalled();
    } finally { error.mockRestore(); bucket.mockRestore(); connection.mockRestore(); }
  });
  it("does not start a legacy deletion if the migration guard cannot be stored", async () => {
    vi.stubEnv("BLOG_IMAGE_LIFECYCLE_WRITES", "true");
    const article = { _id: id, version: 1, state: "active", legacyId: id.toHexString() };
    const collection = {
      findOne: vi.fn(async () => article),
      find: vi.fn(() => ({ async *[Symbol.asyncIterator]() { /* No foreign references. */ } })),
      findOneAndUpdate: vi.fn(),
    };
    const control = { updateOne: vi.fn().mockResolvedValue({ matchedCount: 0 }) };
    const connection = vi.spyOn(db, "authConnection").mockResolvedValue({ db: { collection: (name: string) => name === "adminControl" ? control : collection } } as never);
    try {
      await expect(deleteArticle(id.toHexString(), 1)).rejects.toMatchObject({ status: 503 });
      expect(article.state).toBe("active");
      expect(collection.findOneAndUpdate).not.toHaveBeenCalled();
    } finally { connection.mockRestore(); }
  });
  it("blocks unrestricted legacy import after deletion and reuse of a cleanup marker", async () => {
    const collection = { createIndex: vi.fn().mockResolvedValue("index"), findOne: vi.fn().mockResolvedValue(null) };
    const markerCollection = { createIndex: vi.fn().mockResolvedValue("index"), findOne: vi.fn().mockResolvedValue({ _id: id }) };
    const control = { findOne: vi.fn().mockResolvedValue({ blogMigrationClosed: true }) };
    const connection = vi.spyOn(db, "authConnection").mockResolvedValue({ db: { collection: (name: string) => name === "adminControl" ? control : name === appConfig.blog.cleanupCollection ? markerCollection : collection } } as never);
    const raw = { _id: id } as LegacyArticle;
    try {
      await expect(importLegacyArticle(raw, id, [], "")).rejects.toMatchObject({ status: 409 });
      await expect(importLegacyArticle(raw, id, [], "", new Set([id.toHexString()]))).rejects.toMatchObject({ status: 409 });
      expect(markerCollection.findOne).toHaveBeenCalledTimes(1);
    } finally { connection.mockRestore(); }
  });
});

describe("blog storage monitor", () => {
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
  function monitorWith(getFiles: ReturnType<typeof vi.fn>) {
    vi.stubEnv("AUTH_MONGODB_URI", "mongodb://127.0.0.1");
    vi.stubEnv("BLOG_GCS_BUCKET", "blog-test");
    const bucket = vi.spyOn(Storage.prototype, "bucket").mockReturnValue({ getFiles } as never);
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    return { bucket, info, error };
  }
  const interval = appConfig.blog.storageCheckMilliseconds;
  const invalidGrant = Object.assign(new Error("expired"), { status: 400, response: { status: 400, data: { error: "invalid_grant" } } });

  it("logs readiness and failures only when the state changes", async () => {
    vi.useFakeTimers();
    const getFiles = vi.fn().mockResolvedValueOnce([[]]).mockResolvedValueOnce([[]]).mockRejectedValueOnce(invalidGrant).mockRejectedValueOnce(invalidGrant).mockResolvedValue([[]]);
    const { bucket, info, error } = monitorWith(getFiles);
    const stop = startBlogStorageMonitor();
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(bucket).toHaveBeenCalledWith("blog-test");
      expect(getFiles).toHaveBeenCalledWith({ prefix: "blog/", maxResults: 1, autoPaginate: false });
      expect(info).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(interval);
      expect(info).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(interval * 2);
      expect(error).toHaveBeenCalledTimes(1);
      expect(error).toHaveBeenCalledWith("Blog storage access failed", { context: "check", name: "Error", status: 400, reason: "invalid_grant" });
      await vi.advanceTimersByTimeAsync(interval);
      expect(info).toHaveBeenCalledTimes(2);
      expect(info).toHaveBeenLastCalledWith("Blog storage ready");
    } finally { stop(); }
  });
  it("checks that a listed image can actually be read", async () => {
    vi.useFakeTimers();
    const forbidden = Object.assign(new Error("denied"), { code: 403, errors: [{ reason: "forbidden" }] });
    const { error, info } = monitorWith(vi.fn().mockResolvedValue([[{ getMetadata: vi.fn().mockRejectedValue(forbidden) }]]));
    const stop = startBlogStorageMonitor();
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(info).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalledWith("Blog storage access failed", { context: "check", name: "Error", status: 403, reason: "forbidden" });
    } finally { stop(); }
  });
  it("reports a hung check, waits for it before checking again and ignores results after stop", async () => {
    vi.useFakeTimers();
    let finishHung!: () => void;
    let finishLast!: () => void;
    const getFiles = vi.fn()
      .mockReturnValueOnce(new Promise((resolve) => { finishHung = () => resolve([[]]); }))
      .mockReturnValueOnce(new Promise((resolve) => { finishLast = () => resolve([[]]); }));
    const { info, error } = monitorWith(getFiles);
    const stop = startBlogStorageMonitor();
    await vi.advanceTimersByTimeAsync(appConfig.blog.storageCheckTimeoutMilliseconds);
    expect(error).toHaveBeenCalledWith("Blog storage check failed", { context: "check", name: "Error", code: "TIMEOUT" });
    await vi.advanceTimersByTimeAsync(interval * 2);
    expect(getFiles).toHaveBeenCalledTimes(1);
    finishHung();
    await vi.advanceTimersByTimeAsync(interval);
    expect(getFiles).toHaveBeenCalledTimes(2);
    stop();
    finishLast();
    await vi.advanceTimersByTimeAsync(interval * 2);
    expect(info).not.toHaveBeenCalled();
    expect(getFiles).toHaveBeenCalledTimes(2);
  });
  it("reports missing bucket configuration only in a real environment", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const bucket = vi.spyOn(Storage.prototype, "bucket");
    vi.stubEnv("AUTH_MONGODB_URI", "");
    vi.stubEnv("BLOG_GCS_BUCKET", "");
    startBlogStorageMonitor()();
    expect(error).not.toHaveBeenCalled();
    vi.stubEnv("AUTH_MONGODB_URI", "mongodb://127.0.0.1");
    startBlogStorageMonitor()();
    expect(error).toHaveBeenCalledWith("Blog storage is not configured");
    expect(bucket).not.toHaveBeenCalled();
  });
});
