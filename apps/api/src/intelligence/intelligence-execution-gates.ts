import type { AiProviderExecutionDenialReason } from "./intelligence.types";
import { microsToString } from "./intelligence-money";

/**
 * Pure, side-effect-free gate logic for provider execution (AI-PROV-004b design, section 2).
 *
 *   G0 deploy flag AND G1 platform control AND G2 tenant policy AND G3 capability/provider pin AND G4 budget = ALLOW
 *
 * Every function here returns a denial reason or `null`. A missing, malformed, expired or unreadable
 * input is a denial. Nothing in this file reads the environment variable value other than through
 * `readDeployFlag`, and nothing performs I/O.
 */

/** The single environment variable that gates the live execution path at deploy time. Default OFF. */
export const DEPLOY_FLAG_ENV = "FEATURE_INTELLIGENCE_PROVIDER_ENABLED";

/** Code-level live allow-list. 004b allows exactly one capability. */
export const LIVE_PROVIDER_CAPABILITY_ALLOWLIST: readonly string[] = ["product_attribute_extraction"];

/** Currency supported by the control plane in 004b. */
export const SUPPORTED_CURRENCY = "USD";

export const PLATFORM_CONTROL_ID = "global";

/** Admission-to-dispatch TTL for an unclaimed reservation. */
export const UNCLAIMED_RESERVATION_TTL_MS = 15 * 60 * 1000;
/** Provider timeout the lease must cover. */
export const PROVIDER_TIMEOUT_MS = 20 * 1000;
/** Grace beyond the provider timeout before a dispatching reservation is declared expired. */
export const DISPATCH_LEASE_GRACE_MS = 60 * 1000;
export const DISPATCH_LEASE_MS = PROVIDER_TIMEOUT_MS + DISPATCH_LEASE_GRACE_MS;

/** Strict parse: ON only when the trimmed, case-insensitive value is exactly `true`. */
export function parseDeployFlag(raw: string | undefined | null): boolean {
  return typeof raw === "string" && raw.trim().toLowerCase() === "true";
}

export function readDeployFlag(env: NodeJS.ProcessEnv = process.env): boolean {
  return parseDeployFlag(env[DEPLOY_FLAG_ENV]);
}

export type PlatformControlRow = {
  id: string;
  enabled: boolean;
  killSwitch: boolean;
  allowedProvider: string | null;
  allowedModel: string | null;
  allowedTenantKeys: string[];
  maxRequestCostMicros: bigint;
};

export type GateDenial = AiProviderExecutionDenialReason;

export type PlatformGateInput = {
  tenantKey: string;
  providerKey: string;
  modelKey: string;
  estimatedCostMicros: bigint;
};

/** G1. A missing or malformed row is a denial, as is any state that is not exactly enabled, not killed and pinned. */
export function evaluatePlatformControl(row: PlatformControlRow | null | undefined, input: PlatformGateInput): GateDenial | null {
  if (!row) {
    return "platform_control_missing";
  }
  if (
    row.id !== PLATFORM_CONTROL_ID ||
    typeof row.enabled !== "boolean" ||
    typeof row.killSwitch !== "boolean" ||
    !Array.isArray(row.allowedTenantKeys) ||
    typeof row.maxRequestCostMicros !== "bigint" ||
    row.maxRequestCostMicros < 0n
  ) {
    return "platform_control_invalid";
  }
  if (row.killSwitch) {
    return "platform_kill_switch";
  }
  if (!row.enabled) {
    return "platform_feature_disabled";
  }
  if (!row.allowedTenantKeys.includes(input.tenantKey)) {
    return "tenant_not_allowlisted";
  }
  if (!row.allowedProvider || !row.allowedModel || row.allowedProvider !== input.providerKey || row.allowedModel !== input.modelKey) {
    return "provider_pin_mismatch";
  }
  if (row.maxRequestCostMicros <= 0n || input.estimatedCostMicros > row.maxRequestCostMicros) {
    return "request_cost_exceeded";
  }
  return null;
}

export type TenantPolicyRow = {
  intelligenceEnabled: boolean;
  providerExecutionEnabled: boolean;
  killSwitchEnabled: boolean;
  tenantOptOut: boolean;
  approvedBy: string | null;
  approvedAt: Date | null;
  maxPayloadBytes: number;
  allowedCapabilities: unknown;
  allowedProviderKeys: unknown;
};

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === "string") : [];
}

/** G2 and the provider part of G3 for the tenant policy row. */
export function evaluateTenantPolicy(policy: TenantPolicyRow, capability: string, providerKey: string): GateDenial | null {
  if (!policy.intelligenceEnabled || !policy.providerExecutionEnabled || policy.killSwitchEnabled || policy.tenantOptOut) {
    return "tenant_provider_disabled";
  }
  if (!policy.approvedBy || !policy.approvedAt) {
    return "invalid_tenant_policy";
  }
  if (!Number.isInteger(policy.maxPayloadBytes) || policy.maxPayloadBytes <= 0) {
    return "invalid_tenant_policy";
  }
  if (!stringList(policy.allowedCapabilities).includes(capability)) {
    return "capability_disallowed";
  }
  if (!stringList(policy.allowedProviderKeys).includes(providerKey)) {
    return "tenant_provider_disabled";
  }
  return null;
}

/** G3, capability half: in the code-level live allow-list. The registry scope check stays in the service. */
export function isLiveCapability(capability: string): boolean {
  return LIVE_PROVIDER_CAPABILITY_ALLOWLIST.includes(capability);
}

export type BudgetCounterRow = {
  id: string;
  enabled: boolean;
  currency: string;
  spendLimitMicros: bigint;
  reservedSpendMicros: bigint;
  spentSpendMicros: bigint;
  requestLimit: number;
  requestCount: number;
  periodStartedAt: Date;
  periodEndsAt: Date;
  effectiveFrom?: Date | null;
  effectiveUntil?: Date | null;
};

/** G4, row validity only. The atomic conditional UPDATE decides whether the remaining budget fits. */
export function evaluateBudgetCounterRow(row: BudgetCounterRow | null | undefined, now: Date): GateDenial | null {
  if (!row) {
    return "missing_budget_policy";
  }
  if (
    !row.enabled ||
    row.currency !== SUPPORTED_CURRENCY ||
    row.spendLimitMicros <= 0n ||
    row.requestLimit <= 0 ||
    row.reservedSpendMicros < 0n ||
    row.spentSpendMicros < 0n ||
    row.requestCount < 0 ||
    row.periodStartedAt > now ||
    row.periodEndsAt <= now ||
    (row.effectiveFrom && row.effectiveFrom > now) ||
    (row.effectiveUntil && row.effectiveUntil <= now)
  ) {
    return "invalid_budget_policy";
  }
  return null;
}

/** UTC day period key, `D:YYYY-MM-DD`. Derived on the server, never accepted from a caller. */
export function dayPeriodKey(now: Date): string {
  return `D:${now.toISOString().slice(0, 10)}`;
}

/** UTC month period key, `M:YYYY-MM`. */
export function monthPeriodKey(now: Date): string {
  return `M:${now.toISOString().slice(0, 7)}`;
}

export type ChargeScope = "tenant_day" | "tenant_month" | "platform_day" | "platform_month";

/** The fixed order in which counters are charged. Never reorder: it is what rules out deadlock. */
export const CHARGE_ORDER: readonly ChargeScope[] = ["platform_month", "platform_day", "tenant_month", "tenant_day"];

/** Serialises money for a log or audit payload. */
export function moneyFields(fields: Record<string, bigint | null | undefined>): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    out[key] = value === null || value === undefined ? null : microsToString(value);
  }
  return out;
}
