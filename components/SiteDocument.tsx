import type { ReactNode } from "react";
import { Sofia_Sans } from "next/font/google";
import { messages } from "@/lib/messages";
import type { Locale } from "@/lib/routing";
import "@/styles/globals.css";

const sofiaSans = Sofia_Sans({ subsets: ["latin", "cyrillic"], display: "swap", variable: "--font-sofia-sans" });
const noScriptHeroVisibility = ".hero__headline-line,.hero__lede,.hero-orb__entrance{opacity:1!important;transform:none!important}.hero-orb__control{display:none!important}";

export default function SiteDocument({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <html lang={locale}><body className={sofiaSans.variable}>
    <noscript><style>{noScriptHeroVisibility}</style></noscript>
    <a className="skip-link" href="#main">{messages[locale].skip}</a>
    {children}
  </body></html>;
}
