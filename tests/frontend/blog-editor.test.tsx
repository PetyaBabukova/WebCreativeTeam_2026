import { describe, expect, it } from "vitest";
import { ObjectId } from "mongodb";
import { cleanHtml } from "@/server/blog/service";

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
