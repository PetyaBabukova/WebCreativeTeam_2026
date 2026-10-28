import { appConfig } from "../../lib/config.js";

export function captchaConfig() {
  const siteKey = process.env.CAPTCHA_SITE_KEY;
  const secret = process.env.CAPTCHA_SECRET_SITE_KEY;
  return siteKey && secret ? { siteKey, secret } : null;
}

export async function verifyCaptcha(token: string, secret: string, hostname: string): Promise<"valid" | "invalid" | "unavailable"> {
  try {
    const response = await fetch(appConfig.contact.captchaVerifyUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token }),
      signal: AbortSignal.timeout(appConfig.contact.captchaVerifyTimeoutMilliseconds),
    });
    if (!response.ok) return "unavailable";
    const result: unknown = await response.json();
    if (!result || typeof result !== "object" || Array.isArray(result)) return "unavailable";
    const answer = result as Record<string, unknown>;
    if (answer.success !== true && answer.success !== false) return "unavailable";
    if (answer.success === false) return "invalid";
    if (answer["error-codes"] !== undefined && (!Array.isArray(answer["error-codes"]) || answer["error-codes"].length)) return "unavailable";
    return answer.hostname === hostname ? "valid" : "invalid";
  } catch { return "unavailable"; }
}
