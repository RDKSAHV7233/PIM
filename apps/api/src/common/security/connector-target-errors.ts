import { BadRequestException } from "@nestjs/common";

// Provider-neutral errors for "the tenant-configured target URL must not be
// contacted". Publish/update must report these as what they are (a store-URL
// configuration or security problem), never as a generic publish failure and
// never as "credentials expired". The stable public codes are the two constants
// below; `reason` carries the specific cause and the connector slug is attached
// by the caller that knows the installation.

export const CONNECTOR_TARGET_UNSAFE = "CONNECTOR_TARGET_UNSAFE";
export const CONNECTOR_REDIRECT_BLOCKED = "CONNECTOR_REDIRECT_BLOCKED";

export type ConnectorTargetSecurityCode =
  | typeof CONNECTOR_TARGET_UNSAFE
  | typeof CONNECTOR_REDIRECT_BLOCKED;

export type ConnectorTargetUnsafeReason =
  | "URL_REQUIRED"
  | "URL_INVALID"
  | "HTTPS_REQUIRED"
  | "BLOCKED_HOST"
  | "PRIVATE_IP_LITERAL"
  | "PRIVATE_IP_RESOLVED"
  | "UNRESOLVABLE"
  | "CONNECTED_ADDRESS_NOT_VALIDATED";

export type ConnectorRedirectBlockedReason =
  | "REDIRECT_UNSAFE_TARGET"
  | "REDIRECT_CROSS_ORIGIN"
  | "REDIRECT_INVALID_LOCATION"
  | "REDIRECT_TOO_MANY"
  | "REDIRECT_LOOP"
  | "REDIRECT_METHOD_UNSUPPORTED"
  | "REDIRECT_NOT_ENFORCED";

/**
 * Thrown by validateConnectorTargetUrl. Extends BadRequestException so every
 * existing `instanceof BadRequestException` / message-substring check keeps
 * working unchanged.
 */
export class ConnectorTargetUnsafeError extends BadRequestException {
  readonly code = CONNECTOR_TARGET_UNSAFE;

  constructor(
    message: string,
    readonly reason: ConnectorTargetUnsafeReason,
  ) {
    super(message);
  }
}

/** Thrown by fetchWithValidatedRedirects when a redirect must not be followed. */
export class ConnectorRedirectError extends Error {
  readonly code = CONNECTOR_REDIRECT_BLOCKED;

  constructor(
    readonly reason: ConnectorRedirectBlockedReason,
    message: string,
  ) {
    super(message);
    this.name = "ConnectorRedirectError";
  }
}

export type ConnectorTargetSecurityError = ConnectorTargetUnsafeError | ConnectorRedirectError;

export function isConnectorTargetSecurityError(error: unknown): error is ConnectorTargetSecurityError {
  return error instanceof ConnectorTargetUnsafeError || error instanceof ConnectorRedirectError;
}

export type ConnectorTargetSecurityIssue = {
  code: ConnectorTargetSecurityCode;
  fieldPath: string;
  severity: "error";
  sellerMessage: string;
  reason: string;
  provider: string;
};

/** ConnectorIssue-shaped record for submission channelErrors. */
export function toConnectorTargetSecurityIssue(
  error: ConnectorTargetSecurityError,
  provider: string,
): ConnectorTargetSecurityIssue {
  return {
    code: error.code,
    fieldPath: "",
    severity: "error",
    sellerMessage: error.message,
    reason: error.reason,
    provider,
  };
}

/**
 * Credential-verification reason code for a target-security refusal, prefixed with
 * the connector (e.g. WOOCOMMERCE_REDIRECT_CROSS_ORIGIN). Unsafe targets keep the
 * existing <PREFIX>_<URL>_NOT_HTTPS / <PREFIX>_<URL>_UNSAFE codes; `urlSegment` is
 * the connector's own spelling ('URL', or 'SITE_URL' for WooCommerce).
 */
export function targetSecurityVerificationReason(
  prefix: string,
  error: ConnectorTargetSecurityError,
  urlSegment = "URL",
): string {
  if (error.code === CONNECTOR_REDIRECT_BLOCKED) return `${prefix}_${error.reason}`;
  return error.reason === "HTTPS_REQUIRED" ? `${prefix}_${urlSegment}_NOT_HTTPS` : `${prefix}_${urlSegment}_UNSAFE`;
}
