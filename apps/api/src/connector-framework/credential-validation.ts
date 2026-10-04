import type { CredentialVerificationResult } from "./connector.interface";

// Truthful credential-health classification for the heartbeat (and anything else that
// records "was this installation validated").
//
//   VALID               authenticated provider validation succeeded
//   INVALID             explicit evidence the credentials are unusable (401/403, a provider
//                       error naming invalid_client / invalid_grant, an expired refresh token)
//   INDETERMINATE       no evidence either way: timeout, DNS failure, reset, 429, 5xx,
//                       provider outage, or a verifier that crashed
//   CONFIGURATION_ERROR the configured target is refused (unsafe / non-HTTPS URL, blocked
//                       redirect). Not a credential problem, so it never expires credentials
//
// Provider availability is not credential validity: only INVALID may expire credentials.

export type ValidationOutcome = "VALID" | "INVALID" | "INDETERMINATE" | "CONFIGURATION_ERROR";

export interface ValidationRecord {
  outcome: ValidationOutcome;
  /** Short safe code. Never a provider message, URL or credential. */
  reason: string | null;
}

/**
 * Connectors whose boolean `validateCredentials()` has been audited and is proven to return
 * `false` ONLY on an explicit credential rejection (never on an outage or an exception).
 * A slug earns an entry only after that audit. Deliberately empty: no connector qualifies
 * today (meesho and nykaa return a constant `false`; myntra returns `false` for a 401 and
 * also for any exception).
 */
export const BOOLEAN_FALSE_MEANS_REJECTION: ReadonlySet<string> = new Set<string>();

/**
 * Registered connectors that have no tri-state verifier and are parked: their boolean
 * `false` is "validation not implemented / not applicable", never a credential verdict.
 * The inventory spec requires every registered connector to have a detailed verifier, be
 * listed in BOOLEAN_FALSE_MEANS_REJECTION, or be listed here; and it fails if a slug listed
 * here later gains a detailed verifier, so this list cannot go stale.
 */
export const LEGACY_PARKED_NO_DETAILED_VERIFIER: ReadonlySet<string> = new Set(["meesho", "myntra", "nykaa"]);

const SAFE_REASON = /^[A-Za-z0-9_.-]{1,64}$/;

/** Keep only a short code; anything else (free text, a URL, a message) becomes `fallback`. */
export function safeReason(value: unknown, fallback: string): string {
  const text = typeof value === "string" ? value.trim() : "";
  return SAFE_REASON.test(text) ? text : fallback;
}

/** An `invalid` verification result that is a configuration problem, not a credential one. */
export function configurationInvalid(reasonCode: string): CredentialVerificationResult {
  return { outcome: "invalid", reasonCode, category: "configuration" };
}

/** Classify a tri-state verifier result. `not_supported` has no verdict: the caller falls back. */
export function classifyDetailedResult(
  result: Exclude<CredentialVerificationResult, { outcome: "not_supported" }>,
): ValidationRecord {
  switch (result.outcome) {
    case "valid":
      // A token-only success is still VALID but says so, so the evidence level is never hidden.
      return { outcome: "VALID", reason: result.evidence === "token_only" ? "TOKEN_ONLY" : null };
    case "invalid":
      return {
        outcome: result.category === "configuration" ? "CONFIGURATION_ERROR" : "INVALID",
        reason: safeReason(result.reasonCode, "UNSPECIFIED"),
      };
    case "unavailable":
      return { outcome: "INDETERMINATE", reason: safeReason(result.reasonCode, "UNAVAILABLE") };
  }
}

/**
 * Classify a legacy boolean `validateCredentials()` result. A `false` only expires
 * credentials for a connector on the audited BOOLEAN_FALSE_MEANS_REJECTION list; for
 * everyone else it cannot be told apart from an outage, so it is INDETERMINATE.
 */
export function classifyLegacyBoolean(slug: string, valid: boolean): ValidationRecord {
  if (valid) return { outcome: "VALID", reason: null };
  if (BOOLEAN_FALSE_MEANS_REJECTION.has(slug)) return { outcome: "INVALID", reason: "LEGACY_BOOLEAN_FALSE" };
  return { outcome: "INDETERMINATE", reason: "LEGACY_BOOLEAN_FALSE" };
}

/** A verifier that threw is a failed check, not evidence about the credentials. */
export function classifyThrown(): ValidationRecord {
  return { outcome: "INDETERMINATE", reason: "HEARTBEAT_ERROR" };
}

/**
 * Columns to write on `connector_installations` for a recorded validation. `lastValidatedAt`
 * moves ONLY on VALID (genuine validation evidence); every outcome moves the attempt time.
 */
export function validationColumns(record: ValidationRecord, now: Date) {
  return {
    ...(record.outcome === "VALID" ? { lastValidatedAt: now } : {}),
    lastValidationAttemptAt: now,
    lastValidationOutcome: record.outcome,
    lastValidationReason: record.reason,
  };
}

/**
 * Recorded when a candidate credential set was verified by an authenticated provider call and
 * persisted (the credential-replacement paths): VALID, no reason.
 */
export function verifiedValidationStamp(now: Date = new Date()) {
  return validationColumns({ outcome: "VALID", reason: null }, now);
}

/**
 * Recorded when credentials or the connection changed WITHOUT an authenticated provider check
 * (OAuth callback that only stores keys, reconnect): the previous facts no longer describe the
 * current credentials, so they are cleared to "unknown". A null attempt time sorts first in the
 * heartbeat batch, so the next tick re-validates this installation before any other.
 * Never records VALID: no VALID without provider-authenticated evidence.
 */
export function unvalidatedAfterCredentialChange() {
  return {
    lastValidatedAt: null,
    lastValidationAttemptAt: null,
    lastValidationOutcome: null,
    lastValidationReason: null,
  };
}
