import { afterEach, describe, expect, it, vi } from "vitest";
import { ObjectId } from "mongodb";
import { BlogError, cleanHtml, resolveInlinePlaceholders } from "../../server/blog/service.js";

const id = new ObjectId("507f1f77bcf86cd799439011");
const ownImage = `https://storage.googleapis.com/blog-test/blog/${id.toHexString()}/inline-0/${"a".repeat(64)}-${"b".repeat(16)}.webp`;
afterEach(() => vi.unstubAllEnvs());

describe("blog HTML boundary", () => {
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
    for (const url of [ownImage.replace("blog-test", "another-bucket"), ownImage.replace(id.toHexString(), "507f1f77bcf86cd799439012"), `${ownImage}?token=1`, "https://example.com/photo.webp"]) {
      expect(() => cleanHtml(`<p>Text</p><img src="${url}" alt="Example">`, id)).toThrow(BlogError);
    }
    expect(() => cleanHtml(`<p>Text</p><img src="${ownImage}">`, id)).toThrow(BlogError);
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
