// What Vexa can honestly say about a provider write that threw.
//
// A write whose response is lost may or may not have executed. Recording it as a plain failure
// invites the operator to publish again and make a duplicate. Before a provider write the
// publish flow records a PENDING submission carrying PROVIDER_CALL_IN_FLIGHT. When the call then
// throws, this module decides which of three things is true:
//
//   NOT_EXECUTED      the provider provably did not run the request (refused before connecting,
//                     DNS or TLS failure, credentials or installation problems caught locally).
//   OUTCOME_UNKNOWN   the request may have reached the provider (timeout, reset, a transport
//                     failure with no pre-connect cause, or a connector that says so).
//   PROVIDER_ANSWERED anything else: the provider replied with an error, or the failure was local
//                     validation. These stay the final ERROR they have always been.
//
// Only OUTCOME_UNKNOWN leaves the submission non-final. The classifier is deliberately
// conservative about transport errors: when it cannot tell, it says the outcome is unknown.
// A provider's HTTP 5xx answer is also ambiguous but is not visible here (publish errors do not
// carry the status); that remains for a follow-up.

import { isConnectorTargetSecurityError } from "../common/security/connector-target-errors";
import {
  CapabilityNotSupportedError,
  ConnectorNetworkError,
  ConnectorNotFoundError,
  CredentialExpiredError,
  InstallationNotFoundError,
} from "./connector.errors";

export type ProviderCallFailureKind = "NOT_EXECUTED" | "OUTCOME_UNKNOWN" | "PROVIDER_ANSWERED";

export const PROVIDER_CALL_IN_FLIGHT = "PROVIDER_CALL_IN_FLIGHT";
export const PROVIDER_OUTCOME_UNKNOWN = "PROVIDER_OUTCOME_UNKNOWN";

/** The provider write could not be started because its intent could not be recorded. */
export class SubmissionIntentNotRecordedError extends Error {
  constructor(cause: unknown) {
    super("The publish was not sent: its intent could not be recorded, so no provider write was made.");
    this.name = "SubmissionIntentNotRecordedError";
    this.cause = cause;
  }
}

/** Failures that occur before the request can have reached the provider. */
const PRE_SEND_CODES = new Set([
  "ENOTFOUND",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
]);

/** Failures after the request may have been written. */
const POST_SEND_CODES = new Set([
  "ECONNRESET",
  "ETIMEDOUT",
  "EPIPE",
  "ECONNABORTED",
  "UND_ERR_SOCKET",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "UND_ERR_REQ_CONTENT_LENGTH_MISMATCH",
]);

function causeCodes(error: unknown): string[] {
  const codes: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") codes.push(code);
    current = (current as { cause?: unknown }).cause;
  }
  return codes;
}

function isTlsCode(code: string): boolean {
  return code.startsWith("ERR_TLS") || code.startsWith("CERT_") || code === "DEPTH_ZERO_SELF_SIGNED_CERT";
}

export function classifyProviderCallFailure(error: unknown): ProviderCallFailureKind {
  // A connector that knows its own write may have executed says so.
  if (error && typeof error === "object" && (error as { outcomeUnknown?: unknown }).outcomeUnknown === true) {
    return "OUTCOME_UNKNOWN";
  }
  if (
    isConnectorTargetSecurityError(error) ||
    error instanceof CredentialExpiredError ||
    error instanceof InstallationNotFoundError ||
    error instanceof CapabilityNotSupportedError ||
    error instanceof ConnectorNotFoundError ||
    error instanceof SubmissionIntentNotRecordedError
  ) {
    return "NOT_EXECUTED";
  }
  if (error instanceof ConnectorNetworkError) {
    return error.category === "DNS" || error.category === "TLS" ? "NOT_EXECUTED" : "OUTCOME_UNKNOWN";
  }

  const codes = causeCodes(error);
  if (codes.some((code) => POST_SEND_CODES.has(code))) return "OUTCOME_UNKNOWN";
  if (codes.some((code) => PRE_SEND_CODES.has(code) || isTlsCode(code))) return "NOT_EXECUTED";

  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") return "OUTCOME_UNKNOWN";
    // undici reports a failed request as TypeError("fetch failed"); with no pre-connect cause it
    // may have been sent.
    if (error instanceof TypeError && /fetch failed/i.test(error.message)) return "OUTCOME_UNKNOWN";
  }
  return "PROVIDER_ANSWERED";
}

export function providerCallInFlightMarker(): Record<string, unknown> {
  return {
    code: PROVIDER_CALL_IN_FLIGHT,
    fieldPath: "",
    severity: "warning",
    sellerMessage: "This publish is being sent to the channel and its outcome is not yet known.",
  };
}

export function providerOutcomeUnknownMarker(): Record<string, unknown> {
  return {
    code: PROVIDER_OUTCOME_UNKNOWN,
    fieldPath: "",
    severity: "warning",
    sellerMessage:
      "The channel may have received this publish request, but its response was not received. Check the channel for this product before publishing again.",
  };
}
