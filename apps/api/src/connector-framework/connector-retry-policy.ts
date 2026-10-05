// Per-call retry policy for ConnectorHttpClient.fetch.
//
// A transport failure does not prove the provider did not execute the request: a timeout or a
// reset after the bytes left can mean the write happened and only the response was lost. The
// shared client retries every method on network errors, timeouts, 429 and 5xx, which is right for
// reads and idempotent writes and wrong for a create that has no idempotency mechanism. A call
// states which of the following it is; omitting the policy keeps the existing behavior exactly.
//
//   CURRENT_BEHAVIOR         (default) retry as the client always has; the call makes no claim.
//   SAFE_TO_RETRY            same retry behavior, but the caller asserts the operation is safe to
//                            repeat (a read, or a write that overwrites by a stable key).
//   RETRY_WITH_IDEMPOTENCY   same retry behavior, only with an idempotency mechanism the request
//                            actually carries: the client attaches the key header and fails the
//                            call before any attempt if the evidence is missing or inconsistent.
//   NO_AUTOMATIC_RETRY       exactly one attempt. A network error or timeout is thrown, a 429 or
//                            5xx response is returned, and the caller decides (for example by
//                            reconciling) instead of the client guessing.
//
// This module only describes and validates the policy. Connectors choose one per operation in
// later changes; nothing here changes what an existing call does.

export const CONNECTOR_RETRY_POLICIES = [
  "CURRENT_BEHAVIOR",
  "SAFE_TO_RETRY",
  "RETRY_WITH_IDEMPOTENCY",
  "NO_AUTOMATIC_RETRY",
] as const;

export type ConnectorRetryPolicy = (typeof CONNECTOR_RETRY_POLICIES)[number];

/**
 * The provider-side mechanism that makes a repeated request a no-op. Today a request header,
 * which is how the providers that offer one (Idempotency-Key style) accept it. The key must be
 * the same on every attempt of one logical operation, so the caller derives it from the
 * operation, never from the attempt.
 */
export interface ConnectorIdempotency {
  header: string;
  key: string;
}

export interface ConnectorFetchRetryOptions {
  /** Omitted = CURRENT_BEHAVIOR. */
  retryPolicy?: ConnectorRetryPolicy;
  /** Required with RETRY_WITH_IDEMPOTENCY, rejected with any other policy. */
  idempotency?: ConnectorIdempotency;
  /** Short label for logs, such as "create_product". Never a URL or a message. */
  operation?: string;
}

/**
 * Options for a provider create that has no idempotency mechanism and no proven reconciliation:
 * exactly one attempt, so a lost response surfaces to the caller instead of being repeated into a
 * possible duplicate. `operation` is the short log label.
 */
export function noAutomaticRetry(operation: string): ConnectorFetchRetryOptions {
  return { retryPolicy: "NO_AUTOMATIC_RETRY", operation };
}

/** A call that misstates its retry policy. A programming error, never retried. */
export class ConnectorRetryPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectorRetryPolicyError";
  }
}

const HEADER_TOKEN = /^[A-Za-z0-9-]{1,64}$/;
const IDEMPOTENCY_KEY = /^[\x21-\x7e]{8,255}$/; // printable ASCII, no whitespace or control characters

export interface ResolvedRetryPolicy {
  policy: ConnectorRetryPolicy;
  operation: string | null;
  /** Headers to merge into the request (RETRY_WITH_IDEMPOTENCY only), else empty. */
  extraHeaders: Record<string, string>;
}

/**
 * Validates the options once, before the first attempt. Fails closed: an unknown policy, a
 * RETRY_WITH_IDEMPOTENCY call without a usable key, an idempotency key under another policy, or a
 * request that already carries that header with a different value all throw.
 */
export function resolveRetryPolicy(
  options: ConnectorFetchRetryOptions,
  requestHeaders: Record<string, string> | undefined,
): ResolvedRetryPolicy {
  const policy = options.retryPolicy ?? "CURRENT_BEHAVIOR";
  if (!CONNECTOR_RETRY_POLICIES.includes(policy)) {
    throw new ConnectorRetryPolicyError(`connector.http: unknown retryPolicy "${String(policy)}".`);
  }
  const operation = safeOperationLabel(options.operation);

  const { idempotency } = options;
  if (policy !== "RETRY_WITH_IDEMPOTENCY") {
    if (idempotency !== undefined) {
      throw new ConnectorRetryPolicyError(
        `connector.http: an idempotency key is only valid with retryPolicy RETRY_WITH_IDEMPOTENCY (got ${policy}).`,
      );
    }
    return { policy, operation, extraHeaders: {} };
  }

  if (!idempotency || typeof idempotency.header !== "string" || typeof idempotency.key !== "string") {
    throw new ConnectorRetryPolicyError(
      "connector.http: RETRY_WITH_IDEMPOTENCY requires an idempotency { header, key } the request actually carries.",
    );
  }
  if (!HEADER_TOKEN.test(idempotency.header)) {
    throw new ConnectorRetryPolicyError("connector.http: the idempotency header name is not a valid header token.");
  }
  if (!IDEMPOTENCY_KEY.test(idempotency.key)) {
    throw new ConnectorRetryPolicyError(
      "connector.http: the idempotency key must be 8-255 printable characters without whitespace.",
    );
  }
  const wanted = idempotency.header.toLowerCase();
  for (const [name, value] of Object.entries(requestHeaders ?? {})) {
    if (name.toLowerCase() === wanted && value !== idempotency.key) {
      throw new ConnectorRetryPolicyError(
        "connector.http: the request already carries the idempotency header with a different value.",
      );
    }
  }
  return { policy, operation, extraHeaders: { [idempotency.header]: idempotency.key } };
}

/** Whether the client may repeat a call after a retryable outcome. */
export function automaticRetryAllowed(policy: ConnectorRetryPolicy): boolean {
  return policy !== "NO_AUTOMATIC_RETRY";
}

function safeOperationLabel(value: string | undefined): string | null {
  if (value === undefined) return null;
  return /^[A-Za-z0-9_.:-]{1,64}$/.test(value) ? value : "invalid_label";
}
