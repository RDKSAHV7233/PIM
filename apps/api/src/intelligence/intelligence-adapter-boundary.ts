import type { IntelligenceAdapterErrorClass, IntelligenceAdapterNormalizedError } from "./intelligence.types";

export const INTELLIGENCE_PROVIDER_ADAPTER = Symbol("INTELLIGENCE_PROVIDER_ADAPTER");

const ADAPTER_ERROR_CLASSES: readonly IntelligenceAdapterErrorClass[] = [
  "input_not_allowed",
  "schema_invalid",
  "adapter_unavailable",
  "timeout",
  "rate_limited",
  "auth_failed",
  "upstream_5xx",
  "internal_error",
];

// Fixed, Vexa-owned messages. Adapter-supplied text is never surfaced because it can carry
// request bodies, headers, credentials, URLs, identifiers or provider diagnostics.
const ADAPTER_ERROR_MESSAGES: Record<IntelligenceAdapterErrorClass, string> = {
  input_not_allowed: "Intelligence adapter rejected the input.",
  schema_invalid: "Intelligence adapter reported an invalid schema.",
  adapter_unavailable: "Intelligence adapter is unavailable.",
  timeout: "Intelligence adapter timed out.",
  rate_limited: "Intelligence adapter is rate limited.",
  auth_failed: "Intelligence adapter authentication failed.",
  upstream_5xx: "Intelligence adapter upstream failed.",
  internal_error: "Intelligence adapter failed.",
};

const ADAPTER_ERROR_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

/** Throw this from adapters to report a classified failure; only class and code cross the boundary. */
export class IntelligenceAdapterError extends Error {
  constructor(
    readonly errorClass: IntelligenceAdapterErrorClass,
    readonly errorCode: string,
  ) {
    super(ADAPTER_ERROR_MESSAGES[errorClass]);
    this.name = "IntelligenceAdapterError";
  }
}

export function normalizeIntelligenceAdapterFailure(
  errorClass: unknown,
  errorCode: unknown,
  fallbackCode: string,
): IntelligenceAdapterNormalizedError {
  const safeClass = ADAPTER_ERROR_CLASSES.find((candidate) => candidate === errorClass) ?? "internal_error";
  const safeCode = typeof errorCode === "string" && ADAPTER_ERROR_CODE_PATTERN.test(errorCode) ? errorCode : fallbackCode;
  return { errorClass: safeClass, errorCode: safeCode, message: ADAPTER_ERROR_MESSAGES[safeClass] };
}

export function normalizeIntelligenceAdapterException(error: unknown): IntelligenceAdapterNormalizedError {
  if (error instanceof IntelligenceAdapterError) {
    return normalizeIntelligenceAdapterFailure(error.errorClass, error.errorCode, "adapter_error");
  }
  return normalizeIntelligenceAdapterFailure("internal_error", undefined, "adapter_exception");
}
