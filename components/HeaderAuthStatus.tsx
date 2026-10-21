"use client";

import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { appConfig, type Locale } from "@/lib/config";

type Status = { username: string; logoutCsrf: string } | null;
type AuthContext = { status: Status; logout: () => Promise<void>; error: string };
const Context = createContext<AuthContext | null>(null);

export function HeaderAuthProvider({ children, locale }: { children: ReactNode; locale: Locale }) {
  const [status, setStatus] = useState<Status>(null);
  const [error, setError] = useState("");
  const lastChecked = useRef(0);
  const pending = useRef(false);
  const refresh = useCallback(async (force = false) => {
    if (pending.current || !force && Date.now() - lastChecked.current < 30_000) return;
    pending.current = true;
    try {
      const response = await fetch(`${appConfig.paths.authApi}/status`, { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) { setStatus(null); return; }
      const data = await response.json();
      setStatus(data.authenticated ? { username: data.username, logoutCsrf: data.logoutCsrf } : null);
      lastChecked.current = Date.now();
    } catch { setStatus(null); }
    finally { pending.current = false; }
  }, []);

  useEffect(() => {
    void refresh();
    const onPageShow = (event: PageTransitionEvent) => { void refresh(event.persisted); };
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    window.addEventListener("pageshow", onPageShow);
    document.addEventListener("visibilitychange", onVisible);
    let channel: BroadcastChannel | undefined;
    try { channel = new BroadcastChannel("wct-admin"); channel.onmessage = () => { void refresh(true); }; } catch { /* unsupported browser */ }
    return () => { window.removeEventListener("pageshow", onPageShow); document.removeEventListener("visibilitychange", onVisible); channel?.close(); };
  }, [refresh]);

  const logout = useCallback(async () => {
    if (!status) return;
    setError("");
    try {
      const send = (token: string) => fetch(`${appConfig.paths.authApi}/logout`, { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "x-csrf-token": token } });
      let response = await send(status.logoutCsrf);
      if (response.status === 403) {
        const checked = await fetch(`${appConfig.paths.authApi}/status`, { cache: "no-store", credentials: "same-origin" });
        if (!checked.ok) throw new Error("Session check failed");
        const current = await checked.json();
        response = await send(current.logoutCsrf ?? "");
      }
      if (!response.ok) throw new Error("Logout failed");
      setStatus(null);
      try { const channel = new BroadcastChannel("wct-admin"); channel.postMessage("logout"); channel.close(); } catch { /* unsupported browser */ }
      document.querySelector<HTMLElement>(".site-header__brand")?.focus();
      if (window.location.pathname.startsWith(appConfig.paths.admin)) window.location.replace(`${appConfig.paths.admin}/login`);
    } catch { setError(locale === "bg" ? "Изходът не бе потвърден. Сесията може да е активна." : "Log out was not confirmed. Your session may still be active."); }
  }, [status, locale]);

  return <Context.Provider value={{ status, logout, error }}>{children}</Context.Provider>;
}

export function HeaderAuthStatus({ locale, mobile = false }: { locale: Locale; mobile?: boolean }) {
  const state = useContext(Context);
  if (!state?.status) return null;
  const name = state.status.username;
  const base = locale === "en" ? `${appConfig.paths.admin}/en` : appConfig.paths.admin;
  return <div className={mobile ? "site-auth site-auth--mobile" : "site-auth site-auth--desktop"}>
    <Link href={`${base}/profile`} title={name}>{locale === "bg" ? "Здравей" : "Hello"}, <span className="site-auth__name">{name}</span></Link>
    <span aria-hidden="true">|</span>
    <button type="button" onClick={() => void state.logout()}>{locale === "bg" ? "Изход" : "Log out"}</button>
    {state.error && <span role="alert" className="site-auth__error">{state.error}</span>}
  </div>;
}
