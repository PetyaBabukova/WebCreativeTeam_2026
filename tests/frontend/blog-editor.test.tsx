import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanHtml } from "@/server/blog/service";
import { BlogIndex, BlogDetail } from "@/components/BlogContent";
import type { Article } from "@/server/blog/service";

function sampleArticle(n: number): Article {
  const id = new ObjectId(`507f1f77bcf86cd7994390${n.toString().padStart(2, "0")}`);
  return { _id: id, slug: `example-${n}`, publishedAt: new Date("2026-10-29T12:00:00.000Z"), updatedAt: new Date("2026-10-29T12:00:00.000Z"), version: 1, createdBy: id, updatedBy: id, heroUrl: "/api/blog/images/hero.webp", thumbnailUrl: "/api/blog/images/thumb.webp", locales: { bg: { title: `Статия ${n}`, html: "<p>Съдържание.</p>", seoTitle: `Статия ${n}`, seoDescription: `Описание ${n}`, heroAlt: "Основно изображение", thumbnailAlt: "Миниатюра", updatedAt: new Date("2026-10-29T12:00:00.000Z") } } };
}

describe("public blog layout", () => {
  it("uses one featured article on page one and one link per card", () => {
    const html = renderToStaticMarkup(<BlogIndex locale="bg" rows={[sampleArticle(1), sampleArticle(2), sampleArticle(3)]} page={1} pages={2} />);
    const root = document.createElement("div"); root.innerHTML = html;
    expect(root.querySelectorAll(".blog-card--featured")).toHaveLength(1);
    expect(root.querySelectorAll(".blog-page__grid .blog-card")).toHaveLength(2);
    expect(root.querySelectorAll(".blog-card > a.blog-card__link")).toHaveLength(3);
    expect(root.querySelector(".blog-card--featured .blog-card__link")?.getAttribute("href")).toContain("example-1");
    expect(root.querySelectorAll(".blog-card__visual time")).toHaveLength(3);
    expect(root.querySelectorAll(".blog-card__action")).toHaveLength(0);
    expect(root.querySelector(".blog-card--featured .blog-card__visual h2")?.textContent).toBe("Статия 1");
    expect(root.querySelectorAll(".blog-page__grid .blog-card__visual h3")).toHaveLength(2);
    expect(root.querySelector(".blog-card--featured img")?.getAttribute("src")).toBe("/api/blog/images/hero.webp");
    expect(root.querySelector(".blog-page__grid img")?.getAttribute("src")).toBe("/api/blog/images/thumb.webp");
    expect(root.querySelectorAll(".blog-card img[alt='']")).toHaveLength(3);
    expect(root.querySelectorAll(".blog-card__hover-label")).toHaveLength(0);
  });
  it("shows all page-two cards equally and uses legacy subtitle fallback on detail", () => {
    const nextPage = renderToStaticMarkup(<BlogIndex locale="bg" rows={[sampleArticle(3)]} page={2} pages={2} />);
    const detail = renderToStaticMarkup(<BlogDetail locale="bg" article={sampleArticle(3)} />);
    expect(nextPage).not.toContain("blog-card--featured");
    expect(nextPage).toContain("Статия 3");
    expect(detail).toContain("Описание 3");
    expect(detail).toContain('src="/api/blog/images/hero.webp"');
    expect(detail).toContain('alt="Основно изображение"');
  });
});

describe("Quill article formats", () => {
  it("exports bullet lists and code blocks as semantic HTML", async () => {
    const { default: Quill } = await import("quill");
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new Quill(host);
    editor.setContents([
      { insert: "Bullet" }, { insert: "\n", attributes: { list: "bullet" } },
      { insert: "Code" }, { insert: "\n", attributes: { "code-block": true } },
    ]);
    const html = editor.getSemanticHTML();
    expect(html).toContain("<ul>");
    expect(html).toContain("<pre");
    const saved = cleanHtml(html, new ObjectId("507f1f77bcf86cd799439011"));
    expect(saved).toContain("<ul>");
    expect(saved).toContain("<pre");
    host.remove();
  });
  it("keeps image alt text when exporting HTML", async () => {
    const { default: Quill } = await import("quill");
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new Quill(host);
    editor.insertText(0, "Image: ");
    editor.insertEmbed(7, "image", "https://example.test/image.webp");
    const image = editor.root.querySelector("img");
    expect(image).not.toBeNull();
    image!.alt = "Article illustration";
    expect(editor.getSemanticHTML()).toContain('alt="Article illustration"');
    host.remove();
  });
});
