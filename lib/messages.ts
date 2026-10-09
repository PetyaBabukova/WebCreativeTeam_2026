import bg from "../messages/bg.json";
import en from "../messages/en.json";
import type { Locale, ServiceSlug } from "./routing";

export const messages = { bg, en };

export function serviceDetail(locale: Locale, slug: ServiceSlug) {
  const details = messages[locale].serviceDetails;
  return slug in details ? details[slug as keyof typeof details] : undefined;
}
