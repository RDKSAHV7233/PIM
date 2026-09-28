// The plan-limit modal is opened from URL query params (planUpgrade / planContact),
// so its links must never trust those values as-is: a crafted link could otherwise
// point the modal's "Request upgrade" / "Contact us to upgrade" buttons off-site.

const DEFAULT_UPGRADE_HREF = "/admin/plan";

// Browsers strip tabs/newlines anywhere in a URL, so "/\t/evil.example" would become
// "//evil.example"; reject any control character or whitespace outright.
const UNSAFE_URL_CHARS = /[\u0000-\u001F\u007F\s]/;

/** Only a same-origin path ("/..."), never "//host" or "/\host"; otherwise the plan page. */
export function safeUpgradeHref(value: string | null | undefined): string {
  const href = String(value ?? "").trim();
  if (!href.startsWith("/") || href.startsWith("//") || href.startsWith("/\\") || UNSAFE_URL_CHARS.test(href)) {
    return DEFAULT_UPGRADE_HREF;
  }
  return href;
}

/**
 * Only an https: URL on the same origin as the server-configured commercial contact
 * URL (PIM_COMMERCIAL_CONTACT_URL, the value the API itself sends as contact_url);
 * anything else, or no configured URL, drops the contact link (null).
 */
export function safeContactHref(value: string | null | undefined, trustedUrl: string | null | undefined): string | null {
  const href = String(value ?? "").trim();
  const trusted = String(trustedUrl ?? "").trim();
  if (!href || !trusted || UNSAFE_URL_CHARS.test(href)) {
    return null;
  }
  try {
    const candidate = new URL(href);
    const configured = new URL(trusted);
    if (candidate.protocol !== "https:" || configured.protocol !== "https:") {
      return null;
    }
    return candidate.origin === configured.origin ? candidate.toString() : null;
  } catch {
    return null;
  }
}
