/** Accept a complete HTTP(S) URL or a domain entered without a protocol. */
export function validContactWebsite(value: string): boolean {
  const website = value.trim();
  if (!website) return true;
  if (/\s|\\/u.test(website)) return false;

  const hasProtocol = /^https?:\/\//i.test(website);
  if (!hasProtocol && (/^[a-z][a-z\d+.-]*:/i.test(website) || website.startsWith("//"))) return false;

  try {
    const url = new URL(hasProtocol ? website : `https://${website}`);
    if ((url.protocol !== "http:" && url.protocol !== "https:") || !url.hostname || url.username || url.password) return false;
    if (hasProtocol) return true;

    const labels = url.hostname.replace(/\.$/, "").split(".");
    return labels.length >= 2 && labels.at(-1)!.length >= 2
      && labels.every((label) => /^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(label));
  } catch {
    return false;
  }
}
