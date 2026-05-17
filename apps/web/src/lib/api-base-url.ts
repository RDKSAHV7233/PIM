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

export function getApiBaseUrl(): string {
  const configuredValue = [process.env.PIM_API_BASE_URL, process.env.NEXT_PUBLIC_API_URL]
    .map((value) => String(value ?? "").trim())
    .find((value) => value.length > 0);

  if (!configuredValue) {
    return DEFAULT_API_BASE_URL;
  }

  return normalizeApiBaseUrl(configuredValue);
}
