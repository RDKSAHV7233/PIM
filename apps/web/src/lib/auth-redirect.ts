export type LoginRedirectReason = "session_expired" | "forbidden";

export function resolveLoginRedirectReason(status?: number): LoginRedirectReason {
  return status === 403 ? "forbidden" : "session_expired";
}

export function buildLoginRedirect(nextPath: string, status?: number): string {
  const reason = resolveLoginRedirectReason(status);
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
  if (trimmed.startsWith("//")) {
    return "/";
  }
  return trimmed;
}
