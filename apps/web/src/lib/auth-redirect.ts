export type LoginRedirectReason = "session_expired" | "forbidden" | "tenant_suspended";

type AuthFailureLike =
  | number
  | {
      status?: number;
      body?: unknown;
    }
  | undefined;

function extractErrorCode(body: unknown): string {
  if (!body || typeof body !== "object") {
    return "";
  }
  return String((body as { error?: unknown }).error ?? "").trim().toUpperCase();
}

export function resolveLoginRedirectReason(failure?: AuthFailureLike): LoginRedirectReason {
  const status = typeof failure === "number" ? failure : Number(failure?.status ?? 0);
  const body = typeof failure === "number" ? null : failure?.body;
  if (status === 403 && extractErrorCode(body) === "TENANT_SUSPENDED") {
    return "tenant_suspended";
  }
  return status === 403 ? "forbidden" : "session_expired";
}

export function buildLoginRedirect(nextPath: string, failure?: AuthFailureLike): string {
  const reason = resolveLoginRedirectReason(failure);
  if (reason === "tenant_suspended") {
    return "/account-suspended";
  }
  const normalizedNext = sanitizeNextPath(nextPath);
  const params = new URLSearchParams({
    reason,
    next: normalizedNext,
  });
  return `/login?${params.toString()}`;
}

export function sanitizeNextPath(value: string): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed.startsWith("/")) {
    return "/";
  }
  // Block protocol-relative URLs and backslash variants that browsers
  // normalise to forward slashes (e.g. /\evil.com → //evil.com).
  if (/^\/[/\\]/.test(trimmed)) {
    return "/";
  }
  // Block percent-encoded slashes/backslashes in the second character that
  // could decode to a protocol-relative URL.
  if (/^\/%(?:2[fF]|5[cC])/.test(trimmed)) {
    return "/";
  }
  return trimmed;
}
