import { getApiBaseUrl } from "../api-base-url";
import { isErrorAuthorityEnabled, resolveErrorAuthorityRelease } from "./error-authority-env";

type NextRequestLike = {
  method?: unknown;
  url?: unknown;
  nextUrl?: { pathname?: unknown };
  headers?: { get(name: string): string | null };
};

type NextErrorContextLike = {
  routePath?: unknown;
  routeType?: unknown;
  renderSource?: unknown;
  renderType?: unknown;
  routerKind?: unknown;
};

export type TrustedNextServerErrorPayload = {
  sourceEventId: string;
  release: string;
  routeTemplate?: string;
  method?: string;
  statusCode: 500;
  requestId?: string;
  errorName: string;
  errorCode?: string;
  category: "internal" | "rendering";
  severity: "p1";
  occurredAt: string;
  frames?: Array<{
    file: string;
    functionName?: string;
    line?: number;
    column?: number;
  }>;
};

const EVENT_IDS = new WeakMap<object, string>();
const INGEST_TIMEOUT_MS = 1_500;
const NEXT_CONTROL_FLOW_DIGEST_PREFIXES = ["NEXT_REDIRECT", "NEXT_NOT_FOUND", "NEXT_HTTP_ERROR_FALLBACK;404"];
const EXPECTED_STATUS_CODES = new Set([400, 401, 403, 404, 409, 422, 429]);
const EXPECTED_CODE_PATTERNS = [
  /VALIDATION/i,
  /UNAUTHORIZED|UNAUTHENTICATED|AUTH_REQUIRED|SESSION_EXPIRED/i,
  /FORBIDDEN|ACCESS_DENIED|CSRF/i,
  /NOT_FOUND/i,
  /CONFLICT|VERSION_CONFLICT/i,
  /RATE_LIMIT|TOO_MANY_REQUESTS/i,
  /CONNECTOR_.*REJECT|CONNECTOR_.*BLOCK|SHOPIFY_.*MISSING|SHOPIFY_.*EXPIRED/i,
  /APPROVAL_BLOCKED|WORKFLOW_|FIELD_WRITE_RESTRICTED/i,
];

export async function captureNextServerError(error: unknown, request?: unknown, context?: unknown): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs" || !isErrorAuthorityEnabled()) {
    return;
  }
  if (!shouldCaptureNextServerError(error)) {
    return;
  }

  try {
    const token = String(process.env.ERROR_AUTHORITY_INGEST_TOKEN ?? "").trim();
    if (!token) {
      return;
    }
    const payload = buildTrustedNextServerErrorPayload(error, request, context);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), INGEST_TIMEOUT_MS);
    try {
      await fetch(`${getApiBaseUrl()}/error-authority/ingest/next-server`, {
        method: "POST",
        cache: "no-store",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          "x-error-authority-ingest-token": token,
        },
        body: JSON.stringify(payload),
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    // Error Authority ingestion must fail open and must not recursively create telemetry.
  }
}

export function shouldCaptureNextServerError(error: unknown): boolean {
  if (isExpectedNextControlFlowError(error)) {
    return false;
  }
  if (isExpectedVexaDomainError(error)) {
    return false;
  }
  return true;
}

export function buildTrustedNextServerErrorPayload(
  error: unknown,
  request?: unknown,
  context?: unknown,
): TrustedNextServerErrorPayload {
  const requestLike = asRequestLike(request);
  const contextLike = asContextLike(context);
  const routeTemplate = resolveRouteTemplate(requestLike, contextLike);
  return {
    sourceEventId: resolveSourceEventId(error, routeTemplate),
    release: resolveErrorAuthorityRelease(),
    routeTemplate,
    method: safeMethod(requestLike?.method),
    statusCode: 500,
    requestId: safeRequestId(requestLike?.headers?.get("x-request-id")),
    errorName: safeIdentifier(error instanceof Error ? error.name : "NextServerError", "NextServerError"),
    errorCode: safeIdentifier(readStringProperty(error, "code") ?? readStringProperty(error, "name"), "NextServerError"),
    category: isRenderContext(contextLike) ? "rendering" : "internal",
    severity: "p1",
    occurredAt: new Date().toISOString(),
    frames: extractSafeFrames(error),
  };
}

function isExpectedNextControlFlowError(error: unknown): boolean {
  const digest = readStringProperty(error, "digest") ?? "";
  if (NEXT_CONTROL_FLOW_DIGEST_PREFIXES.some((prefix) => digest.startsWith(prefix))) {
    return true;
  }
  const message = error instanceof Error ? error.message : String(error ?? "");
  return NEXT_CONTROL_FLOW_DIGEST_PREFIXES.some((prefix) => message.includes(prefix));
}

function isExpectedVexaDomainError(error: unknown): boolean {
  const status = readNumberProperty(error, "statusCode") ?? readNumberProperty(error, "status");
  if (status && EXPECTED_STATUS_CODES.has(status)) {
    return true;
  }
  const response = readObjectProperty(error, "response");
  const responseStatus = readNumberProperty(response, "statusCode") ?? readNumberProperty(response, "status");
  if (responseStatus && EXPECTED_STATUS_CODES.has(responseStatus)) {
    return true;
  }
  const code = readStringProperty(error, "code") ?? readStringProperty(response, "code") ?? readStringProperty(response, "error");
  return Boolean(code && EXPECTED_CODE_PATTERNS.some((pattern) => pattern.test(code)));
}

function resolveSourceEventId(error: unknown, routeTemplate: string | undefined): string {
  if (error && (typeof error === "object" || typeof error === "function")) {
    const existing = EVENT_IDS.get(error);
    if (existing) {
      return existing;
    }
    const next = `next_server:${createRuntimeEventId()}`;
    EVENT_IDS.set(error, next);
    return next;
  }
  return `next_server:${createRuntimeEventId()}`;
}

function createRuntimeEventId(): string {
  const cryptoLike = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (typeof cryptoLike?.randomUUID === "function") {
    return cryptoLike.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

function resolveRouteTemplate(request: NextRequestLike | undefined, context: NextErrorContextLike | undefined): string | undefined {
  const contextRoute = safeRoute(context?.routePath);
  if (contextRoute) {
    return contextRoute;
  }
  const nextPath = safeRoute(request?.nextUrl?.pathname);
  if (nextPath) {
    return nextPath;
  }
  const requestUrl = safeRoute(request?.url);
  if (!requestUrl) {
    return undefined;
  }
  try {
    return new URL(requestUrl).pathname.slice(0, 240);
  } catch {
    return requestUrl;
  }
}

function extractSafeFrames(error: unknown): TrustedNextServerErrorPayload["frames"] {
  if (!(error instanceof Error) || !error.stack) {
    return undefined;
  }
  const frames = error.stack
    .split("\n")
    .slice(1)
    .map((line) => line.trim())
    .map(parseStackLine)
    .filter((frame): frame is NonNullable<ReturnType<typeof parseStackLine>> => Boolean(frame))
    .slice(0, 10);
  return frames.length > 0 ? frames : undefined;
}

function parseStackLine(line: string):
  | {
      file: string;
      functionName?: string;
      line?: number;
      column?: number;
    }
  | undefined {
  const match = line.match(/^at\s+(?:(.*?)\s+\()?(.+?):(\d+):(\d+)\)?$/);
  if (!match) {
    return undefined;
  }
  return {
    functionName: safeFrameText(match[1], 160),
    file: safeFrameText(match[2], 240) ?? "unknown",
    line: Number(match[3]),
    column: Number(match[4]),
  };
}

function isRenderContext(context: NextErrorContextLike | undefined): boolean {
  const values = [context?.routeType, context?.renderSource, context?.renderType, context?.routerKind]
    .map((value) => String(value ?? "").toLowerCase())
    .join("|");
  return values.includes("render") || values.includes("component");
}

function asRequestLike(value: unknown): NextRequestLike | undefined {
  return value && typeof value === "object" ? (value as NextRequestLike) : undefined;
}

function asContextLike(value: unknown): NextErrorContextLike | undefined {
  return value && typeof value === "object" ? (value as NextErrorContextLike) : undefined;
}

function readObjectProperty(value: unknown, property: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const nested = (value as Record<string, unknown>)[property];
  return nested && typeof nested === "object" && !Array.isArray(nested) ? (nested as Record<string, unknown>) : undefined;
}

function readStringProperty(value: unknown, property: string): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const candidate = (value as Record<string, unknown>)[property];
  return typeof candidate === "string" && candidate.trim() ? candidate.trim().slice(0, 120) : undefined;
}

function readNumberProperty(value: unknown, property: string): number | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const candidate = Number((value as Record<string, unknown>)[property]);
  return Number.isFinite(candidate) ? Math.floor(candidate) : undefined;
}

function safeRoute(value: unknown): string | undefined {
  const text = String(value ?? "").trim();
  if (!text) {
    return undefined;
  }
  return text.split("?")[0]?.split("#")[0]?.slice(0, 240) || undefined;
}

function safeMethod(value: unknown): string | undefined {
  const method = String(value ?? "").trim().toUpperCase();
  return /^[A-Z]{3,12}$/.test(method) ? method : undefined;
}

function safeRequestId(value: unknown): string | undefined {
  const text = String(value ?? "").trim();
  return /^[A-Za-z0-9._:-]{6,128}$/.test(text) ? text : undefined;
}

function safeIdentifier(value: unknown, fallback: string): string {
  const text = String(value ?? "").trim().slice(0, 80);
  return /^[A-Za-z0-9_.:-]+$/.test(text) ? text : fallback;
}

function safeFrameText(value: unknown, maxLength: number): string | undefined {
  const text = String(value ?? "")
    .replace(/\\/g, "/")
    .replace(/[A-Z]:\/Users\/[^/]+/gi, "{userhome}")
    .replace(/\/home\/[^/]+/gi, "{userhome}")
    .trim();
  return text ? text.slice(0, maxLength) : undefined;
}
