import { getApiBaseUrl } from "../api-base-url";
import { isErrorAuthorityEnabled, resolveErrorAuthorityRelease } from "./error-authority-env";

type BrowserFrame = {
  file?: unknown;
  functionName?: unknown;
  line?: unknown;
  column?: unknown;
};

type BrowserErrorRequestPayload = {
  sourceEventId?: unknown;
  routeTemplate?: unknown;
  errorName?: unknown;
  errorCode?: unknown;
  category?: unknown;
  severity?: unknown;
  occurredAt?: unknown;
  frames?: unknown;
};

export type TrustedBrowserErrorPayload = {
  sourceEventId: string;
  release: string;
  routeTemplate?: string;
  errorName: string;
  errorCode?: string;
  category: "hydration" | "rendering" | "network" | "unknown";
  severity: "p2" | "p3";
  occurredAt: string;
  frames?: Array<{
    file: string;
    functionName?: string;
    line?: number;
    column?: number;
  }>;
};

const INGEST_TIMEOUT_MS = 1_500;
const VALID_CATEGORIES = new Set<TrustedBrowserErrorPayload["category"]>(["hydration", "rendering", "network", "unknown"]);
const VALID_SEVERITIES = new Set<TrustedBrowserErrorPayload["severity"]>(["p2", "p3"]);
const SOURCE_EVENT_ID_PATTERN = /^browser:[A-Za-z0-9._:-]{8,170}$/;

export async function forwardBrowserErrorToAuthority(body: unknown): Promise<{ forwarded: boolean }> {
  if (process.env.NEXT_RUNTIME === "edge" || !isErrorAuthorityEnabled()) {
    return { forwarded: false };
  }
  const token = String(process.env.ERROR_AUTHORITY_INGEST_TOKEN ?? "").trim();
  if (!token) {
    return { forwarded: false };
  }

  const payload = normalizeBrowserErrorPayload(body);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), INGEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${getApiBaseUrl()}/error-authority/ingest/browser`, {
      method: "POST",
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-error-authority-ingest-token": token,
      },
      body: JSON.stringify(payload),
    });
    return { forwarded: response.status >= 200 && response.status < 300 };
  } catch {
    return { forwarded: false };
  } finally {
    clearTimeout(timeout);
  }
}

export function normalizeBrowserErrorPayload(body: unknown): TrustedBrowserErrorPayload {
  const payload = body && typeof body === "object" && !Array.isArray(body) ? (body as BrowserErrorRequestPayload) : {};
  return {
    sourceEventId: safeSourceEventId(payload.sourceEventId),
    release: resolveErrorAuthorityRelease(),
    routeTemplate: safeRoute(payload.routeTemplate),
    errorName: safeIdentifier(payload.errorName, "BrowserError"),
    errorCode: safeIdentifier(payload.errorCode, "BrowserError"),
    category: safeCategory(payload.category),
    severity: safeSeverity(payload.severity),
    occurredAt: safeDate(payload.occurredAt) ?? new Date().toISOString(),
    frames: safeFrames(payload.frames),
  };
}

function safeSourceEventId(value: unknown): string {
  const text = safeText(value, 180);
  if (text && SOURCE_EVENT_ID_PATTERN.test(text)) {
    return text;
  }
  return `browser:${createRuntimeEventId()}`;
}

function createRuntimeEventId(): string {
  const cryptoLike = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof cryptoLike?.randomUUID === "function") {
    return cryptoLike.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

function safeText(value: unknown, maxLength: number): string | undefined {
  const text = String(value ?? "").trim();
  if (!text) {
    return undefined;
  }
  return text.replace(/[\r\n\t]+/g, " ").slice(0, maxLength);
}

function safeRoute(value: unknown): string | undefined {
  const text = safeText(value, 240);
  if (!text) {
    return undefined;
  }
  if (/^https?:\/\//i.test(text)) {
    try {
      return new URL(text).pathname.slice(0, 240) || undefined;
    } catch {
      return undefined;
    }
  }
  return text.split("?")[0]?.split("#")[0]?.slice(0, 240) || undefined;
}

function safeIdentifier(value: unknown, fallback: string): string {
  const text = safeText(value, 80) ?? fallback;
  return /^[A-Za-z0-9_.:-]+$/.test(text) ? text : fallback;
}

function safeCategory(value: unknown): TrustedBrowserErrorPayload["category"] {
  const category = safeText(value, 32) as TrustedBrowserErrorPayload["category"] | undefined;
  return category && VALID_CATEGORIES.has(category) ? category : "unknown";
}

function safeSeverity(value: unknown): TrustedBrowserErrorPayload["severity"] {
  const severity = safeText(value, 8) as TrustedBrowserErrorPayload["severity"] | undefined;
  return severity && VALID_SEVERITIES.has(severity) ? severity : "p2";
}

function safeDate(value: unknown): string | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(String(value));
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function safeFrames(value: unknown): TrustedBrowserErrorPayload["frames"] {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const frames: NonNullable<TrustedBrowserErrorPayload["frames"]> = [];
  for (const rawFrame of value) {
    if (!rawFrame || typeof rawFrame !== "object" || Array.isArray(rawFrame)) {
      continue;
    }
    const frame = rawFrame as BrowserFrame;
    const file = safeRoute(frame.file);
    if (!file) {
      continue;
    }
    const line = Number(frame.line);
    const column = Number(frame.column);
    frames.push({
      file,
      functionName: safeText(frame.functionName, 160),
      line: Number.isFinite(line) ? Math.max(0, Math.floor(line)) : undefined,
      column: Number.isFinite(column) ? Math.max(0, Math.floor(column)) : undefined,
    });
    if (frames.length >= 10) {
      break;
    }
  }
  return frames.length ? frames : undefined;
}
