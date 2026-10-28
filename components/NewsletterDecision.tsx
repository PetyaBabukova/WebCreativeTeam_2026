"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { appConfig, localizedPath, type Locale } from "@/lib/config";
import "./NewsletterDecision.css";

export default function NewsletterDecision({ locale, action }: { locale: Locale; action: "confirm" | "decline" }) {
  const [token, setToken] = useState("");
  const [state, setState] = useState<"ready" | "working" | "done" | "invalid" | "error">("ready");
  const bg = locale === "bg";

  useEffect(() => {
    const hash = new URLSearchParams(window.location.hash.slice(1));
    const fragmentToken = hash.get("token");
    if (fragmentToken) setToken(fragmentToken);
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
  }, []);

  async function decide() {
    if (state === "working") return;
    if (!token) { setState("invalid"); return; }
    setState("working");
    try {
      const response = await fetch(`${appConfig.paths.newsletterApi}/decision`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, token }),
        signal: AbortSignal.timeout(appConfig.contact.requestTimeoutMilliseconds),
      });
      setState(response.ok ? "done" : response.status === 400 ? "invalid" : "error");
    } catch { setState("error"); }
  }

  const title = action === "confirm" ? bg ? "Потвърдете абонамента" : "Confirm subscription" : bg ? "Откажете заявката или се отпишете" : "Decline or unsubscribe";
  const done = action === "confirm" ? bg ? "Абонаментът е потвърден." : "Your subscription is confirmed." : bg ? "Заявката е отказана или абонаментът е прекратен." : "The request was declined or the subscription was cancelled.";
  return <main id="main" className="newsletter-decision">
    <div className="newsletter-decision__card">
      <p className="newsletter-decision__eyebrow">WebCreativeTeam</p>
      <h1>{title}</h1>
      {state === "done" ? <p role="status">{done}</p>
        : state === "invalid" ? <p role="alert">{bg ? "Линкът е невалиден или е изтекъл." : "This link is invalid or has expired."}</p>
          : state === "error" ? <p role="alert">{bg ? "Възникна проблем. Моля, опитайте отново или ни пишете на info@webcreativeteam.com." : "Something went wrong. Please try again or email info@webcreativeteam.com."}</p>
            : <p>{action === "confirm" ? bg ? "Натиснете бутона, за да получавате новини и полезно съдържание." : "Use the button to receive news and useful content." : bg ? "Натиснете бутона, за да откажете заявката или да спрете бюлетина." : "Use the button to decline the request or stop the newsletter."}</p>}
      {state !== "done" && state !== "invalid" ? <button className="button button--outline" type="button" disabled={state === "working"} onClick={() => void decide()}>{state === "working" ? bg ? "Обработваме…" : "Processing…" : action === "confirm" ? bg ? "Потвърждавам" : "Confirm" : bg ? "Отказвам / Отписвам се" : "Decline / Unsubscribe"}</button> : null}
      <Link href={localizedPath(appConfig.paths.root, locale)}>{bg ? "Към началната страница" : "Back to home"}</Link>
      <noscript><p>{bg ? "За действие без JavaScript ни пишете на info@webcreativeteam.com." : "To continue without JavaScript, email info@webcreativeteam.com."}</p></noscript>
    </div>
  </main>;
}
