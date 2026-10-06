/**
 * Closed reason-code catalog for publication-target evaluation (ADR-0015, docs/design/publication-targets-contract.md section 3).
 *
 * Adding a code means: add a row here, which widens PublicationReasonCode, and let the invariant spec confirm the
 * catalog and the design document still agree. Messages are seller-safe: no provider text, no credentials, no
 * tenant data. Operator detail belongs in the structured code and evidence reference.
 */

export type PublicationConditionId =
  | "definition_exists"
  | "runtime_registered"
  | "publish_declared"
  | "capability_verified"
  | "release_allowed"
  | "commercially_supported"
  | "target_schema_ready"
  | "installation_eligible"
  | "credential_acceptable"
  | "mapping_ready"
  | "product_ready"
  | "prior_outcome_settled";

export type PublicationReasonOwner = "platform" | "tenant_admin" | "seller";

/** "blocking" always blocks, "warning" never blocks, "conditional" depends on the operation (see the entry). */
export type PublicationReasonSeverity = "blocking" | "warning" | "conditional";

export interface PublicationReasonEntry {
  readonly condition: PublicationConditionId | "any";
  readonly severity: PublicationReasonSeverity;
  readonly owner: PublicationReasonOwner;
  readonly message: string;
}

export const PUBLICATION_REASON_CATALOG = {
  CONNECTOR_NOT_DEFINED: {
    condition: "definition_exists",
    severity: "blocking",
    owner: "platform",
    message: "This channel is not available.",
  },
  CONNECTOR_NOT_REGISTERED: {
    condition: "runtime_registered",
    severity: "blocking",
    owner: "platform",
    message: "This channel is not available.",
  },
  PUBLISH_NOT_DECLARED: {
    condition: "publish_declared",
    severity: "blocking",
    owner: "platform",
    message: "This channel does not support publishing.",
  },
  CAPABILITY_NOT_VERIFIED: {
    condition: "capability_verified",
    severity: "blocking",
    owner: "platform",
    message: "Publishing to this channel has not been verified for use.",
  },
  RECERTIFICATION_REQUIRED: {
    condition: "capability_verified",
    severity: "blocking",
    owner: "platform",
    message: "Verification for this channel is out of date or its schema changed and needs re-verification.",
  },
  CONNECTOR_POLICY_MISSING: {
    condition: "release_allowed",
    severity: "blocking",
    owner: "platform",
    message: "This channel is not available.",
  },
  P1_BLOCKER_HOLD: {
    condition: "release_allowed",
    severity: "blocking",
    owner: "platform",
    message: "Publishing to this channel is on hold.",
  },
  LAUNCH_STAGE_NOT_PUBLISHABLE: {
    condition: "release_allowed",
    severity: "blocking",
    owner: "platform",
    message: "This channel is not open for publishing yet.",
  },
  RELEASE_RESTRICTED: {
    condition: "release_allowed",
    severity: "blocking",
    owner: "platform",
    message: "This channel is limited to selected accounts and yours is not included.",
  },
  NOT_COMMERCIALLY_SUPPORTED: {
    condition: "commercially_supported",
    severity: "blocking",
    owner: "platform",
    message: "This channel is not supported for production use.",
  },
  TARGET_SCHEMA_MISSING: {
    condition: "target_schema_ready",
    severity: "blocking",
    owner: "platform",
    message: "No target schema exists for this product type.",
  },
  TARGET_SCHEMA_STALE: {
    condition: "target_schema_ready",
    severity: "blocking",
    owner: "platform",
    message: "The target schema needs refreshing.",
  },
  NO_INSTALLATION: {
    condition: "installation_eligible",
    severity: "blocking",
    owner: "tenant_admin",
    message: "Install a connector account first.",
  },
  INSTALLATION_NOT_ACTIVE: {
    condition: "installation_eligible",
    severity: "blocking",
    owner: "tenant_admin",
    message: "The connected account is paused or disabled.",
  },
  INSTALLATION_AUTH_INCOMPLETE: {
    condition: "installation_eligible",
    severity: "blocking",
    owner: "tenant_admin",
    message: "Finish authorizing the connected account.",
  },
  CREDENTIAL_INVALID: {
    condition: "credential_acceptable",
    severity: "blocking",
    owner: "tenant_admin",
    message: "The channel rejected the saved credentials.",
  },
  CREDENTIAL_NEVER_VALIDATED: {
    condition: "credential_acceptable",
    severity: "blocking",
    owner: "tenant_admin",
    message: "The saved credentials have never been verified.",
  },
  CREDENTIAL_NOT_PROVIDER_VERIFIED: {
    condition: "credential_acceptable",
    severity: "blocking",
    owner: "platform",
    message: "The saved credentials have not been checked with the channel yet.",
  },
  CREDENTIAL_STALE: {
    condition: "credential_acceptable",
    severity: "blocking",
    owner: "tenant_admin",
    message: "The saved credentials have not been verified recently.",
  },
  CREDENTIAL_CONFIGURATION_ERROR: {
    condition: "credential_acceptable",
    severity: "blocking",
    owner: "tenant_admin",
    message: "The configured store address was refused.",
  },
  CREDENTIAL_CHECK_INCONCLUSIVE: {
    condition: "credential_acceptable",
    severity: "warning",
    owner: "tenant_admin",
    message: "The last credential check could not reach the channel.",
  },
  MAPPING_NOT_READY: {
    condition: "mapping_ready",
    severity: "blocking",
    owner: "tenant_admin",
    message: "Field mapping is missing, blocked or needs to be redone.",
  },
  MAPPING_DEPRECATED: {
    condition: "mapping_ready",
    severity: "warning",
    owner: "tenant_admin",
    message: "The mapping uses fields the channel is retiring (still compatible).",
  },
  PRODUCT_NOT_READY: {
    condition: "product_ready",
    severity: "blocking",
    owner: "seller",
    message: "This product has blocking issues for this channel.",
  },
  // Blocks another AMBIGUOUS create (Odoo, Etsy, Dynamics 365) for the same installation and product until the
  // outcome is settled; a warning only for operations proven idempotent or reconciliation-safe.
  PRIOR_PROVIDER_OUTCOME_UNKNOWN: {
    condition: "prior_outcome_settled",
    severity: "conditional",
    owner: "seller",
    message: "A previous publish may already have reached the channel; check before publishing again.",
  },
  EVALUATION_UNAVAILABLE: {
    condition: "any",
    severity: "blocking",
    owner: "platform",
    message: "Readiness could not be determined.",
  },
} as const satisfies Record<string, PublicationReasonEntry>;

export type PublicationReasonCode = keyof typeof PUBLICATION_REASON_CATALOG;

export const PUBLICATION_REASON_CODES = Object.keys(PUBLICATION_REASON_CATALOG) as PublicationReasonCode[];

export function isPublicationReasonCode(value: unknown): value is PublicationReasonCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PUBLICATION_REASON_CATALOG, value);
}
