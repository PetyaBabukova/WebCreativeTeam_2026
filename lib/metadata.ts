import type { Metadata } from "next";
import { connection } from "next/server";
import { pageUrl, serviceSlugs, serviceUrl, type Locale, type Page, type ServiceSlug } from "./routing";
import { messages } from "./messages";
import { siteOrigin } from "./config";

export async function pageMetadata(page: Page, locale: Locale): Promise<Metadata> {
  // Resolve the deployment origin at request time, not from the build machine.
  await connection();
  return {
    metadataBase: siteOrigin(),
    title: `${messages[locale][page].title} | WebCreativeTeam`,
    description: messages[locale][page].description,
    // Remove the temporary noindex policy when real public content is approved.
    robots: { index: false, follow: false },
    alternates: {
      canonical: pageUrl(page, locale),
      languages: { bg: pageUrl(page, "bg"), en: pageUrl(page, "en") },
    },
  };
}

export async function serviceMetadata(slug: ServiceSlug, locale: Locale): Promise<Metadata> {
  await connection();
  const detail = slug === "ai-automation" ? messages[locale].serviceDetails["ai-automation"] : undefined;
  return {
    metadataBase: siteOrigin(),
    title: `${messages[locale].serviceLinks[serviceSlugs.indexOf(slug)]} | WebCreativeTeam`,
    description: detail?.hero.description,
    robots: { index: false, follow: false },
    alternates: {
      canonical: serviceUrl(slug, locale),
      languages: { bg: serviceUrl(slug, "bg"), en: serviceUrl(slug, "en") },
    },
  };
}
