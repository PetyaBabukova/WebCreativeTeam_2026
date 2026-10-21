"use client";

import Image from "next/image";
import Link from "next/link";
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type FormEvent } from "react";
import { appConfig, type Locale } from "@/lib/config";
import "./AuthScreen.css";

export type AuthView = "login" | "forgot" | "invite" | "reset" | "email" | "home" | "profile" | "administrators";
type Admin = { id: string; email: string; username: string; status: string };
type Device = { id: string; deviceLabel: string; createdAt: string; lastSeenAt: string; current: boolean };
type User = { id: string; email: string; username: string; csrf: string };
type Copy = (typeof words)[Locale];
const FormLocale = createContext<Locale>("bg");

const words = {
  bg: {
    signIn: "Вход", email: "Имейл", password: "Парола", forgot: "Забравена парола?", send: "Изпрати линк", checkEmail: "Ако адресът е регистриран, ще получите линк за възстановяване.",
    newPassword: "Нова парола", confirmPassword: "Потвърдете паролата", show: "Покажи", hide: "Скрий", invite: "Приемане на покана", reset: "Възстановяване на парола", emailConfirm: "Потвърждение на имейл", username: "Име за показване", accept: "Създай акаунт", save: "Запази", loading: "Моля, изчакайте…", invalid: "Връзката е невалидна или изтекла.", openLink: "Отворете отново линка от имейла.", mismatch: "Паролите не съвпадат.", minPassword: "Поне 15 знака. Може да ползвате интервали и мениджър за пароли.", error: "Действието не бе изпълнено. Проверете данните и опитайте отново.", unavailable: "Услугата е временно недостъпна. Опитайте по-късно.", limited: "Твърде много опити. Опитайте след малко.", home: "Администрация", profile: "Профил", administrators: "Администратори", logout: "Изход", greeting: "Здравей", changePassword: "Смяна на парола", changeEmail: "Смяна на имейл", currentPassword: "Текуща парола", changeName: "Промяна на име", devices: "Устройства", revoke: "Прекрати сесия", revokeAll: "Изход от всички устройства", inviteAdmin: "Покани администратор", inviteSent: "Поканата е изпратена.", pending: "Чакащи покани", cancel: "Отмени покана", disable: "Деактивирай", reactivate: "Изпрати линк за реактивиране", delete: "Изтрий окончателно", active: "Активен", disabled: "Деактивиран", done: "Промяната е запазена.", confirmAction: "Потвърждавате ли действието?", confirmEmail: "За окончателно изтриване напишете имейла на акаунта", back: "Към сайта", loginAgain: "Към входа",
  },
  en: {
    signIn: "Sign in", email: "Email", password: "Password", forgot: "Forgot password?", send: "Send link", checkEmail: "If this address has an account, a recovery link will be sent.",
    newPassword: "New password", confirmPassword: "Confirm password", show: "Show", hide: "Hide", invite: "Accept invitation", reset: "Reset password", emailConfirm: "Confirm email", username: "Display name", accept: "Create account", save: "Save", loading: "Please wait…", invalid: "This link is invalid or has expired.", openLink: "Open the link from your email again.", mismatch: "Passwords do not match.", minPassword: "At least 15 characters. Spaces and password managers are welcome.", error: "The action could not be completed. Check the details and try again.", unavailable: "The service is temporarily unavailable. Try later.", limited: "Too many attempts. Try again shortly.", home: "Administration", profile: "Profile", administrators: "Administrators", logout: "Log out", greeting: "Hello", changePassword: "Change password", changeEmail: "Change email", currentPassword: "Current password", changeName: "Change display name", devices: "Devices", revoke: "End session", revokeAll: "Log out of all devices", inviteAdmin: "Invite administrator", inviteSent: "Invitation sent.", pending: "Pending invitations", cancel: "Cancel invitation", disable: "Disable", reactivate: "Send reactivation link", delete: "Delete permanently", active: "Active", disabled: "Disabled", done: "Changes saved.", confirmAction: "Confirm this action?", confirmEmail: "Type the account email to delete permanently", back: "Back to site", loginAgain: "Sign in",
  },
} as const;

async function api(path: string, body?: Record<string, unknown>, csrf?: string, signal?: AbortSignal) {
  const response = await fetch(`${appConfig.paths.authApi}${path}`, {
    method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store",
    signal,
    headers: body ? { "Content-Type": "application/json", ...(csrf ? { "x-csrf-token": csrf } : {}) } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await response.json().catch(() => ({}));
  return { response, data };
}

function Field({ label, name, type = "text", autoComplete, defaultValue, required = true }: { label: string; name: string; type?: string; autoComplete?: string; defaultValue?: string; required?: boolean }) {
  const [visible, setVisible] = useState(false);
  const id = useId();
  const locale = useContext(FormLocale);
  const password = type === "password";
  return <div className="form-field"><label htmlFor={id}>{label}</label><span className="form-field__control"><input id={id} name={name} type={password && visible ? "text" : type} autoComplete={autoComplete} defaultValue={defaultValue} required={required} minLength={password && autoComplete === "new-password" ? appConfig.auth.passwordMinLength : undefined} />{password && <button type="button" className="form-field__reveal" onClick={() => setVisible(!visible)} aria-label={locale === "bg" ? (visible ? "Скрий паролата" : "Покажи паролата") : (visible ? "Hide password" : "Show password")}>{visible ? "●" : "◯"}</button>}</span></div>;
}

export default function AuthScreen({ locale: initialLocale, view, base, returnTo, user }: { locale: Locale; view: AuthView; base: string; returnTo: string; user?: User }) {
  const [locale, setLocale] = useState(initialLocale);
  const t: Copy = words[locale];
  const [busy, setBusy] = useState(false);
  const [notice, setNoticeState] = useState<{ message: string; kind: "error" | "success" } | null>(null);
  const errorNoticeRef = useRef<HTMLParagraphElement>(null);
  const successNoticeRef = useRef<HTMLParagraphElement>(null);
  function setNotice(message: string, kind: "error" | "success" = "error") {
    setNoticeState(message ? { message, kind } : null);
  }
  const [token, setToken] = useState("");
  const [tokenValid, setTokenValid] = useState<boolean | null>(null);
  const [tokenCheckError, setTokenCheckError] = useState<"limited" | "unavailable" | null>(null);
  const [tokenKind, setTokenKind] = useState("");
  const tokenRef = useRef<{ view: AuthView; value: string } | null>(null);
  const [reauthPassword, setReauthPassword] = useState("");
  const [admins, setAdmins] = useState<Admin[]>([]);
  const [invitations, setInvitations] = useState<{ id: string; email: string }[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [privateVisible, setPrivateVisible] = useState(true);
  const isPrivate = Boolean(user);

  useEffect(() => { if (notice) (notice.kind === "success" ? successNoticeRef : errorNoticeRef).current?.focus(); }, [notice]);

  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  useEffect(() => {
    if (view !== "invite" && view !== "reset" && view !== "email") return;
    const hashToken = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
    const value = hashToken || (tokenRef.current?.view === view ? tokenRef.current.value : "");
    if (value) tokenRef.current = { view, value };
    window.history.replaceState(null, "", window.location.pathname);
    if (!value) { setTokenValid(false); return; }
    setToken(value);
    setTokenValid(null);
    setTokenCheckError(null);
    setTokenKind("");
    const kinds = view === "reset" ? ["reset"] : view === "email" ? ["email-change"] : ["bootstrap", "invitation", "reactivation"];
    const controller = new AbortController();
    let cancelled = false;
    void (async () => {
      for (const kind of kinds) {
        const result = await api("/token/check", { token: value, kind }, undefined, controller.signal);
        if (cancelled) return;
        if (!result.response.ok) {
          setTokenCheckError(result.response.status === 429 ? "limited" : "unavailable");
          setTokenValid(false);
          return;
        }
        if (result.data.valid === true) { setTokenKind(kind); setTokenValid(true); return; }
        if (result.data.valid !== false) { setTokenCheckError("unavailable"); setTokenValid(false); return; }
      }
      if (!cancelled) setTokenValid(false);
    })().catch(() => { if (!cancelled) { setTokenCheckError("unavailable"); setTokenValid(false); } });
    return () => { cancelled = true; controller.abort(); };
  }, [view]);

  const loadPrivate = useCallback(async () => {
    if (view === "administrators") {
      const result = await api("/administrators");
      if (result.response.ok) { setAdmins(result.data.administrators); setInvitations(result.data.invitations); }
    }
    if (view === "profile") {
      const result = await api("/sessions");
      if (result.response.ok) setDevices(result.data.sessions);
    }
  }, [view]);

  useEffect(() => { if (isPrivate) void loadPrivate(); }, [isPrivate, loadPrivate]);
  useEffect(() => {
    if (!isPrivate) return;
    const hide = () => setPrivateVisible(false);
    const check = () => {
      void api("/status").then(({ data }) => {
        if (!data.authenticated) window.location.replace(`${base}/login`);
        else setPrivateVisible(true);
      }).catch(() => setPrivateVisible(false));
    };
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", check);
    let channel: BroadcastChannel | undefined;
    try { channel = new BroadcastChannel("wct-admin"); channel.onmessage = () => { hide(); check(); }; } catch { /* unsupported browser */ }
    return () => { window.removeEventListener("pagehide", hide); window.removeEventListener("pageshow", check); channel?.close(); };
  }, [isPrivate, base]);

  function messageFor(status: number) { return status === 429 ? t.limited : status === 503 ? t.unavailable : t.error; }

  async function submit(event: FormEvent<HTMLFormElement>, path: string, extra: Record<string, unknown> = {}, success?: () => void) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const values = Object.fromEntries(new FormData(form).entries());
    if (values.confirmPassword !== undefined && values.confirmPassword !== (values.newPassword ?? values.password)) { setNotice(t.mismatch); return; }
    setBusy(true); setNotice("");
    try {
      const { response } = await api(path, { ...values, ...extra }, user?.csrf);
      if (!response.ok) { setNotice(messageFor(response.status)); return; }
      form.querySelectorAll<HTMLInputElement>('input[name="password"],input[name="currentPassword"],input[name="newPassword"],input[name="confirmPassword"]').forEach((input) => { input.value = ""; });
      if (success) success(); else setNotice(path === "/invite" ? t.inviteSent : t.done, path === "/invite" ? "success" : "error");
      if (isPrivate) void loadPrivate();
    } catch { setNotice(t.unavailable); }
    finally { setBusy(false); }
  }

  async function action(path: string, body: Record<string, unknown>, confirm = false) {
    if (confirm && !window.confirm(t.confirmAction)) return;
    if (!reauthPassword) { setNotice(t.currentPassword); return; }
    setBusy(true); setNotice("");
    try {
      const { response } = await api(path, { ...body, currentPassword: reauthPassword }, user?.csrf);
      setNotice(response.ok ? t.done : messageFor(response.status));
      setReauthPassword("");
      if (response.ok) void loadPrivate();
      if (response.ok && (path === "/sessions/revoke-all" || path === "/administrators/disable" && body.id === user?.id)) window.location.replace(`${base}/login`);
    } catch { setNotice(t.unavailable); }
    finally { setBusy(false); }
  }

  function reauthField() {
    return <label className="form-field"><span>{t.currentPassword}</span><span className="form-field__control"><input type="password" autoComplete="current-password" value={reauthPassword} onChange={(event) => setReauthPassword(event.target.value)} /></span></label>;
  }

  async function logout() {
    try {
      const status = await api("/status");
      if (!status.response.ok) { setNotice(t.unavailable); return; }
      if (!status.data.authenticated) { window.location.replace(`${base}/login`); return; }
      const result = await api("/logout", {}, status.data.logoutCsrf);
      if (!result.response.ok) { setNotice(messageFor(result.response.status)); return; }
      try { const channel = new BroadcastChannel("wct-admin"); channel.postMessage("logout"); channel.close(); } catch { /* browser without BroadcastChannel */ }
      window.location.replace(`${base}/login`);
    } catch { setNotice(t.unavailable); }
  }

  const title = view === "login" ? t.signIn : view === "forgot" ? t.forgot : view === "invite" ? t.invite : view === "reset" ? t.reset : view === "email" ? t.emailConfirm : view === "home" ? t.home : view === "profile" ? t.profile : t.administrators;
  const tokenFeedback = tokenCheckError === "limited" ? `${t.limited} ${t.openLink}` : tokenCheckError === "unavailable" ? `${t.unavailable} ${t.openLink}` : token ? t.invalid : t.openLink;
  return <FormLocale.Provider value={locale}><div className="auth-page">
    <header className="auth-header"><div className="container auth-header__inner"><Link href={locale === "bg" ? "/bg" : "/en"} aria-label={t.back}><Image src={appConfig.brandLogoPath} alt="WebCreativeTeam" width={280} height={77} unoptimized /></Link><div className="auth-header__actions"><button type="button" onClick={() => setLocale(locale === "bg" ? "en" : "bg")} aria-label={locale === "bg" ? "English" : "Български"}>{locale === "bg" ? "EN" : "BG"}</button>{user && <button type="button" onClick={() => void logout()}>{t.logout}</button>}</div></div></header>
    <main id="main" className="container auth-main" style={privateVisible ? undefined : { visibility: "hidden" }}>
      <div className="auth-panel"><h1>{title}</h1>{user && <p>{t.greeting}, <strong>{user.username}</strong></p>}
        <p ref={successNoticeRef} className="form-message form-message--success" role="status" tabIndex={-1} hidden={notice?.kind !== "success"}>{notice?.kind === "success" ? notice.message : ""}</p>
        <p ref={errorNoticeRef} className="form-message" role="alert" tabIndex={-1} hidden={notice?.kind !== "error"}>{notice?.kind === "error" ? notice.message : ""}</p>
        {view === "login" && <form className="form-stack" onSubmit={(event) => void submit(event, "/login", {}, () => window.location.assign(returnTo))}><Field label={t.email} name="email" type="email" autoComplete="username" /><Field label={t.password} name="password" type="password" autoComplete="current-password" /><button className="button button--orange" disabled={busy}>{busy ? t.loading : t.signIn}</button><Link href={`${base}/forgot`}>{t.forgot}</Link></form>}
        {view === "forgot" && <form className="form-stack" onSubmit={(event) => void submit(event, "/forgot", {}, () => setNotice(t.checkEmail))}><Field label={t.email} name="email" type="email" autoComplete="email" /><button className="button button--orange" disabled={busy}>{busy ? t.loading : t.send}</button><Link href={`${base}/login`}>{t.loginAgain}</Link></form>}
        {(view === "invite" || view === "reset" || view === "email") && (tokenValid === null ? <p>{t.loading}</p> : tokenValid === false ? <p role="alert">{tokenFeedback}</p> : <form className="form-stack" onSubmit={(event) => void submit(event, view === "email" ? "/email/confirm" : view === "reset" ? "/reset" : tokenKind === "reactivation" ? "/reactivate/accept" : "/invite/accept", { token }, () => { setToken(""); setTokenValid(false); window.location.assign(`${base}/login`); })}>{view === "invite" && tokenKind !== "reactivation" && <Field label={t.username} name="username" autoComplete="nickname" />}{view !== "email" && <><Field label={t.newPassword} name="password" type="password" autoComplete="new-password" /><Field label={t.confirmPassword} name="confirmPassword" type="password" autoComplete="new-password" /><p className="form-hint">{t.minPassword}</p></>}<button className="button button--orange" disabled={busy}>{busy ? t.loading : view === "invite" ? t.accept : t.save}</button></form>)}
        {view === "home" && <nav className="auth-links"><Link className="button button--outline" href={`${base}/profile`}>{t.profile}</Link><Link className="button button--outline" href={`${base}/administrators`}>{t.administrators}</Link></nav>}
        {view === "profile" && user && <div className="auth-sections">
          <section><h2>{t.changeName}</h2><form className="form-stack" onSubmit={(event) => void submit(event, "/username")}><Field label={t.username} name="username" defaultValue={user.username} /><Field label={t.currentPassword} name="currentPassword" type="password" autoComplete="current-password" /><button className="button button--orange" disabled={busy}>{t.save}</button></form></section>
          <section><h2>{t.changeEmail}</h2><form className="form-stack" onSubmit={(event) => void submit(event, "/email/change")}><Field label={t.email} name="email" type="email" defaultValue={user.email} autoComplete="email" /><Field label={t.currentPassword} name="currentPassword" type="password" autoComplete="current-password" /><button className="button button--orange" disabled={busy}>{t.send}</button></form></section>
          <section><h2>{t.changePassword}</h2><form className="form-stack" onSubmit={(event) => void submit(event, "/password/change")}><Field label={t.currentPassword} name="currentPassword" type="password" autoComplete="current-password" /><Field label={t.newPassword} name="newPassword" type="password" autoComplete="new-password" /><Field label={t.confirmPassword} name="confirmPassword" type="password" autoComplete="new-password" /><button className="button button--orange" disabled={busy}>{t.save}</button></form></section>
          <section><h2>{t.devices}</h2>{reauthField()}<ul className="auth-list">{devices.map((device) => <li key={device.id}><span>{device.deviceLabel}{device.current ? " • current" : ""}</span><button type="button" onClick={() => void action("/sessions/revoke", { id: device.id }, true)}>{t.revoke}</button></li>)}</ul><button className="button button--outline" type="button" onClick={() => void action("/sessions/revoke-all", {}, true)}>{t.revokeAll}</button></section>
        </div>}
        {view === "administrators" && user && <div className="auth-sections">
          <section><h2>{t.inviteAdmin}</h2><form className="form-stack" onSubmit={(event) => void submit(event, "/invite")}><Field label={t.email} name="email" type="email" autoComplete="email" /><Field label={t.currentPassword} name="currentPassword" type="password" autoComplete="current-password" /><button className="button button--orange" disabled={busy}>{t.send}</button></form></section>
          <section><h2>{t.administrators}</h2>{reauthField()}<ul className="auth-list">{admins.map((admin) => <li key={admin.id}><span>{admin.username} · {admin.email} · {admin.status === "active" ? t.active : t.disabled}</span>{admin.status === "active" ? <button type="button" onClick={() => void action("/administrators/disable", { id: admin.id }, true)}>{t.disable}</button> : <><button type="button" onClick={() => void action("/administrators/reactivate", { id: admin.id }, true)}>{t.reactivate}</button><button type="button" onClick={() => { const confirmation = window.prompt(`${t.confirmEmail}: ${admin.email}`); if (confirmation !== null) void action("/administrators/delete", { id: admin.id, confirmation }, true); }}>{t.delete}</button></>}</li>)}</ul></section>
          <section><h2>{t.pending}</h2><ul className="auth-list">{invitations.map((invite) => <li key={invite.id}><span>{invite.email}</span><button type="button" onClick={() => void action("/invite/cancel", { id: invite.id }, true)}>{t.cancel}</button></li>)}</ul></section>
        </div>}
      </div>
    </main>
  </div></FormLocale.Provider>;
}
