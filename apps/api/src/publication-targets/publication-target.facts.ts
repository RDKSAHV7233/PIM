import type { ConnectorLaunchStage } from "../connector-framework/connector-launch-policy";
import {
  CERTIFICATION_LEVEL_ORDER,
  type CapabilityEvidence,
  type CredentialFact,
  type CredentialValidationOutcome,
  type TenantEntitlementFact,
} from "./publication-target.types";

/**
 * Fact derivation (ADR-0015, Sprint 5.1c-3): pure translations from stored records to the evaluator's facts. No I/O:
 * the caller (the 5.1d assembler) reads the rows and passes them in, so none of this touches a database, a clock or
 * a client. Nothing calls it yet.
 *
 * Convention (same as the evaluator): `undefined` = could not be read (the condition becomes `unknown`), `null` =
 * read and absent, a value = known. Every function fails closed: bad data yields a weaker fact, never a stronger one.
 */

// ─── Tenant entitlement (connector_tenant_entitlements) ─────────────────────────────────────────────────────

export interface EntitlementRow {
  tenantKey: string;
  connectorSlug: string;
  releaseStage: string;
  validFrom: Date;
  validUntil: Date | null;
  approvedAt: Date;
  revokedAt: Date | null;
  tenantOptedInAt: Date | null;
}

const COHORT_STAGES: ReadonlySet<ConnectorLaunchStage> = new Set(["controlled_pilot", "early_access"]);

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function normalize(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

/** A grant that counts right now. Applies the database's own rules again as defense in depth. */
function isActiveGrant(row: EntitlementRow, stage: ConnectorLaunchStage, nowMs: number): boolean {
  if (row.releaseStage !== stage) return false;
  if (!isValidDate(row.validFrom) || !isValidDate(row.approvedAt) || row.validFrom.getTime() > nowMs) return false;
  if (row.validUntil !== null && (!isValidDate(row.validUntil) || row.validUntil.getTime() <= nowMs)) return false;
  if (row.revokedAt !== null && (!isValidDate(row.revokedAt) || row.revokedAt.getTime() <= nowMs)) return false;
  // early_access is the tenant's own opt-in AND a recorded grant (the table enforces it; checked again here).
  if (stage === "early_access" && !isValidDate(row.tenantOptedInAt)) return false;
  return true;
}

/**
 * The evaluator's entitlement fact for one tenant, connector and launch stage.
 *  - `rows` undefined: the grants could not be read -> undefined (unknown, the target is unavailable)
 *  - a stage with no cohort (live, or one that does not publish): null. The evaluator does not consult it for `live`,
 *    and a non-publishable stage already fails on its own.
 *  - otherwise the NEWEST grant in effect decides. If it has been revoked or has expired, there is no entitlement,
 *    and an older grant that still looks valid does not revive it. Filtering out ended grants first and picking the
 *    newest of what is left would do exactly that, so this never does. (The table's one-live-grant index makes
 *    that arrangement unlikely; the derivation does not depend on it.)
 *  - a grant that has not started yet is not in effect and neither overrides nor replaces the current one
 *  - corrupt rows (unparseable validFrom or approvedAt) for this tenant, connector and stage: undefined (unknown)
 * Rows of other tenants or connectors are ignored even if the caller passed them.
 */
export function deriveTenantEntitlementFact(input: {
  tenantKey: string;
  connector: string;
  stage: ConnectorLaunchStage;
  rows: readonly EntitlementRow[] | undefined;
  now: Date;
}): TenantEntitlementFact | null | undefined {
  if (input.rows === undefined) return undefined;
  if (!COHORT_STAGES.has(input.stage)) return null;
  if (!isValidDate(input.now)) return undefined;

  const nowMs = input.now.getTime();
  const tenantKey = String(input.tenantKey ?? "");
  const connector = normalize(input.connector);
  const relevant = input.rows.filter(
    (row) => row.tenantKey === tenantKey && normalize(row.connectorSlug) === connector && row.releaseStage === input.stage,
  );
  // A row whose own dates cannot be read cannot be ordered, so nothing about this entitlement can be trusted.
  if (relevant.some((row) => !isValidDate(row.validFrom) || !isValidDate(row.approvedAt))) return undefined;

  const inEffect = relevant.filter((row) => row.validFrom.getTime() <= nowMs);
  if (inEffect.length === 0) return null;

  // The most recent decision wins. Equal timestamps cannot be ordered, so every tied grant must still hold.
  const newestMs = Math.max(...inEffect.map((row) => row.approvedAt.getTime()));
  const decisive = inEffect.filter((row) => row.approvedAt.getTime() === newestMs);
  if (!decisive.every((row) => isActiveGrant(row, input.stage, nowMs))) return null;

  const chosen = decisive.reduce((a, b) => (b.validFrom.getTime() > a.validFrom.getTime() ? b : a));
  return { releaseStage: input.stage, validFrom: chosen.validFrom, validUntil: chosen.validUntil, revokedAt: chosen.revokedAt };
}

// ─── Provider-verified credential (connector_installations) ─────────────────────────────────────────────────

export interface InstallationVerificationRow {
  /** connector_installations.status */
  status: string;
  lastValidationOutcome: string | null;
  /** last_validated_at: when a validation last came back VALID, possibly a TOKEN_ONLY one with no provider call. */
  lastValidatedAt: Date | null;
  /** last_provider_verified_at: when a credential was last authenticated against the provider. */
  lastProviderVerifiedAt: Date | null;
  lastProviderVerificationKind: string | null;
}

const OUTCOMES: readonly CredentialValidationOutcome[] = ["VALID", "INVALID", "INDETERMINATE", "CONFIGURATION_ERROR"];
const VERIFICATION_KIND = /^[A-Z][A-Z0-9_]{0,63}$/;

/**
 * The evaluator's credential fact.
 *
 * `TOKEN_ONLY` is a credential type, not a health result. A credential counts as provider-verified only when the
 * installation carries a provider-authentication time, from a real kind (never TOKEN_ONLY). Then freshness is
 * measured from THAT time, so a later token-only VALID cannot make a credential look fresh. Otherwise the
 * credential is not provider-verified, whatever last_validated_at says, and `lastValidAt` is only the
 * (possibly token-only) validation time, which the evaluator reports as CREDENTIAL_NOT_PROVIDER_VERIFIED.
 *
 * Because the provider facts live in their own columns, a later INDETERMINATE attempt does not erase them: recent
 * provider-verified VALID followed by INDETERMINATE stays a warning, not a block.
 *
 * undefined (unknown) for: no row read, an unrecognized outcome, an unparseable or future timestamp.
 */
export function deriveCredentialFact(row: InstallationVerificationRow | null | undefined, now: Date): CredentialFact | null | undefined {
  if (row === undefined) return undefined;
  if (row === null) return null;
  if (!isValidDate(now)) return undefined;
  const nowMs = now.getTime();

  let lastOutcome: CredentialValidationOutcome | null = null;
  if (row.lastValidationOutcome !== null) {
    if (!OUTCOMES.includes(row.lastValidationOutcome as CredentialValidationOutcome)) return undefined;
    lastOutcome = row.lastValidationOutcome as CredentialValidationOutcome;
  }

  if (row.lastValidatedAt !== null && (!isValidDate(row.lastValidatedAt) || row.lastValidatedAt.getTime() > nowMs)) return undefined;
  if (row.lastProviderVerifiedAt !== null && (!isValidDate(row.lastProviderVerifiedAt) || row.lastProviderVerifiedAt.getTime() > nowMs)) {
    return undefined;
  }

  const providerVerified =
    row.lastProviderVerifiedAt !== null &&
    typeof row.lastProviderVerificationKind === "string" &&
    VERIFICATION_KIND.test(row.lastProviderVerificationKind) &&
    row.lastProviderVerificationKind !== "TOKEN_ONLY";

  return {
    installationStatus: row.status,
    lastOutcome,
    lastValidAt: providerVerified ? row.lastProviderVerifiedAt : row.lastValidatedAt,
    lastValidProviderVerified: providerVerified,
  };
}

// ─── Recertification triggers ───────────────────────────────────────────────────────────────────────────────

/**
 * A change that invalidates evidence recorded before it (ADR-0013): a target schema at `remap_required` or above, a
 * provider API version change, or a connector major version change.
 */
export interface RecertificationTrigger {
  connector: string;
  /** Omitted means every capability of the connector. */
  capability?: string;
  kind: "SCHEMA_REMAP_REQUIRED" | "PROVIDER_API_VERSION_CHANGE" | "CONNECTOR_VERSION_CHANGE";
  occurredAt: string;
  ref: string | null;
}

/**
 * Evidence annotated with the change that makes it need recertification. The certification record itself is NOT
 * rewritten: `verifiedAt`, `reverifyBy`, the references, provenance and every other field are returned exactly as
 * recorded, and the only addition is `recertification: { kind, at, ref }`. The evaluator treats the earlier of
 * `reverifyBy` and `recertification.at` as the effective expiry, so it reports RECERTIFICATION_REQUIRED from the
 * change onward (a change in the future takes effect when it occurs) while the audit trail of what was verified,
 * when, and until when stays intact.
 *
 * A trigger at or before `verifiedAt` changes nothing: the evidence was gathered after the change. The earliest
 * applicable trigger wins. An unparseable trigger date fails closed: the evidence is treated as already due. If the
 * evidence's own `reverifyBy` comes first, the change is not what ends it and nothing is attributed to it. Untested
 * entries are untouched. Returns new objects; the input is never mutated.
 */
export function applyRecertificationTriggers(
  evidence: readonly CapabilityEvidence[],
  triggers: readonly RecertificationTrigger[],
): CapabilityEvidence[] {
  return evidence.map((entry) => {
    if (entry.level === "untested" || CERTIFICATION_LEVEL_ORDER.indexOf(entry.level) < 0 || typeof entry.verifiedAt !== "string") return entry;
    const verifiedMs = Date.parse(entry.verifiedAt);
    if (!Number.isFinite(verifiedMs)) return entry;

    let earliest: { atMs: number; at: string; trigger: RecertificationTrigger } | null = null;
    for (const trigger of triggers) {
      if (normalize(trigger.connector) !== normalize(entry.connector)) continue;
      if (trigger.capability !== undefined && trigger.capability !== entry.capability) continue;
      const parsed = Date.parse(trigger.occurredAt);
      // Unparseable: cannot show the evidence post-dates the change, so it counts as already due.
      const atMs = Number.isFinite(parsed) ? parsed : verifiedMs;
      if (Number.isFinite(parsed) && parsed <= verifiedMs) continue;
      if (earliest === null || atMs < earliest.atMs) earliest = { atMs, at: new Date(atMs).toISOString(), trigger };
    }
    if (earliest === null) return entry;

    // The evidence's own date already comes first: the change is not what ends it, so nothing is attributed to it.
    const currentMs = typeof entry.reverifyBy === "string" ? Date.parse(entry.reverifyBy) : Number.NaN;
    if (Number.isFinite(currentMs) && currentMs <= earliest.atMs) return entry;
    return {
      ...entry,
      recertification: { kind: earliest.trigger.kind, at: earliest.at, ref: earliest.trigger.ref },
    };
  });
}
