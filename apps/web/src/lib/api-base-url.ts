const DEFAULT_API_BASE_URL = "http://localhost:4000/api/v1";

function normalizeApiBaseUrl(value: string): string {
  try {
    const parsed = new URL(value);
    const pathname = parsed.pathname.replace(/\/+$/, "");
    parsed.pathname = !pathname || pathname === "/" ? "/api/v1" : pathname;
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return value.replace(/\/+$/, "") || DEFAULT_API_BASE_URL;
  }
}

function isUsableApiBaseUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    const hostname = parsed.hostname.trim().toLowerCase();
    if (!hostname) {
      return false;
    }
    if (hostname === "localhost" || hostname === "127.0.0.1") {
      return true;
    }
    if (hostname.endsWith(".railway.internal")) {
      return true;
    }
    return hostname.includes(".");
  } catch {
    return false;
  }
}

export function getApiBaseUrl(): string {
  const configuredValues = [
    process.env.PIM_API_BASE_URL,
    process.env.NEXT_PUBLIC_API_URL,
    process.env.PIM_API_BASE_URL_FALLBACK,
  ]
    .map((value) => normalizeApiBaseUrl(String(value ?? "").trim()))
    .filter((value) => value.length > 0);

  for (const candidate of configuredValues) {
    if (isUsableApiBaseUrl(candidate)) {
      return candidate;
    }
  }

  return DEFAULT_API_BASE_URL;
}
