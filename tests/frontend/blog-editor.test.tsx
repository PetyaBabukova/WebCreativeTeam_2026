import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { ObjectId } from "mongodb";
import { renderToStaticMarkup } from "react-dom/server";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { cleanHtml } from "@/server/blog/service";
import { BlogIndex, BlogDetail } from "@/components/BlogContent";
import BlogAdminScreen from "@/components/BlogAdminScreen";
import { BlogDetailAdminActions } from "@/components/BlogMotion";
import { appConfig, blogHexColor, blogHighlightColor, blogLinkUrl, blogTextColor } from "@/lib/config";
import { blogEditorReturnUrl } from "@/lib/routing";
import type { Article } from "@/server/blog/service";

function sampleArticle(n: number): Article {
  const id = new ObjectId(`507f1f77bcf86cd7994390${n.toString().padStart(2, "0")}`);
  return { _id: id, slug: `example-${n}`, publishedAt: new Date("2026-10-29T12:00:00.000Z"), updatedAt: new Date("2026-10-29T12:00:00.000Z"), version: 1, createdBy: id, updatedBy: id, heroUrl: "/api/blog/images/hero.webp", thumbnailUrl: "/api/blog/images/thumb.webp", locales: { bg: { title: `Статия ${n}`, html: "<p>Съдържание.</p>", seoTitle: `Статия ${n}`, seoDescription: `Описание ${n}`, heroAlt: "Основно изображение", thumbnailAlt: "Миниатюра", updatedAt: new Date("2026-10-29T12:00:00.000Z") } } };
}

describe("public blog layout", () => {
  it("keeps the detail subtitle before the image in reading order", () => {
    const article = sampleArticle(5);
    const root = document.createElement("div");
    root.innerHTML = renderToStaticMarkup(<BlogDetail locale="bg" article={article} />);
    const header = root.querySelector(".blog-article__header");
    const hero = header?.querySelector(".blog-article__hero-row");
    expect(header?.querySelector("h1")?.compareDocumentPosition(hero!)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(Array.from(hero?.children ?? [], (child) => child.className)).toEqual(["blog-article__subtitle", "blog-article__visual"]);

    article.locales.bg.seoDescription = "";
    root.innerHTML = renderToStaticMarkup(<BlogDetail locale="bg" article={article} />);
    expect(root.querySelectorAll(".blog-article__hero-row > *")).toHaveLength(1);
    expect(root.querySelector(".blog-article__hero-row > .blog-article__visual")).not.toBeNull();
  });
  it("shows equal cards in supplied newest-first order with one link each", () => {
    const first = sampleArticle(1);
    first.locales.bg.category = "Брандинг";
    const html = renderToStaticMarkup(<BlogIndex locale="bg" rows={[first, sampleArticle(2), sampleArticle(3)]} page={1} pages={2} />);
    const root = document.createElement("div"); root.innerHTML = html;
    expect(root.querySelectorAll(".blog-card--featured")).toHaveLength(0);
    expect(root.querySelectorAll(".blog-page__grid .blog-card")).toHaveLength(3);
    expect(root.querySelectorAll(".blog-card > a.blog-card__link")).toHaveLength(3);
    expect(root.querySelector(".blog-card:first-child .blog-card__link")?.getAttribute("href")).toContain("example-1");
    expect(root.querySelectorAll(".blog-card__copy time")).toHaveLength(3);
    expect(root.querySelectorAll(".blog-card__action")).toHaveLength(0);
    expect(root.querySelector(".blog-card:first-child .blog-card__title")?.textContent).toBe("Статия 1");
    expect(root.querySelectorAll(".blog-page__grid .blog-card__copy h3")).toHaveLength(3);
    expect(root.querySelector(".blog-card:first-child .blog-card__category")?.textContent).toBe("Брандинг");
    expect(root.querySelectorAll(".blog-card__category")).toHaveLength(1);
    expect(root.querySelector(".blog-page__grid img")?.getAttribute("src")).toBe("/api/blog/images/thumb.webp");
    expect(root.querySelectorAll(".blog-card img[alt='']")).toHaveLength(3);
    expect(root.querySelectorAll(".blog-card img[loading='eager']")).toHaveLength(3);
    expect(root.querySelectorAll(".blog-card img[fetchpriority='high']")).toHaveLength(1);
    expect(root.querySelector(".blog-page__archive > h2")?.classList.contains("sr-only")).toBe(true);
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
  it("shows a category on its own language detail without falling back to Bulgarian on English", () => {
    const article = sampleArticle(3);
    article.locales.bg.category = "Брандинг";
    article.locales.en = { ...article.locales.bg, title: "Example", category: undefined };
    const bg = document.createElement("div"); bg.innerHTML = renderToStaticMarkup(<BlogDetail locale="bg" article={article} />);
    const en = document.createElement("div"); en.innerHTML = renderToStaticMarkup(<BlogDetail locale="en" article={article} />);
    expect(bg.querySelector(".blog-article__category")?.textContent).toBe("Брандинг");
    expect(en.querySelector(".blog-article__category")).toBeNull();
  });
  it("shows article actions only when the server has verified an administrator", () => {
    const article = sampleArticle(4);
    const publicHtml = renderToStaticMarkup(<BlogDetail locale="bg" article={article} />);
    const adminHtml = renderToStaticMarkup(<BlogDetail locale="bg" article={article} admin />);
    expect(publicHtml).not.toContain("blog-detail__admin");
    expect(adminHtml).toContain("Редактирай");
    expect(adminHtml).toContain("Изтрий");
    expect(adminHtml).toContain(`/admin/articles?edit=${article._id.toHexString()}&amp;lang=bg`);
  });
  it("retries a forbidden delete once and reports a version conflict", async () => {
    let deletes = 0;
    const request = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/csrf")) return Response.json({ csrf: "fresh-token" });
      if (init?.method === "DELETE") return new Response(null, { status: ++deletes === 1 ? 403 : 409 });
      throw new Error(`Unexpected request ${url}`);
    });
    vi.stubGlobal("fetch", request);
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      const { unmount } = render(<BlogDetailAdminActions locale="bg" id="507f1f77bcf86cd799439011" version={2} />);
      fireEvent.click(screen.getByRole("button", { name: "Изтрий" }));
      expect((await screen.findByRole("alert")).textContent).toContain("променена или изтрита");
      expect(deletes).toBe(2);
      expect(request.mock.calls.filter(([url]) => url.endsWith("/csrf"))).toHaveLength(2);
      unmount();
    } finally { confirm.mockRestore(); vi.unstubAllGlobals(); }
  });
});

describe("Quill article formats", () => {
  it("returns from editing to the existing detail or the public blog list", () => {
    expect(blogEditorReturnUrl("example", true, "en", "en")).toBe("/blog/example/en");
    expect(blogEditorReturnUrl("example", false, "en", "en")).toBe("/blog/example/bg");
    expect(blogEditorReturnUrl(null, false, "bg", "en")).toBe("/blog/en");
  });
  it("validates the shared color palette and safe link destinations", () => {
    expect(blogTextColor("rgb(23, 76, 56)")).toBe("#174c38");
    expect(blogTextColor("rgb(255, 0, 0)")).toBeNull();
    expect(blogTextColor("var(--color-green)")).toBe("var(--color-green)");
    expect(blogTextColor("var(--brand-orange)")).toBe("var(--brand-orange)");
    expect(blogTextColor("var(--brand-green)")).toBe("var(--brand-green)");
    expect(blogTextColor("var(--color-lime)")).toBe("var(--color-lime)");
    expect(blogTextColor("var(--brand-orange, red)")).toBeNull();
    expect(blogTextColor("var(--brand-orange) !important")).toBeNull();
    expect(blogTextColor("var(--BRAND-orange)")).toBeNull();
    expect(blogHexColor("rgb(255, 102, 0)")).toBe("#ff6600");
    expect(blogHexColor("rgb(300, 102, 0)")).toBeNull();
    expect(blogTextColor("var(--COLOR-green)")).toBeNull();
    expect(blogHighlightColor("var(--brand-orange)")).toBe("var(--brand-orange)");
    expect(blogHighlightColor("var(--color-green)")).toBeNull();
    expect(blogLinkUrl("https://example.com/path")).toBe("https://example.com/path");
    expect(blogLinkUrl("https://example.com/a b")).toBe("https://example.com/a%20b");
    expect(blogLinkUrl("mailto:team@example.com")).toBe("mailto:team@example.com");
    for (const url of ["/contacts", "/contacts/bg", "/blog/article/en?page=2#details", "/контакти"]) expect(blogLinkUrl(url)).toBe(url);
    for (const url of ["www.example.com", "tel:+359123", "javascript:alert(1)", "https://user:pass@example.com", "https://example.com/\u200bpath", "//evil.com", "/.//evil.com", "/%2e//evil.com", "/..//evil.com", "/blog/../..//evil.com", "/%2E%2E/x", "/a/%2F/b", "/.", "/%2f%2fevil.com", "/%5cevil.com", "/\\evil.com", "/foo bar", "/foo%0abar", "/bad%zz"]) expect(blogLinkUrl(url)).toBeNull();
  });
  it("keeps every editor token backed by a global six-digit color", () => {
    const css = readFileSync("styles/globals.css", "utf8");
    for (const { value } of [...appConfig.blog.globalTextColors, ...appConfig.blog.highlightColors]) {
      const name = value.slice(4, -1);
      const match = new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6});`).exec(css);
      expect(match, `${name} must resolve to a global hex color for paste mapping`).not.toBeNull();
    }
  });
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
  it("preserves palette colors on formatted text and links, but removes unsafe styles and URLs", () => {
    const id = new ObjectId("507f1f77bcf86cd799439011");
    const html = cleanHtml('<p><strong style="color: rgb(23, 76, 56)">Bold</strong> <em style="color: #174a87">Emphasis</em> <a href="https://example.com/" style="color: #8f2938">Link</a> <span style="color: red; background: url(javascript:alert(1))">Unsafe color</span> <a href="javascript:alert(1)">Unsafe link</a></p>', id);
    expect(html).toContain('color:rgb(23, 76, 56)');
    expect(html).toContain('color:#174a87');
    expect(html).toContain('color:#8f2938');
    expect(html).toContain('href="https://example.com/"');
    expect(html).not.toContain('javascript:');
    expect(html).not.toContain('background:');
    expect(html).not.toContain('color:red');
  });
  it("round trips colored bold and linked text through Quill and the sanitizer", async () => {
    const { default: Quill } = await import("quill");
    const first = document.createElement("div");
    const second = document.createElement("div");
    document.body.append(first, second);
    const editor = new Quill(first);
    editor.setContents([
      { insert: "Bold", attributes: { bold: true, color: "#174c38" } },
      { insert: " " },
      { insert: "Link", attributes: { link: "https://example.com/", color: "#174a87" } },
      { insert: "\n" },
    ]);
    const saved = cleanHtml(editor.getSemanticHTML(), new ObjectId("507f1f77bcf86cd799439011"));
    const reopened = new Quill(second);
    reopened.clipboard.dangerouslyPasteHTML(saved);
    expect(reopened.getFormat(0, 4).color).toBe("#174c38");
    expect(reopened.getFormat(5, 4).link).toBe("https://example.com/");
    expect(reopened.getFormat(5, 4).color).toBe("#174a87");
    first.remove(); second.remove();
  });
  it("keeps global text and highlight tokens on bold text and links", async () => {
    const { default: Quill } = await import("quill");
    const first = document.createElement("div");
    const second = document.createElement("div");
    document.body.append(first, second);
    const editor = new Quill(first);
    editor.setContents([
      { insert: "Bold", attributes: { bold: true, color: "var(--brand-orange)" } },
      { insert: " " },
      { insert: "Link", attributes: { link: "https://example.com/", color: "var(--brand-green)", background: "var(--color-lime)" } },
      { insert: "\n" },
    ]);
    const saved = cleanHtml(editor.getSemanticHTML(), new ObjectId("507f1f77bcf86cd799439011"));
    expect(saved).toContain("var(--brand-orange)");
    expect(saved).toContain("var(--brand-green)");
    expect(saved).toContain("var(--color-lime)");
    expect(saved).toContain('href="https://example.com/"');
    const reopened = new Quill(second);
    reopened.clipboard.dangerouslyPasteHTML(saved);
    expect(reopened.getFormat(0, 4)).toMatchObject({ color: "var(--brand-orange)", bold: true });
    expect(reopened.getFormat(5, 4)).toMatchObject({ link: "https://example.com/", color: "var(--brand-green)", background: "var(--color-lime)" });
    first.remove(); second.remove();
  });
  it("rejects unsupported CSS tokens and properties during sanitization", () => {
    const saved = cleanHtml('<p><span style="color: var(--COLOR-green); background-color: var(--unknown); position: fixed">Unsafe</span> <span style="color: var(--brand-orange, red)">Fallback</span> <span style="color: var(--brand-orange) !important">Important</span> <a href="https://example.com" style="color: var(--brand-orange); background-color: var(--brand-green); position: fixed">Safe</a> <a href="javascript:alert(1)" style="color: var(--brand-orange)">Invalid colored link</a></p>', new ObjectId("507f1f77bcf86cd799439011"));
    expect(saved).not.toContain("--COLOR-green");
    expect(saved).not.toContain("--unknown");
    expect(saved).not.toContain("--brand-orange, red");
    expect(saved).not.toContain("!important");
    expect(saved).not.toContain("position:");
    expect(saved).toContain("var(--brand-orange)");
    expect(saved).toContain("var(--brand-green)");
    expect(saved).toContain('<span style="color:var(--brand-orange)">Invalid colored link</span>');
  });
  it("keeps a Quill link through export and server sanitization", async () => {
    const { default: Quill } = await import("quill");
    const host = document.createElement("div");
    document.body.append(host);
    const editor = new Quill(host);
    editor.insertText(0, "Example", { link: "https://example.com/" });
    const saved = cleanHtml(editor.getSemanticHTML(), new ObjectId("507f1f77bcf86cd799439011"));
    expect(saved).toContain('href="https://example.com/"');
    expect(saved).toContain('rel="noopener noreferrer"');
    host.remove();
  });
  it("applies a link without submitting the outer article form", async () => {
    const { default: Quill } = await import("quill");
    const request = vi.fn(async (url: string, init?: RequestInit) => {
      if (!url.endsWith("/admin") || init?.method) throw new Error(`Unexpected request ${url}`);
      return new Response(JSON.stringify({ articles: [] }), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    vi.stubGlobal("fetch", request);
    vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
    try {
      const { container, unmount } = render(<BlogAdminScreen locale="bg" base="/admin" csrf="test" />);
      await waitFor(() => expect(container.querySelector(".ql-link")).not.toBeNull());
      const linkButton = container.querySelector(".ql-link");
      expect(linkButton).toHaveAttribute("aria-label", "Добави или редактирай линк");
      const hintId = linkButton?.getAttribute("aria-describedby");
      expect(hintId).toBeTruthy();
      expect(document.getElementById(hintId!)).toHaveTextContent(/За линк маркирайте текст или поставете курсора/);
      expect(screen.getByRole("button", { name: "Отказ от редакцията" })).toHaveAttribute("type", "button");
      expect(container.querySelector('.ql-color .ql-picker-item[data-value="var(--brand-orange)"]')).toHaveAttribute("aria-label", "Бранд оранжево");
      expect(container.querySelector('.ql-background .ql-picker-item[data-value="var(--brand-orange)"]')).toHaveAttribute("aria-label", "Маркиране: Бранд оранжево");
      expect(screen.getByText(/Ярките цветове може да са трудно четими/)).not.toBeNull();
      fireEvent.click(linkButton!);
      expect(container.querySelectorAll("form")).toHaveLength(1);
      fireEvent.change(screen.getByLabelText("Текст на линка"), { target: { value: "Example" } });
      const address = screen.getByLabelText("Адрес на линка");
      expect(address).toHaveAttribute("aria-describedby", hintId);
      fireEvent.change(address, { target: { value: "//evil.com" } });
      fireEvent.click(screen.getByRole("button", { name: "Добави линк" }));
      const error = screen.getByRole("alert");
      expect(error).toHaveTextContent("/contacts");
      expect(address.getAttribute("aria-describedby")?.split(" ")).toEqual([hintId, error.id]);
      fireEvent.change(address, { target: { value: "/contacts" } });
      fireEvent.click(screen.getByRole("button", { name: "Добави линк" }));
      expect(container.querySelector('.ql-editor a[href="/contacts"]')?.textContent).toBe("Example");
      const editor = Quill.find(container.querySelector(".ql-container")!);
      if (!(editor instanceof Quill)) throw new Error("Editor did not initialize");
      expect(editor.getContents().ops.some((op) => op.attributes?.link === "/contacts")).toBe(true);
      const saved = cleanHtml(editor.getSemanticHTML(), new ObjectId("507f1f77bcf86cd799439011"));
      expect(saved).toContain('href="/contacts"');
      expect(saved).not.toContain('target="_blank"');
      editor.setText("", "silent");
      editor.clipboard.dangerouslyPasteHTML(saved, "silent");
      expect(editor.getContents().ops.some((op) => op.attributes?.link === "/contacts")).toBe(true);
      expect(cleanHtml(editor.getSemanticHTML(), new ObjectId("507f1f77bcf86cd799439011"))).toBe(saved);
      expect(request.mock.calls.every(([, init]) => !init?.method)).toBe(true);
      unmount();
    } finally { vi.unstubAllGlobals(); }
  });
  it("applies brand orange from the text picker in both editor languages", async () => {
    const { default: Quill } = await import("quill");
    const originalBounds = Range.prototype.getBoundingClientRect;
    Range.prototype.getBoundingClientRect = () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 } as DOMRect);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ articles: [] })));
    vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
    try {
      for (const locale of ["bg", "en"] as const) {
        const { container, unmount } = render(<BlogAdminScreen locale={locale} base="/admin" csrf="test" />);
        try {
          await waitFor(() => expect(container.querySelector(".ql-container")).not.toBeNull());
          const quill = Quill.find(container.querySelector(".ql-container")!);
          if (!(quill instanceof Quill)) throw new Error("Editor did not initialize");
          const linkButton = container.querySelector(".ql-link");
          expect(linkButton).toHaveAttribute("aria-label", locale === "bg" ? "Добави или редактирай линк" : "Add or edit link");
          expect(document.getElementById(linkButton?.getAttribute("aria-describedby") ?? "")).toHaveTextContent(locale === "bg" ? "Не пишете HTML тагове." : "Do not type HTML tags.");
          const swatch = container.querySelector<HTMLElement>('.ql-color .ql-picker-item[data-value="var(--brand-orange)"]');
          expect(swatch).toHaveAttribute("aria-label", locale === "bg" ? "Бранд оранжево" : "Brand orange");
          quill.insertText(0, "Orange", "user");
          quill.setSelection(0, 6, "silent");
          fireEvent.click(swatch!);
          expect(quill.getFormat(0, 6).color).toBe("var(--brand-orange)");
          expect(swatch).toHaveClass("ql-selected");
          quill.removeFormat(0, 6, "user");
          expect(quill.getFormat(0, 6).color).toBeUndefined();
        } finally { unmount(); }
      }
    } finally { Range.prototype.getBoundingClientRect = originalBounds; vi.unstubAllGlobals(); }
  });
  it("filters pasted colors and links through the editor matcher", async () => {
    const { default: Quill } = await import("quill");
    document.documentElement.style.setProperty("--brand-orange", "#ff6600");
    const request = vi.fn(async () => Response.json({ articles: [] }));
    vi.stubGlobal("fetch", request);
    vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
    try {
      const { container, unmount } = render(<BlogAdminScreen locale="bg" base="/admin" csrf="test" />);
      await waitFor(() => expect(container.querySelector(".ql-container")).not.toBeNull());
      const quill = Quill.find(container.querySelector(".ql-container")!);
      if (!(quill instanceof Quill)) throw new Error("Editor did not initialize");
      const delta = quill.clipboard.convert({ html: '<p><span style="color: var(--color-green); background-color: var(--brand-orange)">Allowed</span> <span style="color: rgb(255, 102, 0)">Orange RGB</span> <span style="color: #ff6600">Orange hex</span> <span style="background-color: rgb(255, 102, 0)">Orange highlight</span> <span style="color: var(--unknown); background-color: var(--unknown)">Unknown</span> <a href="javascript:alert(1)">Unsafe link</a></p>', text: "" });
      const allowed = delta.ops.find((op) => op.insert === "Allowed");
      const unknown = delta.ops.find((op) => op.insert === "Unknown");
      const unsafe = delta.ops.find((op) => op.insert === "Unsafe link");
      expect(allowed?.attributes).toMatchObject({ color: "var(--color-green)", background: "var(--brand-orange)" });
      expect(delta.ops.find((op) => op.insert === "Orange RGB")?.attributes?.color).toBe("var(--brand-orange)");
      expect(delta.ops.find((op) => op.insert === "Orange hex")?.attributes?.color).toBe("var(--brand-orange)");
      expect(delta.ops.find((op) => op.insert === "Orange highlight")?.attributes?.background).toBe("var(--brand-orange)");
      expect(unknown?.attributes?.color).toBeUndefined();
      expect(unknown?.attributes?.background).toBeUndefined();
      expect(unsafe?.attributes?.link).toBeUndefined();
      unmount();
    } finally { document.documentElement.style.removeProperty("--brand-orange"); vi.unstubAllGlobals(); }
  });
  it("opens the first English translation from the administrator list", async () => {
    const article = sampleArticle(5);
    const row = { ...article, _id: article._id.toHexString() };
    const request = vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("/admin") ? { articles: [row] } : { article: row }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", request);
    vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
    try {
      const { unmount } = render(<BlogAdminScreen locale="bg" base="/admin" csrf="test" />);
      fireEvent.click(await screen.findByRole("button", { name: "Превод на Статия 5" }));
      expect(await screen.findByRole("heading", { name: "Английски превод" })).not.toBeNull();
      expect((screen.getByLabelText("Заглавие") as HTMLInputElement).value).toBe("");
      unmount();
    } finally { vi.unstubAllGlobals(); }
  });
  it("sends the edited category and keeps the logo linked to the localized home page", async () => {
    const article = sampleArticle(5);
    const row = { ...article, _id: article._id.toHexString() };
    const request = vi.fn(async (url: string, init?: RequestInit) => init?.method === "PUT"
      ? new Response(null, { status: 409 })
      : Response.json(url.endsWith("/admin") ? { articles: [row] } : { article: row }));
    vi.stubGlobal("fetch", request);
    vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
    try {
      const { container, unmount } = render(<BlogAdminScreen locale="bg" base="/admin" csrf="test" />);
      expect(container.querySelector(".auth-header a")?.getAttribute("href")).toBe("/bg");
      expect(container.querySelector(".auth-header a")?.getAttribute("aria-label")).toContain("начало");
      fireEvent.click(await screen.findByRole("button", { name: "Редактирай Статия 5" }));
      const category = await screen.findByLabelText("Категория");
      fireEvent.change(category, { target: { value: "Брандинг" } });
      fireEvent.submit(container.querySelector("form")!);
      await waitFor(() => expect(request.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(true));
      const submitted = request.mock.calls.find(([, init]) => init?.method === "PUT")?.[1]?.body as FormData;
      expect(submitted.get("category")).toBe("Брандинг");
      unmount();
    } finally { vi.unstubAllGlobals(); }
  });
  it("uses one confirmation while refreshing CSRF for a pending admin deletion", async () => {
    const article = sampleArticle(6);
    const row = { ...article, _id: article._id.toHexString() };
    let deletes = 0;
    const request = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "DELETE") return ++deletes === 1 ? new Response(null, { status: 403 }) : Response.json({ state: "deleting", remainingCount: 0 }, { status: 202 });
      if (url.endsWith("/csrf")) return Response.json({ csrf: "fresh" });
      return url.endsWith("/admin") ? Response.json({ articles: [row] }) : Response.json({ article: row });
    });
    vi.stubGlobal("fetch", request);
    vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      const { unmount } = render(<BlogAdminScreen locale="bg" base="/admin" csrf="test" />);
      fireEvent.click(await screen.findByRole("button", { name: "Редактирай Статия 6" }));
      fireEvent.click(await screen.findByRole("button", { name: "Изтрий статията" }));
      await waitFor(() => expect(deletes).toBe(2));
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(request.mock.calls.filter(([, init]) => init?.method === "DELETE").map(([, init]) => (init?.headers as Record<string, string>)["x-csrf-token"])).toEqual(["test", "fresh"]);
      expect(screen.queryByRole("button", { name: "Повтори изтриването" })).toBeNull();
      unmount();
    } finally { confirm.mockRestore(); vi.unstubAllGlobals(); }
  });
  it("deletes the selected admin-list row without opening it and refreshes after a conflict", async () => {
    const first = sampleArticle(8);
    const second = { ...sampleArticle(9), version: 3 };
    const rows = [first, second].map((item) => ({ ...item, _id: item._id.toHexString() }));
    const request = vi.fn(async (url: string, init?: RequestInit) => init?.method === "DELETE"
      ? new Response(null, { status: 409 })
      : Response.json({ articles: rows }));
    vi.stubGlobal("fetch", request);
    vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      const { unmount } = render(<BlogAdminScreen locale="bg" base="/admin" csrf="test" />);
      fireEvent.click(await screen.findByRole("button", { name: "Изтрий Статия 9" }));
      expect((await screen.findByRole("alert")).textContent).toContain("Списъкът е обновен");
      const deletion = request.mock.calls.find(([, init]) => init?.method === "DELETE");
      expect(deletion?.[0]).toContain(second._id.toHexString());
      expect(JSON.parse(String(deletion?.[1]?.body))).toEqual({ version: 3 });
      expect(confirm).toHaveBeenCalledTimes(1);
      expect(confirm.mock.calls[0][0]).toContain("Статия 9");
      expect(request.mock.calls.filter(([url, init]) => url.endsWith("/admin") && init?.method !== "DELETE")).toHaveLength(2);
      unmount();
    } finally { confirm.mockRestore(); vi.unstubAllGlobals(); }
  });
  it("reports an expired session when CSRF refresh returns 401 during list deletion", async () => {
    const article = sampleArticle(8);
    const row = { ...article, _id: article._id.toHexString() };
    const request = vi.fn(async (url: string, init?: RequestInit) => init?.method === "DELETE"
      ? new Response(null, { status: 403 })
      : url.endsWith("/csrf") ? new Response(null, { status: 401 }) : Response.json({ articles: [row] }));
    vi.stubGlobal("fetch", request);
    vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(true);
    try {
      const { unmount } = render(<BlogAdminScreen locale="bg" base="/admin" csrf="test" />);
      fireEvent.click(await screen.findByRole("button", { name: "Изтрий Статия 8" }));
      expect((await screen.findByRole("alert")).textContent).toContain("Сесията е изтекла");
      expect(request.mock.calls.filter(([, init]) => init?.method === "DELETE")).toHaveLength(1);
      expect(confirm).toHaveBeenCalledTimes(1);
      unmount();
    } finally { confirm.mockRestore(); vi.unstubAllGlobals(); }
  });
  it("retries image cleanup without deleting an active article", async () => {
    const article = sampleArticle(7);
    const row = { ...article, _id: article._id.toHexString(), pendingImageCleanup: ["unused.webp"] };
    const request = vi.fn(async (_url: string, init?: RequestInit) => init?.method === "POST"
      ? Response.json({ complete: true, remainingCount: 0 })
      : Response.json({ articles: [row] }));
    vi.stubGlobal("fetch", request);
    vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} });
    try {
      const { unmount } = render(<BlogAdminScreen locale="bg" base="/admin" csrf="test" />);
      fireEvent.click(await screen.findByRole("button", { name: "Повтори почистването" }));
      expect((await screen.findByRole("status")).textContent).toContain("Старите снимки са изтрити");
      expect(request.mock.calls.some(([url, init]) => url.endsWith("/cleanup") && init?.method === "POST")).toBe(true);
      unmount();
    } finally { vi.unstubAllGlobals(); }
  });
});
