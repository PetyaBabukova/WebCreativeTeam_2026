"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type Quill from "quill";
import { appConfig, type Locale } from "@/lib/config";
import { blogArticleUrl } from "@/lib/routing";
import "quill/dist/quill.snow.css";

type TextFields = { title: string; html: string; seoTitle: string; seoDescription: string; heroAlt: string; thumbnailAlt: string; updatedAt?: string };
type Article = { _id: string; slug: string; version: number; heroUrl: string; thumbnailUrl: string; locales: { bg: TextFields; en?: TextFields } };
type ArticleRow = Pick<Article, "_id" | "slug" | "version" | "locales">;
type PendingImage = { name: string; file: File; preview: string };
let localImageRegistered = false;

function RichEditor({ initial, onChange, onImage, allowImage }: { initial: string; onChange: (html: string) => void; onImage: (file: File, preview: string) => void; allowImage: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<Quill | null>(null);
  const onChangeRef = useRef(onChange);
  const onImageRef = useRef(onImage);
  onChangeRef.current = onChange; onImageRef.current = onImage;
  useEffect(() => {
    let active = true;
    void import("quill").then(({ default: QuillClass }) => {
      if (!active || !host.current) return;
      if (!localImageRegistered) {
        const ImageFormat = QuillClass.import("formats/image") as typeof import("quill/formats/image").default;
        class LocalImage extends ImageFormat { static sanitize(url: string) { return url.startsWith("blob:") ? url : super.sanitize(url); } }
        QuillClass.register(LocalImage, true);
        localImageRegistered = true;
      }
      const element = document.createElement("div");
      host.current.append(element);
      const quill = new QuillClass(element, {
        theme: "snow", modules: {
          toolbar: [[{ header: [2, 3, 4, false] }], ["bold", "italic", "underline", "strike"], [{ list: "ordered" }, { list: "bullet" }], ["blockquote", "code-block", "link", ...(allowImage ? ["image"] : [])], [{ align: [] }], ["clean"]],
          uploader: { handler: () => {} },
        },
      });
      editor.current = quill;
      if (initial) quill.clipboard.dangerouslyPasteHTML(initial, "silent");
      const pasteGuard = (event: ClipboardEvent) => {
        const clipboard = event.clipboardData;
        if (!clipboard) return;
        const html = clipboard.getData("text/html");
        const plain = clipboard.getData("text/plain");
        if (/<img\b[^>]*src\s*=\s*["']?data:/i.test(html)) {
          event.preventDefault();
          if (plain) quill.insertText(quill.getSelection(true)?.index ?? quill.getLength() - 1, plain, "user");
        } else if (clipboard.files.length && !html && !plain) event.preventDefault();
      };
      quill.root.addEventListener("paste", pasteGuard, true);
      quill.on("text-change", () => onChangeRef.current(quill.getSemanticHTML()));
      const toolbar = quill.getModule("toolbar") as { addHandler: (name: string, handler: () => void) => void };
      toolbar.addHandler("image", () => {
        if (!allowImage) return;
        const picker = document.createElement("input");
        picker.type = "file"; picker.accept = "image/jpeg,image/png,image/webp";
        picker.onchange = () => {
          const file = picker.files?.[0];
          if (!file || file.size > appConfig.blog.maxFileBytes) return;
          const alt = window.prompt("Alt text / Описание на изображението");
          if (!alt?.trim()) return;
          const preview = URL.createObjectURL(file);
          const range = quill.getSelection(true);
          quill.insertEmbed(range?.index ?? quill.getLength() - 1, "image", preview, "user");
          const image = [...quill.root.querySelectorAll("img")].find((node) => node.src === preview);
          if (image) image.alt = alt.trim().slice(0, 180);
          onImageRef.current(file, preview);
          onChangeRef.current(quill.getSemanticHTML());
        };
        picker.click();
      });
      onChangeRef.current(quill.getSemanticHTML());
    });
    return () => { active = false; editor.current = null; host.current?.replaceChildren(); };
  }, []);
  return <div ref={host} aria-label="Article content" />;
}

const blank: TextFields = { title: "", html: "", seoTitle: "", seoDescription: "", heroAlt: "", thumbnailAlt: "" };
export default function BlogAdminScreen({ locale, base, csrf }: { locale: Locale; base: string; csrf: string }) {
  const bg = locale === "bg";
  const [rows, setRows] = useState<ArticleRow[]>([]);
  const [article, setArticle] = useState<Article | null>(null);
  const [language, setLanguage] = useState<Locale>("bg");
  const [form, setForm] = useState<TextFields>(blank);
  const [editorKey, setEditorKey] = useState(0);
  const [pending, setPending] = useState<PendingImage[]>([]);
  const pendingRef = useRef<PendingImage[]>([]);
  pendingRef.current = pending;
  const [hero, setHero] = useState<File | null>(null);
  const [thumbnail, setThumbnail] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState(false);
  const createKey = useRef(crypto.randomUUID());
  const csrfRef = useRef(csrf);
  useEffect(() => () => { for (const item of pendingRef.current) URL.revokeObjectURL(item.preview); }, []);
  const list = useCallback(async () => {
    const response = await fetch(`${appConfig.paths.blogApi}/admin`, { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) throw new Error("List failed");
    setRows((await response.json()).articles);
  }, []);
  useEffect(() => { void list().catch(() => { setError(true); setNotice(bg ? "Статиите не се заредиха." : "Articles could not load."); }); }, [list, bg]);
  function field(name: keyof TextFields, value: string) { setForm((current) => ({ ...current, [name]: value })); }
  function start(articleValue: Article | null, selected: Locale = "bg") {
    for (const item of pending) URL.revokeObjectURL(item.preview);
    setArticle(articleValue); setLanguage(selected); setPending([]); setHero(null); setThumbnail(null); setNotice("");
    setForm(articleValue ? { ...(articleValue.locales[selected] ?? { ...articleValue.locales.bg, title: "", seoTitle: "", seoDescription: "" }) } : { ...blank });
    setEditorKey((key) => key + 1);
    if (!articleValue) createKey.current = crypto.randomUUID();
  }
  async function open(id: string, selected: Locale = "bg") {
    setBusy(true);
    try {
      const response = await fetch(`${appConfig.paths.blogApi}/admin/${id}`, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("Load failed");
      start((await response.json()).article, selected);
    } catch { setError(true); setNotice(bg ? "Статията не се зареди." : "Article could not load."); }
    finally { setBusy(false); }
  }
  function addImage(file: File, preview: string) { setPending((items) => [...items, { name: `inline-${items.length}`, file, preview }]); }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setNotice("");
    try {
      const body = new FormData();
      for (const key of ["title", "seoTitle", "seoDescription", "heroAlt", "thumbnailAlt"] as const) body.set(key, form[key]);
      let html = form.html;
      for (const item of pending) if (html.includes(`src="${item.preview}"`)) { html = html.replaceAll(`src="${item.preview}"`, `src="pending:${item.name}"`); body.append(item.name, item.file); }
      body.set("html", html); body.set("locale", language);
      if (article) body.set("version", String(article.version)); else body.set("createKey", createKey.current);
      if (language === "bg") { if (hero) body.set("hero", hero); if (thumbnail) body.set("thumbnail", thumbnail); }
      const path = `${appConfig.paths.blogApi}/admin${article ? `/${article._id}` : ""}`;
      let response = await fetch(path, { method: article ? "PUT" : "POST", credentials: "same-origin", headers: { "x-csrf-token": csrfRef.current }, body });
      if (response.status === 403) {
        const refreshed = await fetch(`${appConfig.paths.authApi}/csrf`, { credentials: "same-origin", cache: "no-store" });
        if (refreshed.ok) { csrfRef.current = (await refreshed.json()).csrf; response = await fetch(path, { method: article ? "PUT" : "POST", credentials: "same-origin", headers: { "x-csrf-token": csrfRef.current }, body }); }
      }
      if (!response.ok) throw new Error(String(response.status));
      const saved = (await response.json()).article as Article;
      start(saved, language);
      await list();
      setError(false); setNotice(bg ? "Статията е запазена." : "Article saved.");
    } catch (cause) { setError(true); setNotice(String(cause) === "Error: 409" ? (bg ? "Статията е променена другаде. Заредете я отново." : "Article changed elsewhere. Reload it.") : (bg ? "Записът не успя. Проверете полетата и опитайте отново." : "Save failed. Check the fields and try again.")); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!article || busy || !window.confirm(bg ? "Да изтрия ли статията окончателно?" : "Delete this article permanently?")) return;
    setBusy(true);
    try {
      const response = await fetch(`${appConfig.paths.blogApi}/admin/${article._id}`, { method: "DELETE", credentials: "same-origin", headers: { "Content-Type": "application/json", "x-csrf-token": csrfRef.current }, body: JSON.stringify({ version: article.version }) });
      if (!response.ok) throw new Error("Delete failed");
      start(null); await list(); setError(false); setNotice(bg ? "Статията е изтрита." : "Article deleted.");
    } catch { setError(true); setNotice(bg ? "Изтриването не успя." : "Delete failed."); }
    finally { setBusy(false); }
  }
  return <div className="auth-page"><header className="auth-header"><div className="container auth-header__inner"><Link href={base}>WebCreativeTeam</Link><Link href={base}>{bg ? "Администрация" : "Administration"}</Link></div></header>
    <main className="container auth-main" id="main"><div className="auth-panel"><h1>{bg ? "Статии" : "Articles"}</h1>
      {notice && <p className={error ? "form-message" : "form-message form-message--success"} role={error ? "alert" : "status"}>{notice}</p>}
      <button type="button" className="button button--outline" onClick={() => start(null)} disabled={busy}>{bg ? "Нова статия" : "New article"}</button>
      <ul className="auth-list">{rows.map((row) => <li key={row._id}><span>{row.locales.bg.title} {row.locales.en ? "· EN" : "· BG"}</span><span><button type="button" onClick={() => void open(row._id)} disabled={busy}>{bg ? "Редактирай" : "Edit"}</button> <button type="button" onClick={() => void open(row._id, "en")} disabled={busy}>{bg ? "Превод" : "Translation"}</button></span></li>)}</ul>
      <section><h2>{article ? language === "en" ? (bg ? "Английски превод" : "English translation") : (bg ? "Редакция" : "Edit") : (bg ? "Нова статия на български" : "New article in Bulgarian")}</h2>
        {article && <p><Link href={blogArticleUrl(article.slug, article.locales.en && language === "en" ? "en" : "bg")} target="_blank">{bg ? "Виж статията" : "View article"}</Link></p>}
        <form className="form-stack" onSubmit={(event) => void save(event)}>
          <label>{bg ? "Заглавие" : "Title"}<input value={form.title} onChange={(event) => field("title", event.target.value)} maxLength={80} required /></label>
          <label>SEO title<input value={form.seoTitle} onChange={(event) => field("seoTitle", event.target.value)} maxLength={70} required /></label>
          <label>SEO description<textarea value={form.seoDescription} onChange={(event) => field("seoDescription", event.target.value)} maxLength={160} required /></label>
          <label>{bg ? "Alt за основното изображение" : "Main image alt"}<input value={form.heroAlt} onChange={(event) => field("heroAlt", event.target.value)} maxLength={180} required /></label>
          <label>{bg ? "Alt за миниатюрата" : "Thumbnail alt"}<input value={form.thumbnailAlt} onChange={(event) => field("thumbnailAlt", event.target.value)} maxLength={180} required /></label>
          {language === "bg" && <><label>{bg ? "Основно изображение" : "Main image"}<input type="file" accept="image/jpeg,image/png,image/webp" required={!article} onChange={(event) => setHero(event.target.files?.[0] ?? null)} /></label><label>{bg ? "Миниатюра" : "Thumbnail"}<input type="file" accept="image/jpeg,image/png,image/webp" required={!article} onChange={(event) => setThumbnail(event.target.files?.[0] ?? null)} /></label></>}
          <div><label>{bg ? "Съдържание" : "Content"}</label><RichEditor key={editorKey} initial={form.html} onChange={(html) => field("html", html)} onImage={addImage} allowImage={language === "bg"} /></div>
          <button className="button button--orange" disabled={busy}>{busy ? (bg ? "Записване…" : "Saving…") : (bg ? "Запази" : "Save")}</button>
          {article && <button type="button" className="button button--outline" disabled={busy} onClick={() => void remove()}>{bg ? "Изтрий статията" : "Delete article"}</button>}
        </form>
      </section></div></main>
  </div>;
}
