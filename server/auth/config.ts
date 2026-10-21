import { appConfig, siteOrigin } from "../../lib/config.ts";
import { isIP } from "node:net";

type AuthEnv = { NODE_ENV?: string; NODE_TLS_REJECT_UNAUTHORIZED?: string; SITE_URL?: string; PORT?: string; AUTH_MONGODB_URI?: string; AUTH_DB_NAME?: string; AUTH_TRUSTED_PROXY_IPS?: string; RENDER?: string; RENDER_SERVICE_TYPE?: string };

export class AuthConfigurationError extends Error {
  constructor() { super("Authentication service is not configured"); }
}

function required(value: string | undefined): string {
  if (!value?.trim()) throw new AuthConfigurationError();
  return value.trim();
}

export function authDatabaseConfig(env: AuthEnv = process.env) {
  if (env.RENDER === "true" && env.NODE_ENV !== "production") throw new AuthConfigurationError();
  deploymentMode(env);
  if (env.NODE_ENV === "production" && env.NODE_TLS_REJECT_UNAUTHORIZED === "0") throw new AuthConfigurationError();
  const uri = required(env.AUTH_MONGODB_URI);
  const databaseName = required(env.AUTH_DB_NAME);
  if (!/^mongodb(?:\+srv)?:\/\//.test(uri) || !/^[a-zA-Z0-9_-]+$/.test(databaseName) || ["admin", "local", "config"].includes(databaseName.toLowerCase())) {
    throw new AuthConfigurationError();
  }
  if (env.NODE_ENV === "production") {
    const query = uri.includes("?") ? uri.slice(uri.indexOf("?") + 1) : "";
    const options = new Map<string, string[]>();
    for (const [key, value] of new URLSearchParams(query)) {
      const normalized = key.toLowerCase();
      options.set(normalized, [...(options.get(normalized) ?? []), value.toLowerCase()]);
    }
    const tlsSettings = [...(options.get("tls") ?? []), ...(options.get("ssl") ?? [])];
    if (tlsSettings.includes("false") || (!uri.startsWith("mongodb+srv://") && !tlsSettings.includes("true"))) throw new AuthConfigurationError();
    for (const key of ["tlsinsecure", "tlsallowinvalidcertificates", "tlsallowinvalidhostnames"]) {
      if (options.get(key)?.some((value) => value !== "false")) throw new AuthConfigurationError();
    }
  }
  return { uri, databaseName, tlsRequired: env.NODE_ENV === "production" };
}

function deploymentMode(env: AuthEnv): "development" | "test" | "production" {
  if (env.NODE_ENV === "development" || env.NODE_ENV === "test" || env.NODE_ENV === "production") return env.NODE_ENV;
  throw new AuthConfigurationError();
}

export function authPublicOrigin(env: AuthEnv = process.env): URL {
  const production = deploymentMode(env) === "production";
  if (production && !env.SITE_URL?.trim()) throw new AuthConfigurationError();
  try {
    const origin = siteOrigin({ SITE_URL: env.SITE_URL, PORT: env.PORT });
    if (production && origin.protocol !== "https:") throw new AuthConfigurationError();
    return origin;
  } catch {
    throw new AuthConfigurationError();
  }
}

export function authCookieConfig(env: AuthEnv = process.env) {
  const production = deploymentMode(env) === "production";
  return {
    name: production ? appConfig.auth.cookieName : appConfig.auth.developmentCookieName,
    secure: production,
    httpOnly: true,
    sameSite: "lax" as const,
    path: appConfig.paths.root,
    maxAge: appConfig.auth.absoluteSeconds * 1000,
  };
}

export function authTrustedProxies(env: AuthEnv = process.env): string[] | number {
  if (!env.AUTH_TRUSTED_PROXY_IPS?.trim()) return env.RENDER === "true" && env.RENDER_SERVICE_TYPE === "web" ? 1 : [];
  return env.AUTH_TRUSTED_PROXY_IPS.split(",").map((entry) => entry.trim()).map((entry) => {
    const [address, prefix, extra] = entry.split("/");
    const family = isIP(address);
    if (!family || extra !== undefined || prefix !== undefined && (!/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > (family === 4 ? 32 : 128))) throw new AuthConfigurationError();
    return entry;
  });
}
