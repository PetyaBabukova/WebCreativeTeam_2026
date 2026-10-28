import { appConfig, type Locale } from "./config";

export type RecaptchaApi = {
  render: (container: HTMLElement, options: {
    sitekey: string; size: "invisible"; badge: "bottomright";
    callback: (token: string) => void; "expired-callback": () => void; "error-callback": () => void;
  }) => number;
  execute: (widgetId: number) => void;
  reset: (widgetId: number) => void;
};
type RecaptchaWindow = Window & { grecaptcha?: RecaptchaApi; __wctRecaptchaLoaded?: () => void };
let captchaScriptPromise: Promise<RecaptchaApi> | null = null;

export function loadCaptchaScript(locale: Locale): Promise<RecaptchaApi> {
  const captchaWindow = window as RecaptchaWindow;
  if (captchaScriptPromise) return captchaScriptPromise;
  if (captchaWindow.grecaptcha && typeof captchaWindow.grecaptcha.render === "function"
    && typeof captchaWindow.grecaptcha.execute === "function" && typeof captchaWindow.grecaptcha.reset === "function") {
    return Promise.resolve(captchaWindow.grecaptcha);
  }
  captchaScriptPromise = new Promise<RecaptchaApi>((resolve, reject) => {
    const script = document.createElement("script");
    let settled = false;
    const timer = window.setTimeout(() => fail(), appConfig.contact.captchaScriptTimeoutMilliseconds);
    function fail() {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      delete captchaWindow.__wctRecaptchaLoaded;
      script.remove();
      captchaScriptPromise = null;
      reject(new Error("reCAPTCHA unavailable"));
    }
    captchaWindow.__wctRecaptchaLoaded = () => {
      if (settled) return;
      window.clearTimeout(timer);
      if (!captchaWindow.grecaptcha || typeof captchaWindow.grecaptcha.render !== "function"
        || typeof captchaWindow.grecaptcha.execute !== "function" || typeof captchaWindow.grecaptcha.reset !== "function") { fail(); return; }
      settled = true;
      delete captchaWindow.__wctRecaptchaLoaded;
      resolve(captchaWindow.grecaptcha);
    };
    script.src = `${appConfig.contact.captchaScriptUrl}?render=explicit&onload=__wctRecaptchaLoaded&hl=${locale}`;
    script.async = true;
    script.defer = true;
    script.onerror = fail;
    document.head.appendChild(script);
  });
  return captchaScriptPromise;
}

export async function fetchCaptchaSiteKey(): Promise<string | null> {
  try {
    const response = await fetch(appConfig.paths.contactApi, { cache: "no-store" });
    if (!response.ok) return null;
    const config: unknown = await response.json();
    return config && typeof config === "object" && typeof (config as { siteKey?: unknown }).siteKey === "string"
      ? (config as { siteKey: string }).siteKey : null;
  } catch { return null; }
}
