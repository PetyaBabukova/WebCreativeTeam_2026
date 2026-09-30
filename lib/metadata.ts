import type { Metadata } from "next";
import { connection } from "next/server";
import { pageUrl, type Locale, type Page } from "./routing";
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
