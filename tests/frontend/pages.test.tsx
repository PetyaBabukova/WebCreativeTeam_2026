import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import BgHome, { generateMetadata as bgHomeMetadata } from "@/app/(bg)/bg/page";
import EnHome, { generateMetadata as enHomeMetadata } from "@/app/(en)/en/page";
import BgAbout, { generateMetadata as bgAboutMetadata } from "@/app/(bg)/about/bg/page";
import EnAbout, { generateMetadata as enAboutMetadata } from "@/app/(en)/about/en/page";
import BgLayout from "@/app/(bg)/layout";
import EnLayout from "@/app/(en)/layout";
import GlobalNotFound from "@/app/global-not-found";
import NotFoundPage from "@/components/NotFoundPage";
import { messages } from "@/lib/messages";
import { isLocale, canonicalRedirects } from "@/lib/routing";
import { appConfig, localOrigin, siteOrigin } from "@/lib/config";

vi.mock("next/server", () => ({ connection: vi.fn(async () => {}) }));

describe("public pages", () => {
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
  it.each([
    [BgHome, bgHomeMetadata, "bg", "home", "/bg"],
    [EnHome, enHomeMetadata, "en", "home", "/en"],
    [BgAbout, bgAboutMetadata, "bg", "about", "/about/bg"],
    [EnAbout, enAboutMetadata, "en", "about", "/about/en"],
  ] as const)("renders localized content and public metadata %#", async (Page, metadata, locale, page, url) => {
    render(<Page />);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(page === "home" ? messages[locale].landing.hero.lines.join(" ") : messages[locale].about.title);
    const language = screen.getByRole("navigation", { name: messages[locale].language, hidden: true });
    expect(within(language).getByRole("link", { name: locale.toUpperCase(), hidden: true })).toHaveAttribute("href", url);
    const alternate = locale === "bg" ? "en" : "bg";
    expect(within(language).getByRole("link", { name: alternate.toUpperCase(), hidden: true })).toHaveAttribute("href", url.replace(/(bg|en)$/, alternate));
    const result = await metadata();
    expect(result.alternates?.canonical).toBe(url);
    expect(result.robots).toEqual({ index: false, follow: false });
    expect(result.alternates?.languages).toEqual(page === "home" ? { bg: "/bg", en: "/en" } : { bg: "/about/bg", en: "/about/en" });
  });
  it.each([[BgLayout, "bg"], [EnLayout, "en"]] as const)("provides one complete locale document %#", (Layout, lang) => {
    const html = renderToStaticMarkup(<Layout><main id="main">Content</main></Layout>);
    expect(html).toContain(`<html lang="${lang}">`);
    expect(html).toContain('href="#main"');
    expect(html.match(/<html/g)).toHaveLength(1);
  });
  it("renders a complete global 404 and translated fallback content", () => {
    expect(renderToStaticMarkup(<GlobalNotFound />)).toContain('<html lang="bg">');
    render(<NotFoundPage locale="en" />);
    expect(screen.getByRole("heading")).toHaveTextContent("Page not found");
    expect(screen.getByRole("link")).toHaveAttribute("href", "/en");
  });
  it("recognizes only supported languages and canonical redirects", () => {
    expect(isLocale("bg")).toBe(true); expect(isLocale("en")).toBe(true);
    expect(isLocale("fr")).toBe(false); expect(isLocale("BG")).toBe(false);
    expect(canonicalRedirects).toEqual([
      { source: "/", destination: "/bg", permanent: false },
      { source: "/bg/about", destination: "/about/bg", permanent: true },
      { source: "/en/about", destination: "/about/en", permanent: true },
    ]);
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
});
