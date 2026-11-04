import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { Locale } from "@/lib/config";
import { csrfToken, verifySessionCookie } from "@/server/auth/security";
import AuthScreen, { type AuthView } from "./AuthScreen";
import BlogAdminScreen from "./BlogAdminScreen";
import { adminUrl, blogAdminEditUrl } from "@/lib/routing";

const publicViews = new Set<AuthView>(["login", "forgot", "invite", "reset", "email"]);
const privateViews = new Set<AuthView>(["home", "profile", "administrators", "articles"]);

export default async function AuthPageServer({ locale, segments, returnTo, edit, lang }: { locale: Locale; segments?: string[]; returnTo?: string; edit?: string; lang?: string }) {
  if (segments && segments.length > 1) notFound();
  const view = (segments?.[0] ?? "home") as AuthView;
  if (!publicViews.has(view) && !privateViews.has(view)) notFound();
  const base = adminUrl(locale);
  const editTarget = view === "articles" && typeof edit === "string" && /^[a-f0-9]{24}$/.test(edit) && lang === locale ? blogAdminEditUrl(edit, locale) : null;
  const verified = await verifySessionCookie((await cookies()).toString());
  if (publicViews.has(view) && verified && view === "login") redirect(base);
  if (privateViews.has(view) && !verified) redirect(`${base}/login?returnTo=${encodeURIComponent(editTarget ?? `${base}/${view === "home" ? "" : view}`)}`);
  const returnEditId = typeof returnTo === "string" ? /[?&]edit=([a-f0-9]{24})/.exec(returnTo)?.[1] : undefined;
  const safeEditReturn = returnEditId && blogAdminEditUrl(returnEditId, locale) === returnTo;
  const destination = safeEditReturn ? returnTo! : returnTo && [base, `${base}/profile`, `${base}/administrators`, `${base}/articles`].includes(returnTo) ? returnTo : base;
  if (view === "articles" && verified) return <BlogAdminScreen locale={locale} base={base} csrf={csrfToken(verified.session, "private")} editId={editTarget ? edit : undefined} invalidEdit={Boolean(edit) && !editTarget} />;
  return <AuthScreen locale={locale} view={view} base={base} returnTo={destination}
    user={verified ? { id: verified.user._id.toHexString(), email: verified.user.email, username: verified.user.username, csrf: csrfToken(verified.session, "private") } : undefined} />;
}
