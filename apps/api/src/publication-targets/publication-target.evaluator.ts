import type { ConnectorLaunchStage } from "../connector-framework/connector-launch-policy";
import {
  PUBLICATION_REASON_CATALOG,
  type PublicationConditionId,
  type PublicationReasonCode,
} from "./publication-target.reason-catalog";
import {
  CERTIFICATION_LEVEL_ORDER,
  type CapabilityEvidence,
  type CertificationLevel,
  type CredentialFreshnessPolicy,
  type PublicationCondition,
  type PublicationConditionScope,
  type PublicationConditionStatus,
  type PublicationEnforcement,
  type PublicationEvaluationContext,
  type PublicationTargetEvaluation,
  type PublicationTargetInput,
} from "./publication-target.types";

/**
 * Pure publication-target evaluator (ADR-0015, Sprint 5.1b). No I/O, no clock, no globals: every fact arrives in
 * `input`, the time and policy in `context`. Nothing in the application calls it yet.
 *
 * The chain (fixed order, always all twelve conditions in the result):
 *
 *   I1  definition exists          != runtime registered
 *   I2  runtime registered         != PUBLISH declared
 *   I3  PUBLISH declared           != capability verified on the product pipeline path
 *   I4  capability verified        != release allowed (launch stage and cohort)
 *   I5  release allowed            != commercially supported (Product Owner record)
 *   I6  commercially supported     != installation / credential / mapping / product readiness
 *   I7  every required condition must pass; `available` is true only when none is fail or unknown
 *
 * Fail-closed rules: an unsupplied fact is `unknown`, an unevaluable condition is `unknown`, a condition that
 * throws is `unknown`, and `unknown` makes the target unavailable with EVALUATION_UNAVAILABLE. It never
 * evaluates to available by default.
 */

export const PUBLICATION_CONDITION_ORDER: readonly PublicationConditionId[] = [
  "definition_exists",
  "runtime_registered",
  "publish_declared",
  "capability_verified",
  "release_allowed",
  "commercially_supported",
  "target_schema_ready",
  "installation_eligible",
  "credential_acceptable",
  "mapping_ready",
  "product_ready",
  "prior_outcome_settled",
];

const CONDITION_SCOPE: Record<PublicationConditionId, PublicationConditionScope> = {
  definition_exists: "platform",
  runtime_registered: "platform",
  publish_declared: "platform",
  capability_verified: "platform",
  release_allowed: "platform",
  commercially_supported: "platform",
  target_schema_ready: "platform",
  installation_eligible: "tenant",
  credential_acceptable: "tenant",
  mapping_ready: "tenant",
  product_ready: "product",
  prior_outcome_settled: "product",
};

// ─── Release stage policy (ADR-0015 section 5) ──────────────────────────────────────────────────────────────

const PUBLISHABLE_STAGES: ReadonlySet<ConnectorLaunchStage> = new Set(["live", "early_access", "controlled_pilot"]);
/** Stages that additionally need an explicit tenant entitlement. `live` has no cohort restriction. */
const COHORT_STAGES: ReadonlySet<ConnectorLaunchStage> = new Set(["early_access", "controlled_pilot"]);

/** Minimum product-pipeline PUBLISH evidence by stage. null = the stage does not publish through the pipeline. */
export function minimumPipelineEvidenceLevel(stage: ConnectorLaunchStage): CertificationLevel | null {
  switch (stage) {
    case "live":
      return "certified";
    case "early_access":
      return "production_verified";
    case "controlled_pilot":
      return "sandbox_verified";
    default:
      return null;
  }
}

function levelRank(level: string): number {
  return CERTIFICATION_LEVEL_ORDER.indexOf(level as CertificationLevel);
}

// ─── Credential freshness policy (ADR-0015 section 8) ───────────────────────────────────────────────────────

/** credentialFreshnessWindow >= 2 x heartbeatMaxRotation + one scheduler interval. */
export function requiredCredentialFreshnessWindowMs(policy: Pick<CredentialFreshnessPolicy, "heartbeatMaxRotationMs" | "schedulerIntervalMs">): number {
  return 2 * policy.heartbeatMaxRotationMs + policy.schedulerIntervalMs;
}

export function isCredentialFreshnessPolicySupportable(policy: CredentialFreshnessPolicy): boolean {
  const values = [policy.windowMs, policy.heartbeatMaxRotationMs, policy.schedulerIntervalMs];
  if (!values.every((value) => Number.isFinite(value) && value > 0)) return false;
  return policy.windowMs >= requiredCredentialFreshnessWindowMs(policy);
}

// ─── Condition construction ─────────────────────────────────────────────────────────────────────────────────

const BLOCKED_BY_EARLIER = "Not evaluated because an earlier condition did not pass (BLOCKED_BY_EARLIER_CONDITION).";

interface Extras {
  evidenceRef?: string | null;
  enforcement?: PublicationEnforcement;
  message?: string;
}

function build(
  id: PublicationConditionId,
  status: PublicationConditionStatus,
  code: PublicationReasonCode | null,
  message: string,
  extras: Extras = {},
): PublicationCondition {
  const blocking = status === "fail" || status === "unknown";
  return {
    id,
    scope: CONDITION_SCOPE[id],
    status,
    code,
    blocking,
    owner: code ? PUBLICATION_REASON_CATALOG[code].owner : null,
    message,
    evidenceRef: extras.evidenceRef ?? null,
    enforcement: extras.enforcement ?? "enforced",
  };
}

const pass = (id: PublicationConditionId, extras: Extras = {}) => build(id, "pass", null, extras.message ?? "Passed.", extras);

const fail = (id: PublicationConditionId, code: PublicationReasonCode, extras: Extras = {}) =>
  build(id, "fail", code, extras.message ?? PUBLICATION_REASON_CATALOG[code].message, extras);

const warn = (id: PublicationConditionId, code: PublicationReasonCode, extras: Extras = {}) =>
  build(id, "warn", code, extras.message ?? PUBLICATION_REASON_CATALOG[code].message, extras);

const unknown = (id: PublicationConditionId, extras: Extras = {}) =>
  build(id, "unknown", "EVALUATION_UNAVAILABLE", extras.message ?? PUBLICATION_REASON_CATALOG.EVALUATION_UNAVAILABLE.message, extras);

const notApplicable = (id: PublicationConditionId, message: string) => build(id, "not_applicable", null, message);

/** A condition that throws is `unknown`, never absent and never pass. */
function guarded(id: PublicationConditionId, run: () => PublicationCondition): PublicationCondition {
  try {
    return run();
  } catch {
    return unknown(id);
  }
}

// ─── The evaluator ──────────────────────────────────────────────────────────────────────────────────────────

export function evaluatePublicationTarget(
  input: PublicationTargetInput,
  context: PublicationEvaluationContext,
): PublicationTargetEvaluation {
  const slug = String(input.slug ?? "").trim().toLowerCase();
  const nowMs = context.now.getTime();
  const byId = new Map<PublicationConditionId, PublicationCondition>();
  const record = (condition: PublicationCondition) => {
    byId.set(condition.id, condition);
    return condition;
  };
  const passed = (id: PublicationConditionId) => byId.get(id)?.status === "pass";

  // 1. definition_exists
  record(
    guarded("definition_exists", () => {
      if (input.definition === undefined) return unknown("definition_exists");
      if (input.definition === null || input.definition.isActive !== true) return fail("definition_exists", "CONNECTOR_NOT_DEFINED");
      return pass("definition_exists");
    }),
  );

  // 2. runtime_registered
  record(
    guarded("runtime_registered", () => {
      if (input.runtimeRegistered === undefined) return unknown("runtime_registered");
      return input.runtimeRegistered === true ? pass("runtime_registered") : fail("runtime_registered", "CONNECTOR_NOT_REGISTERED");
    }),
  );

  // 3. publish_declared
  record(
    guarded("publish_declared", () => {
      if (!passed("definition_exists") || !input.definition) return notApplicable("publish_declared", BLOCKED_BY_EARLIER);
      return input.definition.capabilities.includes("PUBLISH")
        ? pass("publish_declared")
        : fail("publish_declared", "PUBLISH_NOT_DECLARED");
    }),
  );

  // 4. capability_verified (product-pipeline path only)
  record(
    guarded("capability_verified", () => {
      if (!passed("publish_declared")) return notApplicable("capability_verified", BLOCKED_BY_EARLIER);
      if (input.launchPolicy === undefined || input.evidence === undefined) return unknown("capability_verified");
      const minimum = minimumPipelineEvidenceLevel(input.launchPolicy.launchStage);
      if (minimum === null) {
        return notApplicable("capability_verified", "No pipeline evidence minimum applies at this launch stage; release_allowed reports the stage.");
      }
      const minimumRank = levelRank(minimum);
      const pipeline = input.evidence.filter(
        (entry) =>
          String(entry.connector ?? "").trim().toLowerCase() === slug && entry.capability === "PUBLISH" && entry.path === "product_pipeline",
      );
      const sufficient = pipeline.filter((entry) => levelRank(entry.level) >= minimumRank);
      if (sufficient.length === 0) return fail("capability_verified", "CAPABILITY_NOT_VERIFIED");

      const current = sufficient.filter((entry) => isEvidenceCurrent(entry, nowMs));
      if (current.length === 0) {
        return fail("capability_verified", "RECERTIFICATION_REQUIRED", { evidenceRef: sufficient[0]?.evidenceRef ?? null });
      }
      const best = current.reduce((a, b) => (levelRank(b.level) > levelRank(a.level) ? b : a));
      return pass("capability_verified", { evidenceRef: best.evidenceRef });
    }),
  );

  // 5. release_allowed (stage, then the tenant cohort)
  record(
    guarded("release_allowed", () => {
      if (input.launchPolicy === undefined) return unknown("release_allowed");
      const { launchStage, reason } = input.launchPolicy;
      if (reason === "CONNECTOR_POLICY_MISSING") return fail("release_allowed", "CONNECTOR_POLICY_MISSING");
      if (launchStage === "p1_blocker_hold") return fail("release_allowed", "P1_BLOCKER_HOLD");
      if (!PUBLISHABLE_STAGES.has(launchStage)) return fail("release_allowed", "LAUNCH_STAGE_NOT_PUBLISHABLE");
      if (!COHORT_STAGES.has(launchStage)) return pass("release_allowed");

      const entitlement = input.tenantEntitlement;
      if (entitlement === undefined) return unknown("release_allowed");
      if (entitlement === null) return fail("release_allowed", "RELEASE_RESTRICTED");
      const active =
        entitlement.releaseStage === launchStage &&
        entitlement.validFrom.getTime() <= nowMs &&
        (entitlement.validUntil === null || entitlement.validUntil.getTime() > nowMs) &&
        (entitlement.revokedAt === null || entitlement.revokedAt.getTime() > nowMs);
      return active ? pass("release_allowed") : fail("release_allowed", "RELEASE_RESTRICTED");
    }),
  );

  // 6. commercially_supported (Product Owner accountable; default false; never derived from the adapter)
  record(
    guarded("commercially_supported", () => {
      const support = input.commercialSupport;
      if (support === undefined) return unknown("commercially_supported");
      const approved =
        support !== null &&
        support.commerciallySupported === true &&
        support.approvedBy === "PO" &&
        typeof support.approvalRef === "string" &&
        support.approvalRef.trim().length > 0;
      return approved ? pass("commercially_supported", { evidenceRef: support?.approvalRef ?? null }) : fail("commercially_supported", "NOT_COMMERCIALLY_SUPPORTED");
    }),
  );

  // 7. target_schema_ready
  record(
    guarded("target_schema_ready", () => {
      switch (input.targetSchema) {
        case "ready":
          return pass("target_schema_ready");
        case "missing":
          return fail("target_schema_ready", "TARGET_SCHEMA_MISSING");
        case "stale":
          return fail("target_schema_ready", "TARGET_SCHEMA_STALE");
        default:
          return unknown("target_schema_ready");
      }
    }),
  );

  // 8. installation_eligible. CREDENTIAL_EXPIRED is what an INVALID heartbeat writes; it is reported by
  //    credential_acceptable (CREDENTIAL_INVALID), so it does not also fail here.
  record(
    guarded("installation_eligible", () => {
      const installation = input.installation;
      if (installation === undefined) return unknown("installation_eligible");
      if (installation === null) return fail("installation_eligible", "NO_INSTALLATION");
      if (installation.status !== "ACTIVE" && installation.status !== "CREDENTIAL_EXPIRED") {
        return fail("installation_eligible", "INSTALLATION_NOT_ACTIVE");
      }
      if (installation.authorizationComplete !== true) return fail("installation_eligible", "INSTALLATION_AUTH_INCOMPLETE");
      return pass("installation_eligible");
    }),
  );

  // 9. credential_acceptable (last trustworthy state)
  record(
    guarded("credential_acceptable", () => {
      if (!passed("installation_eligible")) return notApplicable("credential_acceptable", BLOCKED_BY_EARLIER);
      const credential = input.credential;
      if (credential === undefined) return unknown("credential_acceptable");
      if (credential === null) return fail("credential_acceptable", "CREDENTIAL_NEVER_VALIDATED");
      if (credential.installationStatus === "CREDENTIAL_EXPIRED" || credential.lastOutcome === "INVALID") {
        return fail("credential_acceptable", "CREDENTIAL_INVALID");
      }
      if (credential.lastOutcome === "CONFIGURATION_ERROR") return fail("credential_acceptable", "CREDENTIAL_CONFIGURATION_ERROR");
      if (credential.lastValidAt === null) return fail("credential_acceptable", "CREDENTIAL_NEVER_VALIDATED");
      const lastValidMs = credential.lastValidAt.getTime();
      if (!Number.isFinite(lastValidMs)) return unknown("credential_acceptable");
      // TOKEN_ONLY is a credential type, not a health result: only provider authentication counts as VALID.
      if (credential.lastValidProviderVerified !== true) return fail("credential_acceptable", "CREDENTIAL_NOT_PROVIDER_VERIFIED");
      if (!isCredentialFreshnessPolicySupportable(context.credentialFreshness)) {
        // Only staleness depends on the window. An unsupportable window is an operational capacity failure to
        // alert on, never a reason to call healthy credentials stale.
        return unknown("credential_acceptable");
      }
      if (nowMs - lastValidMs > context.credentialFreshness.windowMs) return fail("credential_acceptable", "CREDENTIAL_STALE");
      if (credential.lastOutcome === "INDETERMINATE") return warn("credential_acceptable", "CREDENTIAL_CHECK_INCONCLUSIVE");
      if (credential.lastOutcome === "VALID") return pass("credential_acceptable");
      // No recorded outcome alongside a lastValidAt: the facts disagree, so do not trust them.
      return fail("credential_acceptable", "CREDENTIAL_NEVER_VALIDATED");
    }),
  );

  // 10. mapping_ready
  record(
    guarded("mapping_ready", () => {
      const mapping = input.mapping;
      if (mapping === undefined) return unknown("mapping_ready");
      if (mapping === null) return fail("mapping_ready", "MAPPING_NOT_READY");
      switch (mapping.compatibilityState) {
        case "compatible":
          return pass("mapping_ready");
        case "deprecated":
          return warn("mapping_ready", "MAPPING_DEPRECATED");
        case "remap_required":
        case "blocked":
          return fail("mapping_ready", "MAPPING_NOT_READY");
        default:
          return unknown("mapping_ready");
      }
    }),
  );

  // 11. product_ready (product scope only)
  record(
    guarded("product_ready", () => {
      if (input.scope !== "product") return notApplicable("product_ready", "No product selected.");
      const product = input.product;
      if (product === undefined) return unknown("product_ready");
      const count = product.blockingIssueCount;
      if (!Number.isInteger(count) || count < 0) return unknown("product_ready");
      return count === 0 ? pass("product_ready") : fail("product_ready", "PRODUCT_NOT_READY");
    }),
  );

  // 12. prior_outcome_settled (product scope only; reported in shadow until outcome settlement exists)
  record(
    guarded("prior_outcome_settled", () => {
      if (input.scope !== "product") return notApplicable("prior_outcome_settled", "No product selected.");
      const prior = input.priorOutcome;
      if (prior === undefined) return unknown("prior_outcome_settled");
      if (prior.unsettledUnknownOutcome !== true) return pass("prior_outcome_settled");
      // Only proven idempotent or reconciliation-safe operations merely warn; anything else (including an
      // unrecognized classification) is treated as AMBIGUOUS.
      if (prior.createClassification === "PROVEN_IDEMPOTENT" || prior.createClassification === "PROVEN_RECONCILABLE") {
        return warn("prior_outcome_settled", "PRIOR_PROVIDER_OUTCOME_UNKNOWN");
      }
      return fail("prior_outcome_settled", "PRIOR_PROVIDER_OUTCOME_UNKNOWN", {
        enforcement: context.outcomeSettlementExists ? "enforced" : "shadow_only",
      });
    }),
  );

  const conditions = PUBLICATION_CONDITION_ORDER.map((id) => byId.get(id) ?? unknown(id));
  const blockers = conditions.filter((condition) => condition.blocking);
  const warnings = conditions.filter((condition) => condition.status === "warn");
  const reasonCodes = unique([...blockers, ...warnings].map((condition) => condition.code));
  const shadowOnlyReasonCodes = unique(blockers.filter((condition) => condition.enforcement === "shadow_only").map((condition) => condition.code));

  return {
    key: slug,
    scope: input.scope,
    evaluatedAt: context.now.toISOString(),
    available: blockers.length === 0,
    availableUnderCurrentEnforcement: blockers.every((condition) => condition.enforcement === "shadow_only"),
    blockers,
    warnings,
    reasonCodes,
    shadowOnlyReasonCodes,
    conditions,
  };
}

/**
 * Current means verified (not in the future, not undated) and not past its effective expiry. The effective expiry is
 * the authoritative reverifyBy, or the date of a later schema, API or version change if that comes first
 * (`recertification.at`, derived by applyRecertificationTriggers). The recorded evidence itself is never rewritten.
 */
function isEvidenceCurrent(entry: CapabilityEvidence, nowMs: number): boolean {
  if (typeof entry.reverifyBy !== "string" || typeof entry.verifiedAt !== "string") return false;
  const reverifyMs = Date.parse(entry.reverifyBy);
  const verifiedMs = Date.parse(entry.verifiedAt);
  if (!Number.isFinite(reverifyMs) || !Number.isFinite(verifiedMs)) return false;
  let expiryMs = reverifyMs;
  if (entry.recertification !== undefined) {
    const recertifyMs = Date.parse(entry.recertification.at);
    // A recertification whose date cannot be read cannot be shown to be in the future: treat the evidence as due.
    expiryMs = Number.isFinite(recertifyMs) ? Math.min(expiryMs, recertifyMs) : Number.NEGATIVE_INFINITY;
  }
  return verifiedMs <= nowMs && expiryMs > nowMs;
}

function unique(codes: Array<PublicationReasonCode | null>): PublicationReasonCode[] {
  const seen = new Set<PublicationReasonCode>();
  for (const code of codes) if (code) seen.add(code);
  return [...seen];
}
