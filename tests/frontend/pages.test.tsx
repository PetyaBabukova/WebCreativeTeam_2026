import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within, waitFor } from "@testing-library/react";
import { renderToReadableStream } from "react-dom/server";
import { StrictMode } from "react";
import BgHome, { generateMetadata as bgHomeMetadata } from "@/app/(bg)/bg/page";
import EnHome, { generateMetadata as enHomeMetadata } from "@/app/(en)/en/page";
import BgAbout, { generateMetadata as bgAboutMetadata } from "@/app/(bg)/about/bg/page";
import EnAbout, { generateMetadata as enAboutMetadata } from "@/app/(en)/about/en/page";
import BgBlog, { generateMetadata as bgBlogMetadata } from "@/app/(bg)/blog/bg/page";
import EnBlog, { generateMetadata as enBlogMetadata } from "@/app/(en)/blog/en/page";
import BgFaq, { generateMetadata as bgFaqMetadata } from "@/app/(bg)/faq/bg/page";
import EnFaq, { generateMetadata as enFaqMetadata } from "@/app/(en)/faq/en/page";
import BgContacts, { generateMetadata as bgContactsMetadata } from "@/app/(bg)/contacts/bg/page";
import EnContacts, { generateMetadata as enContactsMetadata } from "@/app/(en)/contacts/en/page";
import BgPrivacy, { generateMetadata as bgPrivacyMetadata } from "@/app/(bg)/privacy/page";
import EnPrivacy, { generateMetadata as enPrivacyMetadata } from "@/app/(en)/privacy/en/page";
import BgCookies, { generateMetadata as bgCookiesMetadata } from "@/app/(bg)/cookies/page";
import EnCookies, { generateMetadata as enCookiesMetadata } from "@/app/(en)/cookies/en/page";
import BgService, { generateMetadata as bgServiceMetadata } from "@/app/(bg)/services/[slug]/bg/page";
import EnService, { generateMetadata as enServiceMetadata } from "@/app/(en)/services/[slug]/en/page";
import BgLayout from "@/app/(bg)/layout";
import EnLayout from "@/app/(en)/layout";
import GlobalNotFound from "@/app/global-not-found";
import NotFoundPage from "@/components/NotFoundPage";
import SiteNavigation from "@/components/SiteNavigation";
import AuthScreen from "@/components/AuthScreen";
import ContactPage from "@/components/ContactPage";
import NewsletterDecision from "@/components/NewsletterDecision";
import { messages } from "@/lib/messages";
import { isLocale, canonicalRedirects, localeSwitchUrl, offersUrl, pageUrl, portfolioUrl, sectionUrl, serviceSlugs, serviceUrl } from "@/lib/routing";
import { appConfig, localOrigin, siteOrigin } from "@/lib/config";

vi.mock("next/server", () => ({ connection: vi.fn(async () => {}) }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));

async function renderDocument(element: React.ReactNode) {
  return new Response(await renderToReadableStream(element)).text();
}
vi.mock("@/assets/services/products_page_background.webp", () => ({
  default: {
    src: "/assets/services/products_page_background.webp",
    width: 1672,
    height: 941,
    blurDataURL: "data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs",
  },
}));

const originalMatchMedia = Object.getOwnPropertyDescriptor(window, "matchMedia");
const originalVisibility = Object.getOwnPropertyDescriptor(document, "visibilityState");

beforeEach(() => {
  document.cookie = `${appConfig.localeCookie.name}=; Max-Age=0; Path=/`;
  document.cookie = `${appConfig.cookieChoice.name}=${appConfig.cookieChoice.version}.all; Path=/`;
  window.location.hash = "";
});

describe("administrator confirmation", () => {
  it("prompts once, clears a cancelled password, and retries an invitation with the rotated CSRF token", async () => {
    const originalShow = HTMLDialogElement.prototype.showModal;
    const originalClose = HTMLDialogElement.prototype.close;
    const originalFetch = globalThis.fetch;
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
    const calls: Array<{ path: string; csrf: string | null; body?: Record<string, string> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
      const path = new URL(url, "http://localhost").pathname;
      const body = options?.body ? JSON.parse(String(options.body)) as Record<string, string> : undefined;
      calls.push({ path, csrf: new Headers(options?.headers).get("x-csrf-token"), body });
      if (path.endsWith("/administrators")) return Response.json({ administrators: [], invitations: [] });
      if (path.endsWith("/invite")) return calls.filter((call) => call.path.endsWith("/invite")).length < 3 ? Response.json({ error: "reauth_required" }, { status: 428 }) : Response.json({ ok: true });
      if (path.endsWith("/reauth")) return Response.json({ csrf: "rotated-csrf" });
      throw new Error(`Unexpected request ${path}`);
    }));
    try {
      render(<AuthScreen locale="bg" view="administrators" base="/admin" returnTo="/admin" user={{ id: "operator", username: "Петя", email: "owner@example.test", csrf: "initial-csrf" }} />);
      expect(screen.getByRole("link", { name: "Здравей, Петя" })).toHaveAttribute("href", "/admin/profile");
      const inviteSection = screen.getByRole("heading", { name: "Покани администратор" }).closest("section")!;
      expect(within(inviteSection).queryByLabelText("Текуща парола")).toBeNull();
      fireEvent.change(within(inviteSection).getByLabelText("Имейл"), { target: { value: "partner@example.test" } });
      const send = within(inviteSection).getByRole("button", { name: "Изпрати линк" });
      send.focus();
      fireEvent.click(send);
      const dialog = screen.getByRole("dialog", { hidden: true });
      await waitFor(() => expect(dialog).toHaveAttribute("open"));
      fireEvent.change(within(dialog).getByLabelText("Текуща парола"), { target: { value: "temporary secret" } });
      fireEvent(dialog, new Event("cancel", { cancelable: true }));
      await waitFor(() => expect(dialog).not.toHaveAttribute("open"));
      expect(within(dialog).getByLabelText("Текуща парола")).toHaveValue("");
      expect(calls.filter((call) => call.path.endsWith("/reauth"))).toHaveLength(0);
      fireEvent.click(send);
      await waitFor(() => expect(dialog).toHaveAttribute("open"));
      fireEvent.change(within(dialog).getByLabelText("Текуща парола"), { target: { value: "correct horse battery staple" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "Продължи" }));
      await waitFor(() => expect(screen.getByText("Поканата е изпратена.")).toBeVisible());
      await waitFor(() => expect(dialog).not.toHaveAttribute("open"));
      const inviteCalls = calls.filter((call) => call.path.endsWith("/invite"));
      expect(inviteCalls).toHaveLength(3);
      expect(inviteCalls[2]).toMatchObject({ csrf: "rotated-csrf", body: { email: "partner@example.test" } });
      expect(within(dialog).getByLabelText("Текуща парола")).toHaveValue("");
    } finally {
      vi.stubGlobal("fetch", originalFetch);
      HTMLDialogElement.prototype.showModal = originalShow;
      HTMLDialogElement.prototype.close = originalClose;
    }
  });

  it("refreshes auth after a stale background response and announces only a new mail failure", async () => {
    const originalFetch = globalThis.fetch;
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    const calls: string[] = [];
    let administratorReads = 0;
    let staleNext = false;
    let recovered = false;
    const oldFailure = { id: "old", email: "old@example.test", createdAt: new Date().toISOString(), mailState: "failed" };
    const newInvitation = { id: "new", email: "new@example.test", createdAt: new Date().toISOString(), mailState: "queued" };
    const unseenFailure = { id: "unseen", email: "unseen@example.test", createdAt: new Date().toISOString(), mailState: "failed" };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const path = new URL(url, "http://localhost").pathname;
      calls.push(path);
      if (path.endsWith("/administrators")) {
        administratorReads += 1;
        if (staleNext) { staleNext = false; recovered = true; return Response.json({ error: "Sign in required" }, { status: 401 }); }
        return Response.json({ administrators: [], invitations: recovered ? [oldFailure, { ...newInvitation, mailState: "failed" }, unseenFailure] : [oldFailure, newInvitation] });
      }
      if (path.endsWith("/status")) return Response.json({ authenticated: true });
      if (path.endsWith("/csrf")) return Response.json({ csrf: "current-csrf" });
      throw new Error(`Unexpected request ${path}`);
    }));
    try {
      render(<AuthScreen locale="bg" view="administrators" base="/admin" returnTo="/admin" user={{ id: "operator", username: "Петя", email: "owner@example.test", csrf: "old-csrf" }} />);
      const pending = screen.getByRole("heading", { name: "Чакащи покани" }).closest("section")!;
      await waitFor(() => expect(within(pending).getByText("Чака изпращане")).toBeInTheDocument());
      expect(within(pending).getByRole("status", { hidden: true })).toBeEmptyDOMElement();
      expect(document.hidden).toBe(false);
      await act(async () => { fireEvent(document, new Event("visibilitychange")); });
      expect(within(pending).getByRole("status")).toBeEmptyDOMElement();

      const readsBeforeStaleCheck = administratorReads;
      staleNext = true;
      fireEvent(document, new Event("visibilitychange"));
      await waitFor(() => expect(staleNext).toBe(false));
      await waitFor(() => expect(calls.filter((path) => path.endsWith("/csrf"))).toHaveLength(1));
      expect(calls.filter((path) => path.endsWith("/status"))).toHaveLength(1);
      expect(administratorReads).toBe(readsBeforeStaleCheck + 2);
      await waitFor(() => expect(within(pending).getByRole("status")).toHaveTextContent("Изпращането на покана не успя."));
      expect(within(pending).getAllByText("Изпращането не успя — изпратете нова покана")).toHaveLength(3);
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });

  it("ignores an older invitation response after a newer failure is shown", async () => {
    const originalFetch = globalThis.fetch;
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    const invitation = { id: "new", email: "new@example.test", createdAt: new Date().toISOString(), mailState: "queued" };
    const stillQueued = { id: "other", email: "other@example.test", createdAt: new Date().toISOString(), mailState: "queued" };
    let phase: "initial" | "defer" | "failed" = "initial";
    let resolveOld: ((response: Response) => void) | undefined;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const path = new URL(url, "http://localhost").pathname;
      if (!path.endsWith("/administrators")) throw new Error(`Unexpected request ${path}`);
      if (phase === "defer") return new Promise<Response>((resolve) => { resolveOld = resolve; });
      return Response.json({ administrators: [], invitations: [{ ...invitation, mailState: phase === "failed" ? "failed" : "queued" }, stillQueued] });
    }));
    try {
      render(<AuthScreen locale="bg" view="administrators" base="/admin" returnTo="/admin" user={{ id: "operator", username: "Петя", email: "owner@example.test", csrf: "csrf" }} />);
      const pending = screen.getByRole("heading", { name: "Чакащи покани" }).closest("section")!;
      await waitFor(() => expect(within(pending).getAllByText("Чака изпращане")).toHaveLength(2));
      phase = "defer";
      fireEvent(document, new Event("visibilitychange"));
      await waitFor(() => expect(resolveOld).toBeDefined());
      phase = "failed";
      fireEvent(document, new Event("visibilitychange"));
      await waitFor(() => expect(within(pending).getByRole("status")).toHaveTextContent("Изпращането на покана не успя."));
      const announcement = within(pending).getByRole("status").querySelector("span");
      await act(async () => { resolveOld!(Response.json({ administrators: [], invitations: [invitation, stillQueued] })); });
      expect(within(pending).getByText("Изпращането не успя — изпратете нова покана")).toBeInTheDocument();
      await act(async () => { fireEvent(document, new Event("visibilitychange")); });
      expect(within(pending).getByRole("status").querySelector("span")).toBe(announcement);
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });

  it("discards an in-flight poll during confirmation and resumes after cancellation", async () => {
    const originalFetch = globalThis.fetch;
    const originalShow = HTMLDialogElement.prototype.showModal;
    const originalClose = HTMLDialogElement.prototype.close;
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    const invitation = { id: "pending", email: "pending@example.test", createdAt: new Date().toISOString(), mailState: "queued" };
    let holdNext = false;
    let afterCancel = false;
    let resolveHeld: ((response: Response) => void) | undefined;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const path = new URL(url, "http://localhost").pathname;
      if (path.endsWith("/administrators")) {
        if (holdNext) { holdNext = false; return new Promise<Response>((resolve) => { resolveHeld = resolve; }); }
        return Response.json({ administrators: [], invitations: [{ ...invitation, mailState: afterCancel ? "failed" : "queued" }] });
      }
      if (path.endsWith("/status")) return Response.json({ authenticated: true });
      if (path.endsWith("/csrf")) return Response.json({ csrf: "current-csrf" });
      if (path.endsWith("/invite")) return Response.json({ error: "reauth_required" }, { status: 428 });
      throw new Error(`Unexpected request ${path}`);
    }));
    try {
      render(<AuthScreen locale="bg" view="administrators" base="/admin" returnTo="/admin" user={{ id: "operator", username: "Петя", email: "owner@example.test", csrf: "csrf" }} />);
      const pending = screen.getByRole("heading", { name: "Чакащи покани" }).closest("section")!;
      await waitFor(() => expect(within(pending).getByText("Чака изпращане")).toBeInTheDocument());
      holdNext = true;
      fireEvent(document, new Event("visibilitychange"));
      await waitFor(() => expect(resolveHeld).toBeDefined());
      const invite = screen.getByRole("heading", { name: "Покани администратор" }).closest("section")!;
      fireEvent.change(within(invite).getByLabelText("Имейл"), { target: { value: "another@example.test" } });
      fireEvent.click(within(invite).getByRole("button", { name: "Изпрати линк" }));
      const dialog = screen.getByRole("dialog", { hidden: true });
      await waitFor(() => expect(dialog).toHaveAttribute("open"));
      const main = screen.getByRole("main");
      fireEvent(window, new Event("pagehide"));
      fireEvent(window, new Event("pageshow"));
      expect(main.style.visibility).toBe("hidden");
      await act(async () => { resolveHeld!(Response.json({ administrators: [], invitations: [{ ...invitation, mailState: "failed" }] })); });
      expect(within(pending).getByText("Чака изпращане")).toBeInTheDocument();
      expect(within(pending).getByRole("status", { hidden: true })).toBeEmptyDOMElement();
      fireEvent.click(within(dialog).getByRole("button", { name: "Отказ" }));
      await waitFor(() => expect(dialog).not.toHaveAttribute("open"));
      await waitFor(() => expect(main.style.visibility).toBe(""));
      afterCancel = true;
      fireEvent(document, new Event("visibilitychange"));
      await waitFor(() => expect(within(pending).getByRole("status")).toHaveTextContent("Изпращането на покана не успя."));
    } finally {
      vi.stubGlobal("fetch", originalFetch);
      HTMLDialogElement.prototype.showModal = originalShow;
      HTMLDialogElement.prototype.close = originalClose;
    }
  });

  it("keeps the rotated CSRF token when an older background refresh finishes later", async () => {
    const originalFetch = globalThis.fetch;
    const originalShow = HTMLDialogElement.prototype.showModal;
    const originalClose = HTMLDialogElement.prototype.close;
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
    Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
    const invitation = { id: "pending", email: "pending@example.test", createdAt: new Date().toISOString(), mailState: "queued" };
    const inviteCsrf: Array<string | null> = [];
    let staleNext = false;
    let resolveOldCsrf: ((response: Response) => void) | undefined;
    vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
      const path = new URL(url, "http://localhost").pathname;
      if (path.endsWith("/administrators")) {
        if (staleNext) { staleNext = false; return Response.json({ error: "Sign in required" }, { status: 401 }); }
        return Response.json({ administrators: [], invitations: [invitation] });
      }
      if (path.endsWith("/status")) return Response.json({ authenticated: true });
      if (path.endsWith("/csrf")) return new Promise<Response>((resolve) => { resolveOldCsrf = resolve; });
      if (path.endsWith("/invite")) {
        inviteCsrf.push(new Headers(options?.headers).get("x-csrf-token"));
        return inviteCsrf.length === 1 ? Response.json({ error: "reauth_required" }, { status: 428 }) : Response.json({ ok: true });
      }
      if (path.endsWith("/reauth")) return Response.json({ csrf: "rotated-csrf" });
      throw new Error(`Unexpected request ${path}`);
    }));
    try {
      render(<AuthScreen locale="bg" view="administrators" base="/admin" returnTo="/admin" user={{ id: "operator", username: "Петя", email: "owner@example.test", csrf: "old-csrf" }} />);
      await waitFor(() => expect(screen.getByText("Чака изпращане")).toBeInTheDocument());
      staleNext = true;
      fireEvent(document, new Event("visibilitychange"));
      await waitFor(() => expect(resolveOldCsrf).toBeDefined());
      const invite = screen.getByRole("heading", { name: "Покани администратор" }).closest("section")!;
      fireEvent.change(within(invite).getByLabelText("Имейл"), { target: { value: "first@example.test" } });
      fireEvent.click(within(invite).getByRole("button", { name: "Изпрати линк" }));
      const dialog = screen.getByRole("dialog", { hidden: true });
      await waitFor(() => expect(dialog).toHaveAttribute("open"));
      fireEvent.change(within(dialog).getByLabelText("Текуща парола"), { target: { value: "test password" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "Продължи" }));
      await waitFor(() => expect(inviteCsrf).toHaveLength(2));
      expect(inviteCsrf[1]).toBe("rotated-csrf");
      await act(async () => { resolveOldCsrf!(Response.json({ csrf: "stale-csrf" })); });
      fireEvent.change(within(invite).getByLabelText("Имейл"), { target: { value: "second@example.test" } });
      fireEvent.click(within(invite).getByRole("button", { name: "Изпрати линк" }));
      await waitFor(() => expect(inviteCsrf).toHaveLength(3));
      expect(inviteCsrf[2]).toBe("rotated-csrf");
    } finally {
      vi.stubGlobal("fetch", originalFetch);
      HTMLDialogElement.prototype.showModal = originalShow;
      HTMLDialogElement.prototype.close = originalClose;
    }
  });

  it("refreshes CSRF from another tab without polling while confirmation is open", async () => {
    const originalFetch = globalThis.fetch;
    const originalChannel = globalThis.BroadcastChannel;
    const originalShow = HTMLDialogElement.prototype.showModal;
    const originalClose = HTMLDialogElement.prototype.close;
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
    class TestChannel {
      static current: TestChannel;
      onmessage: ((event: MessageEvent) => void) | null = null;
      constructor() { TestChannel.current = this; }
      postMessage() {}
      close() {}
    }
    vi.stubGlobal("BroadcastChannel", TestChannel);
    let administratorReads = 0;
    let csrfReads = 0;
    const reauthCsrf: Array<string | null> = [];
    const inviteCsrf: Array<string | null> = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
      const path = new URL(url, "http://localhost").pathname;
      if (path.endsWith("/administrators")) { administratorReads += 1; return Response.json({ administrators: [], invitations: [] }); }
      if (path.endsWith("/status")) return Response.json({ authenticated: true });
      if (path.endsWith("/csrf")) { csrfReads += 1; return Response.json({ csrf: "other-tab-csrf" }); }
      if (path.endsWith("/invite")) {
        inviteCsrf.push(new Headers(options?.headers).get("x-csrf-token"));
        return inviteCsrf.length === 1 ? Response.json({ error: "reauth_required" }, { status: 428 }) : Response.json({ ok: true });
      }
      if (path.endsWith("/reauth")) { reauthCsrf.push(new Headers(options?.headers).get("x-csrf-token")); return Response.json({ csrf: "new-csrf" }); }
      throw new Error(`Unexpected request ${path}`);
    }));
    try {
      render(<AuthScreen locale="bg" view="administrators" base="/admin" returnTo="/admin" user={{ id: "operator", username: "Петя", email: "owner@example.test", csrf: "initial-csrf" }} />);
      await waitFor(() => expect(administratorReads).toBe(1));
      const invite = screen.getByRole("heading", { name: "Покани администратор" }).closest("section")!;
      fireEvent.change(within(invite).getByLabelText("Имейл"), { target: { value: "other@example.test" } });
      fireEvent.click(within(invite).getByRole("button", { name: "Изпрати линк" }));
      const dialog = screen.getByRole("dialog", { hidden: true });
      await waitFor(() => expect(dialog).toHaveAttribute("open"));
      await act(async () => { TestChannel.current.onmessage?.({ data: "session-rotated" } as MessageEvent); });
      await waitFor(() => expect(csrfReads).toBe(1));
      expect(administratorReads).toBe(1);
      fireEvent.change(within(dialog).getByLabelText("Текуща парола"), { target: { value: "a test password" } });
      fireEvent.click(within(dialog).getByRole("button", { name: "Продължи" }));
      await waitFor(() => expect(inviteCsrf).toHaveLength(2));
      expect(reauthCsrf).toEqual(["other-tab-csrf"]);
      expect(inviteCsrf[1]).toBe("new-csrf");
      await waitFor(() => expect(dialog).not.toHaveAttribute("open"));
    } finally {
      vi.stubGlobal("fetch", originalFetch);
      vi.stubGlobal("BroadcastChannel", originalChannel);
      HTMLDialogElement.prototype.showModal = originalShow;
      HTMLDialogElement.prototype.close = originalClose;
    }
  });

  it("restores a verified private page when the CSRF refresh is temporarily unavailable", async () => {
    const originalFetch = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const path = new URL(url, "http://localhost").pathname;
      if (path.endsWith("/status")) return Response.json({ authenticated: true });
      if (path.endsWith("/csrf")) return Response.json({ error: "Temporary failure" }, { status: 503 });
      throw new Error(`Unexpected request ${path}`);
    }));
    try {
      render(<AuthScreen locale="bg" view="home" base="/admin" returnTo="/admin" user={{ id: "operator", username: "Петя", email: "owner@example.test", csrf: "csrf" }} />);
      const main = screen.getByRole("main");
      fireEvent(window, new Event("pagehide"));
      await waitFor(() => expect(main.style.visibility).toBe("hidden"));
      fireEvent(window, new Event("pageshow"));
      await waitFor(() => expect(main.style.visibility).toBe(""));
    } finally {
      vi.stubGlobal("fetch", originalFetch);
    }
  });

  it("retries a temporary status failure after restoring a private page", async () => {
    const originalFetch = globalThis.fetch;
    let statusReads = 0;
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      const path = new URL(url, "http://localhost").pathname;
      if (path.endsWith("/status")) return ++statusReads === 1 ? Response.json({ error: "Temporary failure" }, { status: 503 }) : Response.json({ authenticated: true });
      if (path.endsWith("/csrf")) return Response.json({ csrf: "current-csrf" });
      throw new Error(`Unexpected request ${path}`);
    }));
    vi.useFakeTimers();
    try {
      render(<AuthScreen locale="bg" view="home" base="/admin" returnTo="/admin" user={{ id: "operator", username: "Петя", email: "owner@example.test", csrf: "csrf" }} />);
      const main = screen.getByRole("main");
      fireEvent(window, new Event("pagehide"));
      fireEvent(window, new Event("pageshow"));
      await act(async () => { await Promise.resolve(); });
      expect(main.style.visibility).toBe("hidden");
      expect(statusReads).toBe(1);
      fireEvent.click(screen.getByRole("button", { name: "English" }));
      expect(main.style.visibility).toBe("hidden");
      await act(async () => { await vi.advanceTimersByTimeAsync(appConfig.auth.statusRetryMilliseconds - 1); });
      expect(statusReads).toBe(1);
      await act(async () => { await vi.advanceTimersByTimeAsync(1); });
      expect(statusReads).toBe(2);
      expect(main.style.visibility).toBe("");
    } finally {
      vi.useRealTimers();
      vi.stubGlobal("fetch", originalFetch);
    }
  });
});

afterEach(() => {
  document.cookie = `${appConfig.localeCookie.name}=; Max-Age=0; Path=/`;
  window.location.hash = "";
  if (originalMatchMedia) Object.defineProperty(window, "matchMedia", originalMatchMedia);
  else Reflect.deleteProperty(window, "matchMedia");
  if (originalVisibility) Object.defineProperty(document, "visibilityState", originalVisibility);
});

function navigationCopy() {
  return {
    menu: "Menu", navigation: "Navigation", language: "Language", home: "Home", services: "Services",
    servicesToggle: "Services submenu", serviceLinks: messages.en.serviceLinks, blog: "Blog", about: "About", faq: "FAQs", contact: "Contact",
  };
}

describe("public pages", () => {
  it("keeps a newsletter decision token through Strict Mode effect replay", async () => {
    const token = "a".repeat(43);
    window.location.hash = `token=${token}`;
    const send = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(async () => new Response(JSON.stringify({ result: "done" }), { status: 200 }));
    const previousFetch = globalThis.fetch;
    vi.stubGlobal("fetch", send);
    try {
      render(<StrictMode><NewsletterDecision locale="en" action="confirm" /></StrictMode>);
      expect(window.location.hash).toBe("");
      fireEvent.click(screen.getByRole("button", { name: "Confirm" }));
      await waitFor(() => expect(send).toHaveBeenCalledOnce());
      expect(JSON.parse(String(send.mock.calls[0]?.[1]?.body))).toMatchObject({ action: "confirm", token });
    } finally { vi.stubGlobal("fetch", previousFetch); }
  });

  it.each([[BgFaq, "bg"], [EnFaq, "en"]] as const)("shows 13 initially closed FAQ cards and localized related links %#", (Page, locale) => {
    render(<Page />);
    const main = screen.getByRole("main");
    expect(within(main).getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(within(main).getByRole("heading", { level: 1 })).toHaveTextContent(messages[locale].faq.eyebrow);
    expect(within(main).getByRole("heading", { level: 2, name: messages[locale].faq.headline.join(" ") })).toBeInTheDocument();
    const cards = main.querySelectorAll<HTMLElement>("[data-faq-index]");
    expect(cards).toHaveLength(13);
    expect(Array.from(cards, (card) => card.querySelector(".faq__question-button")?.textContent?.replace(/\u00ad/g, ""))).not.toContain(locale === "bg" ? "Колко време отнема един проект?" : "How long does a project take?");
    expect(Array.from(cards, (card) => card.querySelector(".faq__question-button")?.textContent)).not.toContain(locale === "bg" ? "С какви бизнеси работите?" : "What types of businesses do you work with?");
    expect(main.querySelectorAll(".faq__card--open")).toHaveLength(0);
    expect(main.querySelectorAll('[aria-expanded="true"]')).toHaveLength(0);
    expect(main.querySelectorAll(".faq__row")).toHaveLength(3);
    fireEvent.click(within(cards[2]).getByRole("button"));
    expect(main.querySelectorAll(".faq__card--open")).toHaveLength(1);
    expect(cards[2]).toHaveClass("faq__card--open");
    expect(within(cards[2]).getByRole("button")).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(within(cards[2]).getByRole("button"));
    expect(cards[2]).toHaveClass("faq__card--open");
    fireEvent.click(within(cards[9]).getByRole("button"));
    expect(cards[2]).not.toHaveClass("faq__card--open");
    expect(cards[9]).toHaveClass("faq__card--open");
    expect(main.querySelectorAll(".faq__card--open")).toHaveLength(1);
    expect(cards[12].querySelector(".faq__question-button")).toHaveAttribute("aria-expanded", "false");
    expect(cards[12].querySelectorAll(".faq__answer")).toHaveLength(3);
    expect(cards[6].querySelector(".faq__question-button")?.textContent?.replace(/\u00ad/g, "")).toBe(locale === "bg" ? "Как AI автоматизацията за бизнеса ще ми помогне?" : "How will AI automation for business help me?");
    expect(cards[8].querySelector(".faq__question-button")?.textContent?.replace(/\u00ad/g, "")).toBe(locale === "bg" ? "Как си измерват маркетинговите резултати?" : "How are marketing results measured?");
    const offersLink = cards[4].querySelector(".faq__answer-link");
    expect(offersUrl()).toBe("/servicess/offers");
    expect(offersLink).toHaveAttribute("href", offersUrl());
    expect(offersLink).toHaveTextContent(locale === "bg" ? "комбинирани решения" : "combined solutions");
    expect(main.querySelector(".faq__controls")).toBeNull();
    const related = within(main).getByRole("navigation", { name: messages[locale].faq.relatedLabel });
    expect(within(related).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      pageUrl("contacts", locale), sectionUrl("services", locale, "faq"), portfolioUrl(locale),
    ]);
    for (const [index, link] of within(related).getAllByRole("link").entries()) {
      expect(link).toHaveClass("button", "button--outline", "faq__related-button");
      expect(link).toHaveTextContent(messages[locale].faq.related[index].title);
      expect(link).not.toHaveTextContent(messages[locale].faq.related[index].description);
      expect(link.querySelectorAll("svg")).toHaveLength(2);
    }
  });
  it("keeps a tapped FAQ question under the finger while the previous answer collapses, until the visitor scrolls", async () => {
    // Single-column layout: (width > 68rem) does not match.
    Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false, addEventListener: () => undefined, removeEventListener: () => undefined }) });
    const scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => undefined);
    render(<BgFaq />);
    const cards = screen.getByRole("main").querySelectorAll<HTMLElement>("[data-faq-index]");
    fireEvent.click(within(cards[1]).getByRole("button"));
    // The tapped card starts at 500 px; the collapsing answer above it pulls it up to 320 px.
    let top = 500;
    vi.spyOn(cards[4], "getBoundingClientRect").mockImplementation(() => ({ top, bottom: top + 60, left: 0, right: 0, width: 0, height: 60, x: 0, y: top, toJSON: () => ({}) }));
    fireEvent.click(within(cards[4]).getByRole("button"));
    expect(cards[4]).toHaveClass("faq__card--open");
    top = 320;
    await waitFor(() => expect(scrollBy).toHaveBeenCalledWith(0, -180));
    // A wheel gesture hands control back to the visitor: no further corrections.
    fireEvent.wheel(window);
    scrollBy.mockClear();
    top = 250;
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(scrollBy).not.toHaveBeenCalled();
    scrollBy.mockRestore();
  });
  it.each([
    [BgHome, "Пауза на въртенето"],
    [EnHome, "Pause logo rotation"],
  ] as const)("toggles the localized orb pause control %#", (Page, label) => {
    render(<Page />);
    const control = screen.getByRole("button", { name: label });
    const tilt = document.querySelector<HTMLElement>(".hero-orb__tilt")!;
    const pointerSurface = document.querySelector<HTMLElement>(".hero-orb__entrance")!;
    const initialTransform = tilt.style.transform;
    fireEvent.pointerMove(pointerSurface, { pointerType: "mouse", clientX: 40, clientY: 40 });
    expect(tilt.style.transform).toBe(initialTransform);
    expect(control).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(control);
    expect(control).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(control);
    expect(control).toHaveAttribute("aria-pressed", "false");
  });
  it.each([[BgContacts, "bg"], [EnContacts, "en"]] as const)("shows the centered contact form and direct contacts %#", (Page, locale) => {
    render(<Page />);
    const copy = messages[locale];
    const main = screen.getByRole("main");
    expect(within(main).getByRole("heading", { level: 1, name: copy.contacts.title })).toBeVisible();
    expect(within(main).getByRole("heading", { level: 2, name: copy.contacts.headline.join(" ") })).toBeVisible();
    expect(main.querySelector(".contact__notice")).toBeNull();
    expect(main.querySelector(".contact__intro [data-motion-typewriter]")).toBeInTheDocument();
    expect(copy.contacts.intro).toContain("\n");
    expect(main.querySelector(".contact__section-number")).toBeNull();
    expect(main.querySelector("form")).toBeInTheDocument();
    expect(main.querySelector(".contact__panel h3")).toBeNull();
    const interests = within(main).getByRole("group", { name: copy.contacts.interest });
    expect(interests).toHaveAccessibleDescription(copy.contacts.interestHint);
    expect(within(interests).getAllByRole("checkbox")).toHaveLength(6);
    const diagnostic = within(interests).getByRole("checkbox", { name: copy.contacts.diagnostic });
    expect(diagnostic).toHaveAccessibleDescription(copy.contacts.diagnosticHint);
    fireEvent.click(diagnostic);
    expect(diagnostic).toBeChecked();
    expect(within(main).getByRole("textbox", { name: copy.contacts.phone })).not.toHaveAttribute("required");
    expect(within(main).getByRole("textbox", { name: copy.contacts.budget })).not.toHaveAttribute("required");
    const message = within(main).getByRole("textbox", { name: `${copy.contacts.message} *` });
    fireEvent.change(message, { target: { value: "A short idea" } });
    expect(within(main).getByText("12 / 2000")).toBeVisible();
    expect(within(message.closest(".contact__message-field") as HTMLElement).getByRole("status")).toBeEmptyDOMElement();
    fireEvent.change(message, { target: { value: "x".repeat(2000) } });
    expect(within(main).getByText("2000 / 2000")).toBeVisible();
    expect(within(message.closest(".contact__message-field") as HTMLElement).getByRole("status")).toHaveTextContent(copy.contacts.limitReached);
    expect(within(main).getByRole("checkbox", { name: copy.contacts.newsletter })).toBeEnabled();
    expect(within(main).getByRole("checkbox", { name: copy.contacts.privacy })).toBeRequired();
    const privacy = within(main.querySelector(".contact__privacy-row") as HTMLElement).getByRole("link", { name: copy.contacts.privacyLink });
    expect(privacy).toHaveAttribute("href", pageUrl("privacy", locale));
    expect(within(main.querySelector(".contact__captcha-notice") as HTMLElement).getByRole("link", { name: copy.contacts.captchaPrivacy })).toHaveAttribute("href", pageUrl("privacy", locale));
    expect(within(main).getByRole("checkbox", { name: copy.contacts.privacy })).not.toBeChecked();
    privacy.addEventListener("click", (event) => event.preventDefault(), { once: true });
    fireEvent.click(privacy);
    expect(within(main).getByRole("checkbox", { name: copy.contacts.privacy })).not.toBeChecked();
    expect(within(main).getByRole("button", { name: copy.contacts.send })).toBeEnabled();
    expect(main.querySelector(".contact__direct a")).toBeNull();
    expect(within(main).getByRole("button", { name: `${copy.contacts.copy} ${appConfig.contactEmail}` })).toBeEnabled();
    expect(main.querySelector(".contact__direct h3, .contact__direct p")).toBeNull();
    expect(within(main).getAllByRole("button").filter((button) => button.classList.contains("contact__method-action") && button.textContent !== appConfig.contactEmail).map((button) => button.textContent)).toEqual(
      appConfig.contactPhones.map((phone) => locale === "en" ? `${appConfig.contactPhoneCountryCode}${phone.slice(1)}` : phone),
    );
  });
  it("queues a valid submission until CAPTCHA is ready", async () => {
    let resolveConfig: (response: Response) => void = () => {};
    const config = new Promise<Response>((resolve) => { resolveConfig = resolve; });
    const fetchMock = vi.fn((_url: string, options?: RequestInit) => options?.method === "POST"
      ? Promise.resolve(Response.json({ ok: true })) : config);
    let completeCaptcha: ((token: string) => void) | undefined;
    const captcha = {
      render: vi.fn((_container: HTMLElement, options: { callback: (token: string) => void }) => {
        completeCaptcha = options.callback;
        return 0;
      }),
      execute: vi.fn(() => completeCaptcha?.("test-token")),
      reset: vi.fn(),
    };
    const previousFetch = globalThis.fetch;
    const captchaWindow = window as Window & { grecaptcha?: typeof captcha };
    const previousCaptcha = captchaWindow.grecaptcha;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    captchaWindow.grecaptcha = captcha;
    try {
      render(<ContactPage locale="bg" copy={messages.bg.contacts} serviceNames={messages.bg.serviceLinks} />);
      const form = screen.getByRole("form", { name: messages.bg.contacts.title });
      fireEvent.change(within(form).getByRole("textbox", { name: `${messages.bg.contacts.name} *` }), { target: { value: "Visitor" } });
      fireEvent.change(within(form).getByRole("textbox", { name: `${messages.bg.contacts.email} *` }), { target: { value: "visitor@example.test" } });
      fireEvent.change(within(form).getByRole("textbox", { name: `${messages.bg.contacts.message} *` }), { target: { value: "Please contact me about my project." } });
      fireEvent.click(within(form).getByRole("checkbox", { name: messages.bg.contacts.privacy }));
      fireEvent.submit(form);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await act(async () => { resolveConfig(Response.json({ siteKey: "test-site-key" })); });
      await waitFor(() => expect(captcha.execute).toHaveBeenCalledOnce());
      await waitFor(() => expect(within(form).getAllByRole("status").at(-1)).toHaveTextContent(messages.bg.contacts.sent));
      expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toMatchObject({ captchaToken: "test-token", name: "Visitor" });
    } finally {
      globalThis.fetch = previousFetch;
      if (previousCaptcha) captchaWindow.grecaptcha = previousCaptcha;
      else delete captchaWindow.grecaptcha;
    }
  });
  it("sends the current form values after a delayed CAPTCHA challenge", async () => {
    const fetchMock = vi.fn((_url: string, options?: RequestInit) => Promise.resolve(options?.method === "POST"
      ? Response.json({ ok: true }) : Response.json({ siteKey: "test-site-key" })));
    let completeCaptcha: ((token: string) => void) | undefined;
    const captcha = {
      render: vi.fn((_container: HTMLElement, options: { callback: (token: string) => void }) => {
        completeCaptcha = options.callback;
        return 0;
      }),
      execute: vi.fn(),
      reset: vi.fn(),
    };
    const previousFetch = globalThis.fetch;
    const captchaWindow = window as Window & { grecaptcha?: typeof captcha };
    const previousCaptcha = captchaWindow.grecaptcha;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    captchaWindow.grecaptcha = captcha;
    try {
      render(<ContactPage locale="bg" copy={messages.bg.contacts} serviceNames={messages.bg.serviceLinks} />);
      const form = screen.getByRole("form", { name: messages.bg.contacts.title });
      fireEvent.change(within(form).getByRole("textbox", { name: `${messages.bg.contacts.name} *` }), { target: { value: "Visitor" } });
      fireEvent.change(within(form).getByRole("textbox", { name: `${messages.bg.contacts.email} *` }), { target: { value: "visitor@example.test" } });
      const message = within(form).getByRole("textbox", { name: `${messages.bg.contacts.message} *` });
      fireEvent.change(message, { target: { value: "Please review the first draft." } });
      fireEvent.click(within(form).getByRole("checkbox", { name: messages.bg.contacts.privacy }));
      fireEvent.submit(form);
      await waitFor(() => expect(captcha.execute).toHaveBeenCalledOnce());
      fireEvent.change(message, { target: { value: "Please review the revised draft." } });
      await act(async () => { completeCaptcha?.("test-token"); });
      await waitFor(() => expect(within(form).getAllByRole("status").at(-1)).toHaveTextContent(messages.bg.contacts.sent));
      const post = fetchMock.mock.calls.find((call) => call[1]?.method === "POST");
      expect(JSON.parse(String(post?.[1]?.body))).toMatchObject({ message: "Please review the revised draft." });
    } finally {
      globalThis.fetch = previousFetch;
      if (previousCaptcha) captchaWindow.grecaptcha = previousCaptcha;
      else delete captchaWindow.grecaptcha;
    }
  });
  it("rejects whitespace-only contact fields before CAPTCHA execution", async () => {
    const captcha = { render: vi.fn(() => 0), execute: vi.fn(), reset: vi.fn() };
    const previousFetch = globalThis.fetch;
    const captchaWindow = window as Window & { grecaptcha?: typeof captcha };
    const previousCaptcha = captchaWindow.grecaptcha;
    globalThis.fetch = vi.fn(async () => Response.json({ siteKey: "test-site-key" })) as unknown as typeof fetch;
    captchaWindow.grecaptcha = captcha;
    try {
      render(<ContactPage locale="bg" copy={messages.bg.contacts} serviceNames={messages.bg.serviceLinks} />);
      const form = screen.getByRole("form", { name: messages.bg.contacts.title });
      fireEvent.change(within(form).getByRole("textbox", { name: `${messages.bg.contacts.name} *` }), { target: { value: "  A" } });
      fireEvent.change(within(form).getByRole("textbox", { name: `${messages.bg.contacts.email} *` }), { target: { value: "visitor@example.test" } });
      fireEvent.change(within(form).getByRole("textbox", { name: `${messages.bg.contacts.message} *` }), { target: { value: "Please contact me about my project." } });
      fireEvent.click(within(form).getByRole("checkbox", { name: messages.bg.contacts.privacy }));
      fireEvent.submit(form);
      expect(captcha.execute).not.toHaveBeenCalled();
      expect(within(form).getByRole("textbox", { name: `${messages.bg.contacts.name} *` })).toBeInvalid();
    } finally {
      globalThis.fetch = previousFetch;
      if (previousCaptcha) captchaWindow.grecaptcha = previousCaptcha;
      else delete captchaWindow.grecaptcha;
    }
  });
  it("retries loading reCAPTCHA after the script fails", async () => {
    const fetchMock = vi.fn((_url: string, options?: RequestInit) => Promise.resolve(options?.method === "POST"
      ? Response.json({ ok: true }) : Response.json({ siteKey: "test-site-key" })));
    let completeCaptcha: ((token: string) => void) | undefined;
    const captcha = {
      render: vi.fn((_container: HTMLElement, options: { callback: (token: string) => void }) => {
        completeCaptcha = options.callback;
        return 0;
      }),
      execute: vi.fn(() => completeCaptcha?.("test-token")),
      reset: vi.fn(),
    };
    const previousFetch = globalThis.fetch;
    const captchaWindow = window as Window & { grecaptcha?: typeof captcha; __wctRecaptchaLoaded?: () => void };
    const previousCaptcha = captchaWindow.grecaptcha;
    delete captchaWindow.grecaptcha;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    try {
      render(<ContactPage locale="bg" copy={messages.bg.contacts} serviceNames={messages.bg.serviceLinks} />);
      const form = screen.getByRole("form", { name: messages.bg.contacts.title });
      fireEvent.change(within(form).getByRole("textbox", { name: `${messages.bg.contacts.name} *` }), { target: { value: "Visitor" } });
      fireEvent.change(within(form).getByRole("textbox", { name: `${messages.bg.contacts.email} *` }), { target: { value: "visitor@example.test" } });
      fireEvent.change(within(form).getByRole("textbox", { name: `${messages.bg.contacts.message} *` }), { target: { value: "Please contact me about my project." } });
      fireEvent.click(within(form).getByRole("checkbox", { name: messages.bg.contacts.privacy }));
      fireEvent.submit(form);
      await waitFor(() => expect(document.querySelector(`script[src^="${appConfig.contact.captchaScriptUrl}"]`)).not.toBeNull());
      await act(async () => { document.querySelector(`script[src^="${appConfig.contact.captchaScriptUrl}"]`)?.dispatchEvent(new Event("error")); });
      await waitFor(() => expect(within(form).getByRole("alert")).toHaveTextContent(messages.bg.contacts.captchaError));
      expect(document.querySelector(`script[src^="${appConfig.contact.captchaScriptUrl}"]`)).toBeNull();
      fireEvent.submit(form);
      await waitFor(() => expect(document.querySelector(`script[src^="${appConfig.contact.captchaScriptUrl}"]`)).not.toBeNull());
      captchaWindow.grecaptcha = captcha;
      await act(async () => { captchaWindow.__wctRecaptchaLoaded?.(); });
      await waitFor(() => expect(within(form).getAllByRole("status").at(-1)).toHaveTextContent(messages.bg.contacts.sent));
      expect(captcha.execute).toHaveBeenCalledOnce();
    } finally {
      globalThis.fetch = previousFetch;
      if (previousCaptcha) captchaWindow.grecaptcha = previousCaptcha;
      else delete captchaWindow.grecaptcha;
    }
  });
  it("shows one status indicator for a slow send, then an orange error, and resets it on retry", async () => {
    let resolveFirstPost: (response: Response) => void = () => {};
    const firstPost = new Promise<Response>((resolve) => { resolveFirstPost = resolve; });
    let posts = 0;
    const fetchMock = vi.fn((_url: string, options?: RequestInit) => {
      if (options?.method !== "POST") return Promise.resolve(Response.json({ siteKey: "test-site-key" }));
      posts += 1;
      return posts === 1 ? firstPost : Promise.resolve(Response.json({ ok: true }));
    });
    let completeCaptcha: ((token: string) => void) | undefined;
    const captcha = {
      render: vi.fn((_container: HTMLElement, options: { callback: (token: string) => void }) => {
        completeCaptcha = options.callback;
        return 0;
      }),
      execute: vi.fn(() => completeCaptcha?.("test-token")),
      reset: vi.fn(),
    };
    const previousFetch = globalThis.fetch;
    const captchaWindow = window as Window & { grecaptcha?: typeof captcha };
    const previousCaptcha = captchaWindow.grecaptcha;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    captchaWindow.grecaptcha = captcha;
    let staleNoticeTimer: (() => void) | undefined;
    const noticeTimers: Array<() => void> = [];
    const noticeDelays: number[] = [];
    const nativeSetTimeout = window.setTimeout.bind(window);
    const timeoutSpy = vi.spyOn(window, "setTimeout").mockImplementation((handler, delay, ...args) => {
      if (typeof handler === "function" && delay !== undefined && delay > 10000 && delay <= appConfig.contact.notificationDurationMilliseconds) {
        staleNoticeTimer ??= () => handler();
        noticeTimers.push(() => handler());
        noticeDelays.push(delay);
      }
      return nativeSetTimeout(handler, delay, ...args) as unknown as ReturnType<typeof globalThis.setTimeout>;
    });
    try {
      render(<ContactPage locale="bg" copy={messages.bg.contacts} serviceNames={messages.bg.serviceLinks} />);
      const form = screen.getByRole("form", { name: messages.bg.contacts.title });
      fireEvent.change(within(form).getByRole("textbox", { name: `${messages.bg.contacts.name} *` }), { target: { value: "Visitor" } });
      fireEvent.change(within(form).getByRole("textbox", { name: `${messages.bg.contacts.email} *` }), { target: { value: "visitor@example.test" } });
      const message = within(form).getByRole("textbox", { name: `${messages.bg.contacts.message} *` });
      fireEvent.change(message, { target: { value: "Please review my website." } });
      fireEvent.click(within(form).getByRole("checkbox", { name: messages.bg.contacts.privacy }));
      fireEvent.submit(form);
      await waitFor(() => expect(posts).toBe(1));
      expect(form.querySelectorAll(".contact__notice")).toHaveLength(0);
      fireEvent.submit(form);
      expect(posts).toBe(1);
      await waitFor(() => expect(within(form).getByRole("group", { name: messages.bg.contacts.noticeSending })).toBeVisible());
      await act(async () => { resolveFirstPost(Response.json({ error: "unavailable" }, { status: 503 })); });
      await waitFor(() => expect(within(form).getByRole("group", { name: messages.bg.contacts.noticeErrorTitle })).toBeVisible());
      const errorNotice = form.querySelector(".contact__notice") as HTMLElement;
      expect(errorNotice).toHaveClass("contact__notice--error");
      expect(within(form).getByRole("alert")).toHaveTextContent(messages.bg.contacts.sendError);
      expect(message).toHaveValue("Please review my website.");
      expect(noticeDelays).toContain(appConfig.contact.notificationDurationMilliseconds);
      fireEvent.pointerEnter(errorNotice, { pointerType: "mouse" });
      await new Promise((resolve) => nativeSetTimeout(resolve, 20));
      fireEvent.pointerLeave(errorNotice, { pointerType: "mouse" });
      expect(noticeDelays.at(-1)).toBeLessThan(appConfig.contact.notificationDurationMilliseconds);
      const close = within(errorNotice).getByRole("button", { name: messages.bg.contacts.noticeClose });
      close.focus();
      fireEvent.click(close);
      expect(within(form).getByRole("button", { name: messages.bg.contacts.send })).toHaveFocus();
      fireEvent.submit(form);
      await waitFor(() => expect(posts).toBe(2));
      await waitFor(() => expect(within(form).getByRole("group", { name: messages.bg.contacts.noticeSentTitle })).toBeVisible());
      await act(async () => { staleNoticeTimer?.(); });
      expect(within(form).getByRole("group", { name: messages.bg.contacts.noticeSentTitle })).toBeVisible();
      expect(form.querySelectorAll(".contact__notice--error")).toHaveLength(0);
      expect(message).toHaveValue("");
      await act(async () => { noticeTimers.at(-1)?.(); });
      await waitFor(() => expect(within(form).queryByRole("group", { name: messages.bg.contacts.noticeSentTitle })).toBeNull());
      expect(form.querySelector(".contact__feedback")).toHaveTextContent(messages.bg.contacts.sent);
    } finally {
      timeoutSpy.mockRestore();
      globalThis.fetch = previousFetch;
      if (previousCaptcha) captchaWindow.grecaptcha = previousCaptcha;
      else delete captchaWindow.grecaptcha;
    }
  });
  it("keeps the form and reports an unconfirmed result after the request timeout", async () => {
    const fetchMock = vi.fn((_url: string, options?: RequestInit) => {
      if (options?.method !== "POST") return Promise.resolve(Response.json({ siteKey: "test-site-key" }));
      return new Promise<Response>((_resolve, reject) => {
        options.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
      });
    });
    let completeCaptcha: ((token: string) => void) | undefined;
    const captcha = {
      render: vi.fn((_container: HTMLElement, options: { callback: (token: string) => void }) => {
        completeCaptcha = options.callback;
        return 0;
      }),
      execute: vi.fn(() => completeCaptcha?.("test-token")),
      reset: vi.fn(),
    };
    const previousFetch = globalThis.fetch;
    const captchaWindow = window as Window & { grecaptcha?: typeof captcha };
    const previousCaptcha = captchaWindow.grecaptcha;
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    captchaWindow.grecaptcha = captcha;
    let expireRequest: (() => void) | undefined;
    const nativeSetTimeout = window.setTimeout.bind(window);
    const timeoutSpy = vi.spyOn(window, "setTimeout").mockImplementation((handler, delay, ...args) => {
      if (delay === appConfig.contact.requestTimeoutMilliseconds && typeof handler === "function") {
        expireRequest = () => handler();
        return 999999 as unknown as ReturnType<typeof window.setTimeout>;
      }
      return nativeSetTimeout(handler, delay, ...args) as unknown as ReturnType<typeof globalThis.setTimeout>;
    });
    try {
      render(<ContactPage locale="bg" copy={messages.bg.contacts} serviceNames={messages.bg.serviceLinks} />);
      const form = screen.getByRole("form", { name: messages.bg.contacts.title });
      fireEvent.change(within(form).getByRole("textbox", { name: `${messages.bg.contacts.name} *` }), { target: { value: "Visitor" } });
      fireEvent.change(within(form).getByRole("textbox", { name: `${messages.bg.contacts.email} *` }), { target: { value: "visitor@example.test" } });
      const message = within(form).getByRole("textbox", { name: `${messages.bg.contacts.message} *` });
      fireEvent.change(message, { target: { value: "Please review my website." } });
      fireEvent.click(within(form).getByRole("checkbox", { name: messages.bg.contacts.privacy }));
      fireEvent.submit(form);
      await waitFor(() => expect(expireRequest).toBeDefined());
      await act(async () => { expireRequest?.(); });
      await waitFor(() => expect(within(form).getByRole("group", { name: messages.bg.contacts.noticeUnconfirmedTitle })).toBeVisible());
      expect(form.querySelector(".contact__notice")).not.toHaveClass("contact__notice--error");
      expect(within(form).getByRole("alert")).toHaveTextContent(messages.bg.contacts.unconfirmed);
      expect(message).toHaveValue("Please review my website.");
      expect(within(form).getByRole("button", { name: messages.bg.contacts.send })).toHaveAttribute("aria-disabled", "false");
    } finally {
      timeoutSpy.mockRestore();
      globalThis.fetch = previousFetch;
      if (previousCaptcha) captchaWindow.grecaptcha = previousCaptcha;
      else delete captchaWindow.grecaptcha;
    }
  });
  it.each([[BgContacts, "bg"], [EnContacts, "en"]] as const)("routes footer and header links through the active locale %#", (Page, locale) => {
    render(<Page />);
    const copy = messages[locale];
    const footer = screen.getByRole("contentinfo");
    const navigation = within(footer).getByRole("navigation", { name: copy.landing.footer.navigation });
    const expected = [pageUrl("home", locale), ...serviceSlugs.map((slug) => serviceUrl(slug, locale)), pageUrl("blog", locale), pageUrl("faq", locale), pageUrl("about", locale), pageUrl("contacts", locale)];
    expect(within(navigation).getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual(expected);
    expect(within(document.querySelector(".site-header") as HTMLElement).getByRole("link", { name: copy.landing.hero.contact }).getAttribute("href")).toBe(pageUrl("contacts", locale));
    expect(within(footer).getAllByRole("link", { name: copy.landing.hero.contact })).toHaveLength(1);
    expect(within(footer).getByRole("link", { name: locale === "bg" ? "EN" : "BG" })).toHaveAttribute("href", pageUrl("contacts", locale === "bg" ? "en" : "bg"));
    expect(within(footer).getByRole("button", { name: copy.landing.footer.subscribe })).toBeEnabled();
    expect(within(footer).getByRole("button", { name: copy.landing.footer.resend })).toBeEnabled();
    expect(within(footer).getByRole("textbox", { name: copy.landing.footer.email })).toBeEnabled();
    expect(within(footer).getByRole("checkbox", { name: `${copy.landing.footer.consentPrivacy} ${copy.landing.footer.privacyPolicy}` })).toBeEnabled();
    expect(within(footer).getByRole("link", { name: copy.landing.footer.privacy })).toHaveAttribute("href", pageUrl("privacy", locale));
    expect(within(footer).getByRole("link", { name: copy.landing.footer.privacyPolicy })).toHaveAttribute("href", pageUrl("privacy", locale));
    expect(within(footer).getByRole("textbox", { name: copy.landing.footer.email })).toHaveAttribute("name", "email");
    expect(within(footer).getAllByRole("link", { name: /^(LinkedIn|Facebook|YouTube)$/ })).toHaveLength(3);
    expect(within(footer).getAllByRole("button", { name: /^(Instagram|TikTok)$/ })).toHaveLength(2);
    expect(footer).not.toHaveTextContent(locale === "bg" ? "Профилите скоро ще бъдат достъпни." : "Our profiles will be available soon.");
    expect(footer).not.toHaveTextContent(locale === "bg" ? "Абонаментът все още не е достъпен." : "Newsletter signup is not available yet.");
  });
  it("opens one privacy dialog for a plain click and preserves modified clicks", () => {
    const originalShow = HTMLDialogElement.prototype.showModal;
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
    try {
      render(<BgContacts />);
      const dialog = document.querySelector(".privacy-modal:not(.cookie-modal)") as HTMLDialogElement;
      const privacy = within(document.querySelector(".contact__privacy-row") as HTMLElement).getByRole("link", { name: messages.bg.contacts.privacyLink });
      fireEvent.click(privacy, { ctrlKey: true });
      expect(dialog).not.toHaveAttribute("open");
      fireEvent.click(privacy);
      expect(dialog).toHaveAttribute("open");
      expect(document.querySelectorAll(".privacy-modal:not(.cookie-modal)")).toHaveLength(1);
    } finally {
      HTMLDialogElement.prototype.showModal = originalShow;
    }
  });
  it.each([
    [BgHome, bgHomeMetadata, "bg", "home", "/bg"],
    [EnHome, enHomeMetadata, "en", "home", "/en"],
    [BgAbout, bgAboutMetadata, "bg", "about", "/about/bg"],
    [EnAbout, enAboutMetadata, "en", "about", "/about/en"],
    [BgBlog, bgBlogMetadata, "bg", "blog", "/blog/bg"],
    [EnBlog, enBlogMetadata, "en", "blog", "/blog/en"],
    [BgFaq, bgFaqMetadata, "bg", "faq", "/faq/bg"],
    [EnFaq, enFaqMetadata, "en", "faq", "/faq/en"],
    [BgContacts, bgContactsMetadata, "bg", "contacts", "/contacts/bg"],
    [EnContacts, enContactsMetadata, "en", "contacts", "/contacts/en"],
    [BgPrivacy, bgPrivacyMetadata, "bg", "privacy", "/privacy"],
    [EnPrivacy, enPrivacyMetadata, "en", "privacy", "/privacy/en"],
    [BgCookies, bgCookiesMetadata, "bg", "cookies", "/cookies"],
    [EnCookies, enCookiesMetadata, "en", "cookies", "/cookies/en"],
  ] as const)("renders localized content and public metadata %#", async (Page, metadata, locale, page, url) => {
    render(<Page />);
    const homeSeo = locale === "bg" ? {
      heading: "Стратегия, технологии и креативност се срещат в решения, които отличават брандовете и превръщат идеите в резултати",
      title: "Дигитална агенция за успешен бизнес | WebCreativeTeam",
      description: "Съчетаваме AI, SEO, маркетинг, брандинг и уеб решения в цялостни дигитални услуги, създадени да подкрепят развитието на вашата компания.",
    } : {
      heading: "Strategy, technology and creativity come together in solutions that make brands stand out and turn ideas into results",
      title: "Digital Agency for Business Success | WebCreativeTeam",
      description: "We combine AI, SEO, marketing, branding and web solutions into comprehensive digital services designed to support your company’s growth.",
    };
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(page === "home" ? homeSeo.heading : page === "faq" ? messages[locale].faq.eyebrow : messages[locale][page].title);
    const language = within(document.querySelector(".site-header") as HTMLElement).getByRole("navigation", { name: messages[locale].language, hidden: true });
    expect(within(language).getByRole("link", { name: locale.toUpperCase(), hidden: true })).toHaveAttribute("href", url);
    const alternate = locale === "bg" ? "en" : "bg";
    expect(within(language).getByRole("link", { name: alternate.toUpperCase(), hidden: true })).toHaveAttribute("href", pageUrl(page, alternate));
    const result = await metadata();
    if (page === "home") {
      expect(result.title).toBe(homeSeo.title);
      expect(result.description).toBe(homeSeo.description);
    }
    expect(result.alternates?.canonical).toBe(url);
    expect(result.robots).toEqual({ index: false, follow: false });
    expect(result.alternates?.languages).toEqual({ bg: pageUrl(page, "bg"), en: pageUrl(page, "en") });
    if (page === "privacy") {
      expect(screen.getByRole("main").querySelector("[lang='bg']")).toHaveTextContent(appConfig.legalName);
      expect(within(screen.getByRole("contentinfo")).getByRole("link", { name: messages[locale].landing.footer.privacy })).toHaveAttribute("aria-current", "page");
      expect(within(screen.getByRole("main")).getByRole("link", { name: messages[locale].privacy.complaintLink })).toHaveAttribute("href", appConfig.privacyAuthorityUrl);
    }
  });
  it("keeps the privacy copy's cookie durations aligned with configuration", () => {
    const cookieCopy = messages.bg.privacy.sections.find((section) => section.id === "cookies")?.paragraphs.join(" ");
    const retentionCopy = messages.bg.privacy.sections.find((section) => section.id === "retention")?.paragraphs.join(" ");
    expect(cookieCopy).toContain(`${appConfig.localeCookie.maxAgeSeconds / 86400} дни`);
    expect(cookieCopy).toContain(`${appConfig.auth.absoluteSeconds / 86400} дни`);
    expect(retentionCopy).toContain(`${appConfig.auth.auditRetentionSeconds / 86400} дни`);
  });
  it.each([
    [BgService, bgServiceMetadata, "bg"],
    [EnService, enServiceMetadata, "en"],
  ] as const)("renders the web solutions intro and sections in the active locale %#", async (Page, metadata, locale) => {
    const params = { params: Promise.resolve({ slug: "web-solutions" }) };
    render(await Page(params));
    const copy = messages[locale];
    const hero = copy.serviceDetails["web-solutions"].hero;
    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("data-service", "web-solutions");
    expect(within(main).getByRole("heading", { level: 1 })).toHaveAccessibleName(`${hero.title} ${hero.accent}`);
    expect(within(main).getByText(hero.eyebrow)).toBeInTheDocument();
    expect(within(main).getByText(hero.description)).toBeInTheDocument();
    expect(within(main).getByRole("img", { name: hero.imageAlt })).toHaveAttribute("src", expect.stringContaining("web_servicess_intro_image"));
    const sections = copy.serviceDetails["web-solutions"].sections;
    const headings = within(main).getAllByRole("heading", { level: 2 });
    expect(headings).toHaveLength(3);
    sections.forEach((section, index) => {
      expect(headings[index]).toHaveAttribute("id", ["web-development", "qa-testing", "web-maintenance"][index]);
      expect(headings[index]).toHaveAccessibleName(section.titleSegments.map((part) => part.text).join(" "));
      expect(within(main).getByText(section.eyebrow)).toBeInTheDocument();
      expect(within(main).getByText(section.body)).toBeInTheDocument();
      expect(within(main).getByRole("img", { name: section.imageAlt })).toHaveAttribute("src", expect.stringContaining(["web_develpoment_section_image", "QA_section_image", "web_maintanance_section_image"][index]));
    });
    expect(within(main).queryByRole("link", { name: copy.landing.hero.contact })).not.toBeInTheDocument();
    const links = within(within(main).getByRole("navigation", { name: copy.servicesLabel })).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(serviceSlugs.map((slug) => serviceUrl(slug, locale)));
    expect(links[4]).toHaveAttribute("aria-current", "page");
    const seo = await metadata(params);
    expect(seo.title).toBe(`${copy.serviceLinks[4]} | WebCreativeTeam`);
    expect(seo.alternates?.canonical).toBe(serviceUrl("web-solutions", locale));
    expect(seo.description).toBe(hero.description);
    expect(seo.robots).toEqual({ index: false, follow: false });
    const invalid = { params: Promise.resolve({ slug: "unknown" }) };
    await expect(Page(invalid)).rejects.toThrow();
    await expect(metadata(invalid)).rejects.toThrow();
  });
  it.each([
    [BgService, bgServiceMetadata, "bg"],
    [EnService, enServiceMetadata, "en"],
  ] as const)("renders the AI detail page while keeping locale and noindex %#", async (Page, metadata, locale) => {
    const params = { params: Promise.resolve({ slug: "ai-automation" }) };
    render(await Page(params));
    const copy = messages[locale];
    const main = screen.getByRole("main");
    expect(within(main).getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(within(main).getByRole("heading", { level: 1 })).toHaveAccessibleName(`${copy.serviceDetails["ai-automation"].hero.title} ${copy.serviceDetails["ai-automation"].hero.accent}`);
    if (locale === "bg") {
      expect(within(main).getByRole("heading", { level: 1 })).toHaveAccessibleName("AI Автоматизация");
    }
    const sections = copy.serviceDetails["ai-automation"].sections;
    const headings = within(main).getAllByRole("heading", { level: 2 });
    expect(headings).toHaveLength(sections.length);
    sections.forEach((section, index) => {
      expect(headings[index]).toHaveAccessibleName(section.titleSegments.map((part) => part.text).join(" "));
      expect(within(main).getByRole("img", { name: section.imageAlt })).toHaveAttribute("src", expect.any(String));
    });
    expect(within(main).getByRole("img", { name: copy.serviceDetails["ai-automation"].hero.imageAlt })).toHaveAttribute("src", expect.any(String));
    const navigation = within(main).getByRole("navigation", { name: copy.servicesLabel });
    const links = within(navigation).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(serviceSlugs.map((slug) => serviceUrl(slug, locale)));
    expect(links[0]).toHaveAttribute("aria-current", "page");
    expect(within(main).queryByRole("link", { name: copy.landing.hero.contact })).not.toBeInTheDocument();
    const seo = await metadata(params);
    if (locale === "bg") {
      expect(seo.title).toBe("AI автоматизация на бизнес процеси | WebCreativeTeam");
      expect(seo.description).toBe("Автоматизираме бизнес процеси и повтарящи се задачи с AI агенти и интелигентни решения, съобразени с нуждите на вашия бизнес.");
    } else {
      expect(seo.title).toBe(`${copy.serviceLinks[0]} | WebCreativeTeam`);
      expect(seo.description).toBe(copy.serviceDetails["ai-automation"].hero.description);
    }
    expect(seo.robots).toEqual({ index: false, follow: false });
  });
  it.each([
    [BgService, bgServiceMetadata, "bg"],
    [EnService, enServiceMetadata, "en"],
  ] as const)("renders the SEO & GEO intro and numbered sections in the active locale %#", async (Page, metadata, locale) => {
    const params = { params: Promise.resolve({ slug: "seo-geo" }) };
    render(await Page(params));
    const copy = messages[locale];
    const hero = copy.serviceDetails["seo-geo"].hero;
    const main = screen.getByRole("main");
    expect(within(main).getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(within(main).getByRole("heading", { level: 1 })).toHaveAccessibleName(`${hero.title} ${hero.accent}`);
    expect(within(main).getByText(hero.eyebrow)).toBeInTheDocument();
    expect(within(main).getByText(hero.description)).toBeInTheDocument();
    expect(within(main).getByRole("img", { name: hero.imageAlt })).toHaveAttribute("src", expect.stringContaining("SEO_and_Geo_intro_image"));
    const sections = copy.serviceDetails["seo-geo"].sections;
    const headings = within(main).getAllByRole("heading", { level: 2 });
    expect(headings).toHaveLength(3);
    sections.forEach((section, index) => {
      expect(headings[index]).toHaveAccessibleName(section.titleSegments.map((part) => part.text).join(" "));
      expect(headings[index]).toHaveAttribute("id", section.image);
      expect(within(main).getByText(section.eyebrow)).toBeInTheDocument();
      expect(within(main).getByText(section.body)).toBeInTheDocument();
      expect(within(main).getByRole("img", { name: section.imageAlt })).toHaveAttribute("src", expect.stringContaining(["SEO_optimization_section_image", "technical_SEO_section_image", "AAI_search_and_DEO_section_image"][index]));
    });
    expect(within(main).queryByRole("link", { name: copy.landing.hero.contact })).not.toBeInTheDocument();
    const navigation = within(main).getByRole("navigation", { name: copy.servicesLabel });
    const links = within(navigation).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(serviceSlugs.map((slug) => serviceUrl(slug, locale)));
    expect(links[1]).toHaveAttribute("aria-current", "page");
    const seo = await metadata(params);
    expect(seo.description).toBe(hero.description);
    expect(seo.robots).toEqual({ index: false, follow: false });
    expect(seo.alternates?.canonical).toBe(serviceUrl("seo-geo", locale));
    expect(seo.alternates?.languages).toEqual({ bg: serviceUrl("seo-geo", "bg"), en: serviceUrl("seo-geo", "en") });
  });
  it.each([
    [BgService, bgServiceMetadata, "bg"],
    [EnService, enServiceMetadata, "en"],
  ] as const)("renders the branding intro and its strategy section %#", async (Page, metadata, locale) => {
    const params = { params: Promise.resolve({ slug: "branding" }) };
    render(await Page(params));
    const copy = messages[locale];
    const hero = copy.serviceDetails.branding.hero;
    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("data-service", "branding");
    expect(within(main).getByRole("heading", { level: 1 })).toHaveAccessibleName(`${hero.title} ${hero.accent}`);
    expect(within(main).getByText(hero.eyebrow)).toBeInTheDocument();
    expect(within(main).getByText(hero.description)).toBeInTheDocument();
    expect(within(main).getByRole("img", { name: hero.imageAlt })).toHaveAttribute("src", expect.stringContaining("branding_intro_image"));
    const sections = copy.serviceDetails.branding.sections;
    const headings = within(main).getAllByRole("heading", { level: 2 });
    expect(headings).toHaveLength(3);
    sections.forEach((section, index) => {
      expect(headings[index]).toHaveAccessibleName(section.titleSegments.map((part) => part.text).join(" "));
      expect(headings[index]).toHaveAttribute("id", ["brand-strategy", "visual-identity", "brand-presence"][index]);
      expect(within(main).getByText(section.eyebrow)).toBeInTheDocument();
      expect(within(main).getByText(section.body)).toBeInTheDocument();
      expect(within(main).getByRole("img", { name: section.imageAlt })).toHaveAttribute("src", expect.stringContaining(["branding_strategy_image", "branding_identity_image", "branding_presence_image"][index]));
    });
    expect(within(main).queryByRole("link", { name: copy.landing.hero.contact })).not.toBeInTheDocument();
    const links = within(within(main).getByRole("navigation", { name: copy.servicesLabel })).getAllByRole("link");
    expect(links[3]).toHaveAttribute("aria-current", "page");
    const seo = await metadata(params);
    expect(seo.description).toBe(hero.description);
    expect(seo.robots).toEqual({ index: false, follow: false });
    expect(seo.alternates?.canonical).toBe(serviceUrl("branding", locale));
  });
  it.each([
    [BgService, bgServiceMetadata, "bg"],
    [EnService, enServiceMetadata, "en"],
  ] as const)("renders the digital marketing intro and its strategy section %#", async (Page, metadata, locale) => {
    const params = { params: Promise.resolve({ slug: "digital-marketing" }) };
    render(await Page(params));
    const copy = messages[locale];
    const hero = copy.serviceDetails["digital-marketing"].hero;
    const main = screen.getByRole("main");
    expect(main).toHaveAttribute("data-service", "digital-marketing");
    expect(within(main).getByRole("heading", { level: 1 })).toHaveAccessibleName(`${hero.title} ${hero.accent}`);
    expect(within(main).getByText(hero.eyebrow)).toBeInTheDocument();
    expect(within(main).getByText(hero.description)).toBeInTheDocument();
    expect(within(main).getByRole("img", { name: hero.imageAlt })).toHaveAttribute("src", expect.stringContaining("digital_marketing_intro_image"));
    const sections = copy.serviceDetails["digital-marketing"].sections;
    const headings = within(main).getAllByRole("heading", { level: 2 });
    expect(headings).toHaveLength(3);
    sections.forEach((section, index) => {
      expect(headings[index]).toHaveAccessibleName(section.titleSegments.map((part) => part.text).join(" "));
      expect(headings[index]).toHaveAttribute("id", ["marketing-strategy", "advertising-campaigns", "social-media"][index]);
      expect(within(main).getByText(section.eyebrow)).toBeInTheDocument();
      expect(within(main).getByText(section.body)).toBeInTheDocument();
      expect(within(main).getByRole("img", { name: section.imageAlt })).toHaveAttribute("src", expect.stringContaining(["Digital_Strategy_image", "advertising_campaigns_image", "Social_media_image"][index]));
    });
    expect(within(main).queryByRole("link", { name: copy.landing.hero.contact })).not.toBeInTheDocument();
    const links = within(within(main).getByRole("navigation", { name: copy.servicesLabel })).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(serviceSlugs.map((slug) => serviceUrl(slug, locale)));
    expect(links[2]).toHaveAttribute("aria-current", "page");
    const seo = await metadata(params);
    expect(seo.description).toBe(hero.description);
    expect(seo.robots).toEqual({ index: false, follow: false });
    expect(seo.alternates?.canonical).toBe(serviceUrl("digital-marketing", locale));
    expect(seo.alternates?.languages).toEqual({ bg: serviceUrl("digital-marketing", "bg"), en: serviceUrl("digital-marketing", "en") });
  });
  it.each([[BgLayout, "bg"], [EnLayout, "en"]] as const)("provides one complete locale document %#", async (Layout, lang) => {
    const html = await renderDocument(<Layout><main id="main">Content</main></Layout>);
    expect(html).toContain(`<html lang="${lang}">`);
    expect(html).toContain('href="#main"');
    expect(html.match(/<html/g)).toHaveLength(1);
  });
  it("renders a complete global 404 and translated fallback content", async () => {
    expect(await renderDocument(<GlobalNotFound />)).toContain('<html lang="bg">');
    render(<NotFoundPage locale="en" />);
    expect(screen.getByRole("heading")).toHaveTextContent("Page not found");
    expect(screen.getByRole("link")).toHaveAttribute("href", "/en");
  });
  it("recognizes only supported languages and keeps only path canonical redirects in Next", () => {
    expect(isLocale("bg")).toBe(true); expect(isLocale("en")).toBe(true);
    expect(isLocale("fr")).toBe(false); expect(isLocale("BG")).toBe(false);
    expect(canonicalRedirects).toEqual([
      { source: "/bg/about", destination: "/about/bg", permanent: true },
      { source: "/en/about", destination: "/about/en", permanent: true },
    ]);
  });
  it("builds equivalent language URLs for pages and services", () => {
    expect(localeSwitchUrl({ page: "blog" }, "en")).toBe(pageUrl("blog", "en"));
    expect(localeSwitchUrl({ page: "home" }, "bg", "#services")).toBe(`${pageUrl("home", "bg")}#services`);
    expect(localeSwitchUrl({ page: "service", serviceSlug: "branding" }, "en")).toBe(serviceUrl("branding", "en"));
    expect(localeSwitchUrl({ page: "service", serviceSlug: "branding" }, "bg", "#services")).toBe(serviceUrl("branding", "bg"));
    expect(localeSwitchUrl({ page: "contacts" }, "en")).toBe(pageUrl("contacts", "en"));
  });
  it("validates the configured origin rather than trusting request headers", async () => {
    expect(siteOrigin({}).origin).toBe(localOrigin(appConfig.localHost, appConfig.defaultPort));
    expect(siteOrigin({ PORT: "4123" }).origin).toBe(localOrigin(appConfig.localHost, 4123));
    expect(siteOrigin({ SITE_URL: "https://example.com" }).origin).toBe("https://example.com");
    for (const url of ["bad", "ftp://example.com", "https://user:pass@example.com", "https://example.com/path", "https://example.com?q=x", "https://example.com/#hash"]) {
      expect(() => siteOrigin({ SITE_URL: url })).toThrow();
    }
    vi.stubEnv("SITE_URL", "https://test.example");
    expect((await bgHomeMetadata()).metadataBase?.toString()).toBe("https://test.example/");
    vi.unstubAllEnvs();
  });
  it("keeps the active locale preference in sync with navigation and restored pages", () => {
    const copy = navigationCopy();
    expect(document.cookie).not.toContain(`${appConfig.localeCookie.name}=`);
    const view = render(<SiteNavigation locale="en" page="blog" copy={copy} />);
    expect(document.cookie).toContain(`${appConfig.localeCookie.name}=en`);
    view.rerender(<SiteNavigation locale="bg" page="blog" copy={copy} />);
    expect(document.cookie).toContain(`${appConfig.localeCookie.name}=bg`);
    document.cookie = `${appConfig.localeCookie.name}=en; Path=/`;
    fireEvent(window, new Event("pageshow"));
    expect(document.cookie).toContain(`${appConfig.localeCookie.name}=bg`);
    document.cookie = `${appConfig.localeCookie.name}=en; Path=/`;
    fireEvent(document, new Event("visibilitychange"));
    expect(document.cookie).toContain(`${appConfig.localeCookie.name}=bg`);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    document.cookie = `${appConfig.localeCookie.name}=en; Path=/`;
    fireEvent(document, new Event("visibilitychange"));
    expect(document.cookie).toContain(`${appConfig.localeCookie.name}=en`);
  });
  it("shows the first-visit dialog in the page language and saves acceptance immediately", () => {
    const originalShow = HTMLDialogElement.prototype.showModal;
    const originalClose = HTMLDialogElement.prototype.close;
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); };
    document.cookie = `${appConfig.cookieChoice.name}=; Max-Age=0; Path=/`;
    try {
      render(<EnHome />);
      const dialog = document.querySelector(".cookie-modal") as HTMLDialogElement;
      expect(dialog).toHaveAttribute("open");
      expect(dialog).toHaveAttribute("lang", "en");
      expect(within(dialog).getByRole("heading", { name: messages.en.cookies.dialogTitle })).toBeVisible();
      fireEvent.click(within(dialog).getByRole("button", { name: messages.en.cookies.acceptAll }));
      expect(document.cookie).toContain(`${appConfig.cookieChoice.name}=${appConfig.cookieChoice.version}.all`);
      expect(document.cookie).toContain(`${appConfig.localeCookie.name}=en`);
      expect(dialog).not.toHaveAttribute("open");
    } finally {
      HTMLDialogElement.prototype.showModal = originalShow;
      HTMLDialogElement.prototype.close = originalClose;
    }
  });
  it("makes both refusal buttons remove the language preference", () => {
    const originalShow = HTMLDialogElement.prototype.showModal;
    const originalClose = HTMLDialogElement.prototype.close;
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); };
    try {
      for (const [label, value] of [[messages.bg.cookies.rejectAll, "rejected"], [messages.bg.cookies.necessaryOnly, "necessary"]]) {
        document.cookie = `${appConfig.cookieChoice.name}=${appConfig.cookieChoice.version}.all; Path=/`;
        document.cookie = `${appConfig.localeCookie.name}=en; Path=/`;
        const view = render(<BgHome />);
        fireEvent.click(within(screen.getByRole("contentinfo")).getByRole("link", { name: messages.bg.landing.footer.cookies }));
        const dialog = document.querySelector(".cookie-modal") as HTMLDialogElement;
        fireEvent.click(within(dialog).getByRole("button", { name: label }));
        expect(document.cookie).toContain(`${appConfig.cookieChoice.name}=${appConfig.cookieChoice.version}.${value}`);
        expect(document.cookie).not.toContain(`${appConfig.localeCookie.name}=`);
        view.unmount();
      }
    } finally {
      HTMLDialogElement.prototype.showModal = originalShow;
      HTMLDialogElement.prototype.close = originalClose;
    }
  });
  it("does not trap visitors when their browser blocks cookie writes", () => {
    const originalCookie = Object.getOwnPropertyDescriptor(document, "cookie");
    const originalShow = HTMLDialogElement.prototype.showModal;
    const originalClose = HTMLDialogElement.prototype.close;
    Object.defineProperty(document, "cookie", { configurable: true, get: () => "", set: () => {} });
    HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
    HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); this.dispatchEvent(new Event("close")); };
    try {
      const first = render(<BgHome />);
      const dialog = document.querySelector(".cookie-modal") as HTMLDialogElement;
      expect(dialog).toHaveAttribute("open");
      fireEvent.click(within(dialog).getByRole("button", { name: messages.bg.cookies.necessaryOnly }));
      expect(dialog).not.toHaveAttribute("open");
      fireEvent(window, new Event("pageshow"));
      expect(dialog).not.toHaveAttribute("open");
      first.unmount();
      render(<BgHome />);
      const reopened = document.querySelector(".cookie-modal") as HTMLDialogElement;
      expect(reopened).toHaveAttribute("open");
      fireEvent.click(within(reopened).getByRole("button", { name: messages.bg.cookies.closeLabel }));
      fireEvent(window, new Event("pageshow"));
      expect(reopened).not.toHaveAttribute("open");
    } finally {
      if (originalCookie) Object.defineProperty(document, "cookie", originalCookie);
      else Reflect.deleteProperty(document, "cookie");
      HTMLDialogElement.prototype.showModal = originalShow;
      HTMLDialogElement.prototype.close = originalClose;
    }
  });
  it("switches the locale of the current service without the retired contact anchor", () => {
    const copy = navigationCopy();
    window.location.hash = "#footer-contact";
    render(<SiteNavigation locale="en" page="service" serviceSlug="branding" copy={copy} />);
    const language = screen.getByRole("navigation", { name: "Language", hidden: true });
    expect(within(language).getByRole("link", { name: "BG", hidden: true })).toHaveAttribute("href", serviceUrl("branding", "bg"));
  });
  it("opens nested services on mobile and closes each menu layer with Escape", () => {
    Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: true }) });
    const { container } = render(<SiteNavigation locale="bg" page="home" copy={navigationCopy()} />);
    const menu = container.querySelector<HTMLDetailsElement>(".site-menu")!;
    const services = container.querySelector<HTMLDetailsElement>(".site-menu__services details")!;
    menu.open = true;
    fireEvent(menu, new Event("toggle", { bubbles: true }));
    expect(services.open).toBe(true);
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(services.open).toBe(false);
    expect(menu.open).toBe(true);
    fireEvent.keyDown(menu, { key: "Escape" });
    expect(menu.open).toBe(false);
    fireEvent.keyDown(menu, { key: "Escape" });
  });
  it("ignores desktop hover and closes the open menu after navigation", () => {
    Object.defineProperty(window, "matchMedia", { configurable: true, value: () => ({ matches: false }) });
    const { container } = render(<SiteNavigation locale="en" page="about" copy={navigationCopy()} />);
    const menu = container.querySelector<HTMLDetailsElement>(".site-menu")!;
    const services = container.querySelector<HTMLDetailsElement>(".site-menu__services details")!;
    const surface = container.querySelector<HTMLElement>(".site-menu__services")!;
    menu.open = true;
    fireEvent(menu, new Event("toggle", { bubbles: true }));
    expect(services.open).toBe(false);
    fireEvent.pointerEnter(surface, { pointerType: "touch" });
    expect(services.open).toBe(false);
    fireEvent.pointerEnter(surface, { pointerType: "mouse" });
    expect(services.open).toBe(false);
    fireEvent.pointerLeave(surface, { pointerType: "touch" });
    expect(services.open).toBe(false);
    fireEvent.pointerLeave(surface, { pointerType: "mouse" });
    expect(services.open).toBe(false);
    services.open = true;
    fireEvent.click(within(screen.getByRole("navigation", { name: "Navigation", hidden: true })).getByRole("link", { name: "Contact", hidden: true }));
    expect(services.open).toBe(false);
    expect(menu.open).toBe(false);
  });
  it("keeps only shared anchors while changing languages", () => {
    window.location.hash = "#services";
    render(<SiteNavigation locale="en" page="home" copy={navigationCopy()} />);
    const language = screen.getByRole("navigation", { name: "Language", hidden: true });
    expect(within(language).getByRole("link", { name: "BG", hidden: true })).toHaveAttribute("href", "/bg#services");
    window.location.hash = "#unrelated";
    fireEvent(window, new Event("hashchange"));
    expect(within(language).getByRole("link", { name: "BG", hidden: true })).toHaveAttribute("href", "/bg");
  });
  it("rejects mismatched service labels before rendering navigation", () => {
    expect(() => render(<SiteNavigation locale="en" page="home" copy={{ ...navigationCopy(), serviceLinks: [] }} />)).toThrow("Expected 5 service navigation labels");
  });
});
