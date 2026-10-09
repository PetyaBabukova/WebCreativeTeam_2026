import type { ReactNode } from "react";
import { Sofia_Sans } from "next/font/google";
import { messages } from "@/lib/messages";
import type { Locale } from "@/lib/routing";
import "@/styles/globals.css";

const sofiaSans = Sofia_Sans({ subsets: ["latin", "cyrillic"], display: "swap", variable: "--font-sofia-sans" });
/*
  User decision, 9 October 2026: a reload always starts at the top of the page.
  Restoring the old scroll position painted the scroll-driven sections (services stack, header state) in their
  server-rendered state for a few frames before hydration rearranged them, which looked like a flash.
  Chrome decides whether to restore from the mode of the page being left, so the leaving page sets "manual" on pagehide.
  The new page returns to "auto" on the visitor's first interaction (which also cancels any pending restore), so in-site
  back/forward between client-side navigations keeps its positions. A full-page back/forward without bfcache also starts at the top.
  A URL with a #section target keeps the browser default, so reloading a deep link returns to that section.
*/
const reloadStartsAtTop = `(()=>{try{if(!("scrollRestoration" in history))return;const events=["wheel","touchstart","pointerdown","keydown"];const useAuto=()=>{history.scrollRestoration="auto";events.forEach((e)=>removeEventListener(e,useAuto,true))};events.forEach((e)=>addEventListener(e,useAuto,{capture:true,passive:true}));addEventListener("pagehide",()=>{if(!location.hash)history.scrollRestoration="manual"});addEventListener("pageshow",(e)=>{if(e.persisted)history.scrollRestoration="auto"})}catch(e){}})()`;
const noScriptHeroVisibility = ".hero__headline-line,.hero__lede,.hero-orb__entrance{opacity:1!important;transform:none!important}.hero-orb__control{display:none!important}";

export default function SiteDocument({ locale, children }: { locale: Locale; children: ReactNode }) {
  return <html lang={locale}><body className={sofiaSans.variable}>
    <script dangerouslySetInnerHTML={{ __html: reloadStartsAtTop }} />
    <noscript><style>{noScriptHeroVisibility}</style></noscript>
    <a className="skip-link" href="#main">{messages[locale].skip}</a>
    {children}
  </body></html>;
}
