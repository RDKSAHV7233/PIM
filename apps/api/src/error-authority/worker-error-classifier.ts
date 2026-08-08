import type { ErrorCategory } from "./error-authority.types";

const EXPECTED_WORKER_ERROR_PATTERNS = [
  "validation",
  "bad input",
  "customer bad input",
  "marketplace rejection",
  "marketplace validation",
  "credential expired",
  "credentials expired",
  "publication targets missing",
  "destination missing",
  "no eligible products",
  "rate limit",
  "429",
  "plan limit",
  "quota",
];

export interface WorkerErrorClassification {
  capture: boolean;
  category: ErrorCategory;
  reason: string;
}

export function classifyWorkerError(error: unknown): WorkerErrorClassification {
  if (error instanceof Error && error.name === "QueueRateLimitError") {
    return { capture: false, category: "dependency", reason: "rate_limit" };
  }
  const message = error instanceof Error ? error.message.toLowerCase() : String(error ?? "").toLowerCase();
  if (EXPECTED_WORKER_ERROR_PATTERNS.some((pattern) => message.includes(pattern))) {
    return { capture: false, category: "dependency", reason: "expected_domain_failure" };
  }
  if (message.includes("timeout") || message.includes("timed out")) {
    return { capture: true, category: "timeout", reason: "unexpected_timeout" };
  }
  if (message.includes("database") || message.includes("prisma") || message.includes("postgres")) {
    return { capture: true, category: "database", reason: "unexpected_database_failure" };
  }
  if (message.includes("redis") || message.includes("cache")) {
    return { capture: true, category: "cache", reason: "unexpected_cache_failure" };
  }
  return { capture: true, category: "internal", reason: "unexpected_worker_failure" };
}

export function isTerminalBullFailure(attemptsMade: unknown, attemptsAllowed: unknown): boolean {
  const made = Number(attemptsMade ?? 0);
  const allowed = Math.max(1, Number(attemptsAllowed ?? 1));
  if (!Number.isFinite(made)) {
    return true;
  }
  return made >= allowed;
}

export function extractSafePayloadRef(payload: unknown, key: string): string | undefined {
  if (!payload || typeof payload !== "object") {
    return undefined;
  }
  const value = (payload as Record<string, unknown>)[key];
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }
  const text = String(value).trim();
  return text ? text.slice(0, 120) : undefined;
}
