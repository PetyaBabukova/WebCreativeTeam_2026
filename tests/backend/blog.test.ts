import { afterEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { Storage } from "@google-cloud/storage";
import { appConfig } from "../../lib/config.js";
import { BlogError, bucketName, cleanHtml, normalizeSubtitle, objectKey, resolveInlinePlaceholders, startBlogStorageMonitor, storageAccessFailure, storageErrorInfo } from "../../server/blog/service.js";

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
  it("keeps permitted formatting while stripping scripts and unsafe links", () => {
    vi.stubEnv("BLOG_GCS_BUCKET", "blog-test");
    const html = cleanHtml('<h2>Hello</h2><script>alert(1)</script><p><a href="javascript:alert(1)" onclick="alert(2)">link</a></p>', id);
    expect(html).toContain("<h2>Hello</h2>");
    expect(html).not.toMatch(/script|onclick|javascript|alert/);
    expect(html).toContain("link");
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
