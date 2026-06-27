export function readCsrfCookie(): string {
  if (typeof document === "undefined") return "";
  const match = document.cookie.match(/(?:^|; )pim_csrf_token=([^;]*)/);
  return match?.[1] ? decodeURIComponent(match[1]) : "";
}

export function csrfHeaders(): Record<string, string> {
  const token = readCsrfCookie();
  return token ? { "x-csrf-token": token } : {};
}
