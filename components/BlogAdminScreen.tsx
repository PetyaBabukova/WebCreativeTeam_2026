"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import type Quill from "quill";
import { appConfig, blogHexColor, blogHighlightColor, blogLinkUrl, blogTextColor, type Locale } from "@/lib/config";
import { blogArticleUrl, blogEditorReturnUrl } from "@/lib/routing";
import "quill/dist/quill.snow.css";

type TextFields = { title: string; subtitle?: string; html: string; seoTitle: string; seoDescription: string; heroAlt: string; thumbnailAlt: string; updatedAt?: string };
type Article = { _id: string; slug: string; version: number; heroUrl: string; thumbnailUrl: string; locales: { bg: TextFields; en?: TextFields } };
type ArticleRow = Pick<Article, "_id" | "slug" | "version" | "locales">;
type PendingImage = { name: string; file: File; preview: string };
let localImageRegistered = false;

function RichEditor({ initial, onChange, onImage, allowImage, locale }: { initial: string; onChange: (html: string) => void; onImage: (file: File, preview: string) => void; allowImage: boolean; locale: Locale }) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<Quill | null>(null);
  const linkRange = useRef<{ index: number; length: number } | null>(null);
  const [linkForm, setLinkForm] = useState<{ href: string; text: string; error: string } | null>(null);
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
          toolbar: [[{ header: [2, 3, 4, false] }], ["bold", "italic", "underline", "strike"], [{ color: [false, ...appConfig.blog.textColors.map((color) => color.value), ...appConfig.blog.globalTextColors.map((color) => color.value)] }, { background: [false, ...appConfig.blog.highlightColors.map((color) => color.value)] }], [{ list: "ordered" }, { list: "bullet" }], ["blockquote", "code-block", "link", ...(allowImage ? ["image"] : [])], [{ align: [] }], ["clean"]],
          uploader: { handler: () => {} },
        },
      });
      editor.current = quill;
      const rootColors = getComputedStyle(document.documentElement);
      const resolvedPalette = (choices: readonly { value: string }[]) => new Map(choices.flatMap(({ value }) => {
        const color = blogHexColor(rootColors.getPropertyValue(value.slice(4, -1)));
        return color ? [[color, value] as const] : [];
      }));
      const textByColor = resolvedPalette(appConfig.blog.globalTextColors);
      const highlightByColor = resolvedPalette(appConfig.blog.highlightColors);
      quill.clipboard.addMatcher(Node.ELEMENT_NODE, (_node, delta) => {
        for (const op of delta.ops) if (op.attributes) {
          if (typeof op.attributes.color === "string") {
            const color = blogTextColor(op.attributes.color) ?? textByColor.get(blogHexColor(op.attributes.color) ?? "");
            if (color) op.attributes.color = color; else delete op.attributes.color;
          }
          if (typeof op.attributes.background === "string") {
            const color = blogHighlightColor(op.attributes.background) ?? highlightByColor.get(blogHexColor(op.attributes.background) ?? "");
            if (color) op.attributes.background = color; else delete op.attributes.background;
          }
          if (typeof op.attributes.link === "string") {
            const href = blogLinkUrl(op.attributes.link);
            if (href) op.attributes.link = href; else delete op.attributes.link;
          }
        }
        return delta;
      });
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
      quill.on("text-change", (_change, _previous, source) => { onChangeRef.current(quill.getSemanticHTML()); if (source === "user") setLinkForm(null); });
      const toolbar = quill.getModule("toolbar") as { addHandler: (name: string, handler: () => void) => void };
      const toolbarElement = host.current.querySelector(".ql-toolbar");
      function labelPicker(name: "color" | "background", choices: readonly { value: string; bg: string; en: string }[], label: string, reset: string) {
        toolbarElement?.querySelector(`.ql-${name} .ql-picker-label`)?.setAttribute("aria-label", label);
        toolbarElement?.querySelectorAll<HTMLElement>(`.ql-${name} .ql-picker-item`).forEach((item) => {
          const choice = choices.find((entry) => entry.value === item.dataset.value);
          const title = choice ? `${name === "background" ? (locale === "bg" ? "Маркиране: " : "Highlight: ") : ""}${choice[locale]}` : reset;
          item.setAttribute("aria-label", title);
          item.setAttribute("title", title);
        });
      }
      labelPicker("color", [...appConfig.blog.textColors, ...appConfig.blog.globalTextColors], locale === "bg" ? "Цвят на текста" : "Text color", locale === "bg" ? "Стандартен цвят" : "Default color");
      labelPicker("background", appConfig.blog.highlightColors, locale === "bg" ? "Маркиране на текста" : "Text highlight", locale === "bg" ? "Без маркировка" : "No highlight");
      toolbar.addHandler("link", () => {
        const selection = quill.getSelection(true);
        if (!selection) return;
        let range = { index: selection.index, length: selection.length };
        let href = quill.getFormat(range.index, Math.max(range.length, 1)).link;
        if (!range.length) {
          if (typeof href !== "string" && range.index > 0) href = quill.getFormat(range.index - 1, 1).link;
          if (typeof href === "string") {
            const runs: { start: number; end: number; href: string | undefined }[] = [];
            let offset = 0;
            for (const op of quill.getContents().ops) {
              const length = typeof op.insert === "string" ? op.insert.length : 1;
              const link = typeof op.attributes?.link === "string" ? op.attributes.link : undefined;
              const last = runs.at(-1);
              if (last && last.href === link && last.end === offset) last.end += length;
              else runs.push({ start: offset, end: offset + length, href: link });
              offset += length;
            }
            const run = runs.find((item) => item.href === href && range.index >= item.start && range.index <= item.end);
            if (run) range = { index: run.start, length: run.end - run.start };
          }
        }
        linkRange.current = range;
        setLinkForm({ href: typeof href === "string" ? href : "", text: quill.getText(range.index, range.length), error: "" });
      });
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
  function applyLink() {
    const quill = editor.current;
    const range = linkRange.current;
    if (!quill || !range || !linkForm) return;
    const href = blogLinkUrl(linkForm.href);
    if (!href) { setLinkForm({ ...linkForm, error: locale === "bg" ? "Въведете пълен http://, https:// или mailto: адрес. За www адрес добавете https://." : "Enter a full http://, https:// or mailto: address. Add https:// before www addresses." }); return; }
    if (!range.length && !linkForm.text.trim()) { setLinkForm({ ...linkForm, error: locale === "bg" ? "Въведете текст за линка." : "Enter link text." }); return; }
    if (range.length) quill.formatText(range.index, range.length, "link", href, "user");
    else quill.insertText(range.index, linkForm.text.trim(), { link: href }, "user");
    setLinkForm(null);
    quill.focus({ preventScroll: true });
  }
  const onLinkEnter = (event: React.KeyboardEvent<HTMLInputElement>) => { if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); applyLink(); } };
  return <div className="blog-rich-editor"><div ref={host} role="group" aria-label={locale === "bg" ? "Съдържание на статията" : "Article content"} />
    <p className="blog-rich-editor__color-hint">{locale === "bg" ? "Ярките цветове може да са трудно четими върху светъл фон. При маркиране текстът става тъмен; за четим оранжев текст изберете „Тъмнооранжево“." : "Bright colors can be hard to read on a light background. Highlighted text appears dark; choose Deep orange for readable orange text."}</p>
    {linkForm && <div className="blog-rich-editor__link" role="group" aria-label={locale === "bg" ? "Вмъкване на линк" : "Insert link"}>
      {!linkRange.current?.length && <label>{locale === "bg" ? "Текст на линка" : "Link text"}<input value={linkForm.text} onKeyDown={onLinkEnter} onChange={(event) => setLinkForm({ ...linkForm, text: event.target.value, error: "" })} /></label>}
      <label>{locale === "bg" ? "Адрес на линка" : "Link address"}<input type="text" value={linkForm.href} onKeyDown={onLinkEnter} onChange={(event) => setLinkForm({ ...linkForm, href: event.target.value, error: "" })} aria-invalid={Boolean(linkForm.error)} aria-describedby={linkForm.error ? "blog-link-error" : undefined} autoFocus /></label>
      {linkForm.error && <p id="blog-link-error" role="alert">{linkForm.error}</p>}
      <div><button type="button" className="button button--orange" onClick={applyLink}>{locale === "bg" ? "Добави линк" : "Apply link"}</button>
        {linkRange.current?.length ? <button type="button" className="button button--outline" onClick={() => { const range = linkRange.current; if (range) editor.current?.formatText(range.index, range.length, "link", false, "user"); setLinkForm(null); editor.current?.focus({ preventScroll: true }); }}>{locale === "bg" ? "Премахни линка" : "Remove link"}</button> : null}
        <button type="button" className="button button--outline" onClick={() => { setLinkForm(null); editor.current?.focus({ preventScroll: true }); }}>{locale === "bg" ? "Отказ" : "Cancel"}</button></div>
    </div>}
  </div>;
}

const blank: TextFields = { title: "", subtitle: "", html: "", seoTitle: "", seoDescription: "", heroAlt: "", thumbnailAlt: "" };
export default function BlogAdminScreen({ locale, base, csrf, editId, invalidEdit = false }: { locale: Locale; base: string; csrf: string; editId?: string; invalidEdit?: boolean }) {
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
  const [targetBlocked, setTargetBlocked] = useState(Boolean(editId || invalidEdit));
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
    setForm(articleValue ? { ...blank, ...(articleValue.locales[selected] ?? { ...articleValue.locales.bg, title: "", subtitle: "", seoTitle: "", seoDescription: "" }) } : { ...blank });
    setEditorKey((key) => key + 1);
    setTargetBlocked(false);
    if (!articleValue) createKey.current = crypto.randomUUID();
  }
  async function open(id: string, selected: Locale = "bg", strict = false) {
    setBusy(true);
    try {
      const response = await fetch(`${appConfig.paths.blogApi}/admin/${id}`, { credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("Load failed");
      const loaded = (await response.json()).article as Article;
      if (strict && selected === "en" && !loaded.locales.en) throw new Error("Translation not found");
      start(loaded, selected);
    } catch { if (strict) setTargetBlocked(true); setError(true); setNotice(bg ? "Статията или преводът не се зареди." : "Article or translation could not load."); }
    finally { setBusy(false); }
  }
  useEffect(() => {
    if (invalidEdit) { setError(true); setNotice(locale === "bg" ? "Невалиден адрес на статия." : "Invalid article address."); return; }
    if (editId) void open(editId, locale, true);
  }, [editId, invalidEdit, locale]);
  function addImage(file: File, preview: string) { setPending((items) => [...items, { name: `inline-${items.length}`, file, preview }]); }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (busy) return;
    setBusy(true); setNotice("");
    let destination: string | undefined;
    try {
      const body = new FormData();
      for (const key of ["title", "subtitle", "seoTitle", "seoDescription", "heroAlt", "thumbnailAlt"] as const) body.set(key, form[key] ?? "");
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
      destination = blogArticleUrl(saved.slug, language);
    } catch (cause) { setError(true); setNotice(String(cause) === "Error: 409" ? (bg ? "Статията е променена другаде. Заредете я отново." : "Article changed elsewhere. Reload it.") : (bg ? "Записът не успя. Проверете полетата и опитайте отново." : "Save failed. Check the fields and try again.")); }
    finally { if (!destination) setBusy(false); }
    if (destination) window.location.assign(destination);
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
  const returnUrl = blogEditorReturnUrl(article?.slug ?? null, Boolean(article?.locales.en), language, locale);
  return <div className="auth-page"><header className="auth-header"><div className="container auth-header__inner"><Link href={base}>WebCreativeTeam</Link><Link href={base}>{bg ? "Администрация" : "Administration"}</Link></div></header>
    <main className="container auth-main" id="main"><div className="auth-panel"><h1>{bg ? "Статии" : "Articles"}</h1>
      {notice && <p className={error ? "form-message" : "form-message form-message--success"} role={error ? "alert" : "status"}>{notice}</p>}
      <button type="button" className="button button--outline" onClick={() => start(null)} disabled={busy}>{bg ? "Нова статия" : "New article"}</button>
      <ul className="auth-list">{rows.map((row) => <li key={row._id}><span>{row.locales.bg.title} {row.locales.en ? "· EN" : "· BG"}</span><span><button type="button" onClick={() => void open(row._id)} disabled={busy}>{bg ? "Редактирай" : "Edit"}</button> <button type="button" onClick={() => void open(row._id, "en")} disabled={busy}>{bg ? "Превод" : "Translation"}</button></span></li>)}</ul>
      {!targetBlocked && <section><h2>{article ? language === "en" ? (bg ? "Английски превод" : "English translation") : (bg ? "Редакция" : "Edit") : (bg ? "Нова статия на български" : "New article in Bulgarian")}</h2>
        {article && <p><Link href={returnUrl} target="_blank">{bg ? "Виж статията" : "View article"}</Link></p>}
        <form className="form-stack" onSubmit={(event) => void save(event)}>
          <label>{bg ? "Заглавие" : "Title"}<input value={form.title} onChange={(event) => field("title", event.target.value)} maxLength={80} required /></label>
          <label>{bg ? "Подзаглавие" : "Subtitle"}<input value={form.subtitle ?? ""} onChange={(event) => field("subtitle", event.target.value)} maxLength={240} required={!article || (language === "en" && !article.locales.en) || Boolean(article.locales[language]?.subtitle)} /></label>
          <label>SEO title<input value={form.seoTitle} onChange={(event) => field("seoTitle", event.target.value)} maxLength={70} required /></label>
          <label>SEO description<textarea value={form.seoDescription} onChange={(event) => field("seoDescription", event.target.value)} maxLength={160} required /></label>
          <label>{bg ? "Alt за основното изображение" : "Main image alt"}<input value={form.heroAlt} onChange={(event) => field("heroAlt", event.target.value)} maxLength={180} required /></label>
          <label>{bg ? "Alt за миниатюрата" : "Thumbnail alt"}<input value={form.thumbnailAlt} onChange={(event) => field("thumbnailAlt", event.target.value)} maxLength={180} required /></label>
          {language === "bg" && <><label>{bg ? "Основно изображение" : "Main image"}<input type="file" accept="image/jpeg,image/png,image/webp" required={!article} onChange={(event) => setHero(event.target.files?.[0] ?? null)} /></label><label>{bg ? "Миниатюра" : "Thumbnail"}<input type="file" accept="image/jpeg,image/png,image/webp" required={!article} onChange={(event) => setThumbnail(event.target.files?.[0] ?? null)} /></label></>}
          <div><label>{bg ? "Съдържание" : "Content"}</label><RichEditor key={editorKey} initial={form.html} onChange={(html) => field("html", html)} onImage={addImage} allowImage={language === "bg"} locale={locale} /></div>
          <button className="button button--orange" disabled={busy}>{busy ? (bg ? "Записване…" : "Saving…") : (bg ? "Запази" : "Save")}</button>
          <button type="button" className="button button--outline" disabled={busy} aria-label={bg ? "Отказ от редакцията" : "Cancel article editing"} onClick={() => window.location.assign(returnUrl)}>{bg ? "Отказ" : "Cancel"}</button>
          {article && <button type="button" className="button button--outline" disabled={busy} onClick={() => void remove()}>{bg ? "Изтрий статията" : "Delete article"}</button>}
        </form>
      </section>}</div></main>
  </div>;
}
