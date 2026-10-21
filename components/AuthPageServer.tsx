import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { appConfig, type Locale } from "@/lib/config";
import { csrfToken, verifySessionCookie } from "@/server/auth/security";
import AuthScreen, { type AuthView } from "./AuthScreen";

const publicViews = new Set<AuthView>(["login", "forgot", "invite", "reset", "email"]);
const privateViews = new Set<AuthView>(["home", "profile", "administrators"]);

function adminBase(locale: Locale) { return locale === "en" ? `${appConfig.paths.admin}/en` : appConfig.paths.admin; }

export default async function AuthPageServer({ locale, segments, returnTo }: { locale: Locale; segments?: string[]; returnTo?: string }) {
  if (segments && segments.length > 1) notFound();
  const view = (segments?.[0] ?? "home") as AuthView;
  if (!publicViews.has(view) && !privateViews.has(view)) notFound();
  const base = adminBase(locale);
  const verified = await verifySessionCookie((await cookies()).toString());
  if (publicViews.has(view) && verified && view === "login") redirect(base);
  if (privateViews.has(view) && !verified) redirect(`${base}/login?returnTo=${encodeURIComponent(`${base}/${view === "home" ? "" : view}`)}`);
  const destination = returnTo && [base, `${base}/profile`, `${base}/administrators`].includes(returnTo) ? returnTo : base;
  return <AuthScreen locale={locale} view={view} base={base} returnTo={destination}
    user={verified ? { id: verified.user._id.toHexString(), email: verified.user.email, username: verified.user.username, csrf: csrfToken(verified.session, "private") } : undefined} />;
}
