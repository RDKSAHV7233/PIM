import {
  CERTIFICATION_LEVEL_ORDER,
  type CapabilityEvidence,
  type CertificationLevel,
  type EvidencePath,
} from "./publication-target.types";

/**
 * Capability evidence manifest (ADR-0015 section 5, Sprint 5.1c-1): typed, reviewed data with one entry per
 * (connector, capability, path). Changed only by PR. Nothing reads it yet; 5.1c-3 turns it into evaluator facts.
 *
 * Rules the entries follow (full table and sources: docs/connectors/PUBLICATION_EVIDENCE_INVENTORY_2026-10-06.md):
 *  - An entry above `untested` must trace to a dated, referenced event in the repository. A level that only
 *    appears in ADR-0007's Gate 0 baseline (a classification, not an event) is NOT carried over: it is `untested`.
 *  - `product_pipeline` means the product export job through MarketplaceService. Only that path can satisfy
 *    publication readiness. Calling the adapter with its own context is `direct_adapter`.
 *  - `reverifyBy` is authoritative. It is set once, from `verifiedAt`, by the policy default for the level
 *    (sandbox_verified +30d, production_verified +30d, certified +90d); an explicit shorter date wins.
 *  - Levels below sandbox_verified carry no `reverifyBy`: they satisfy no release stage.
 *  - Where evidence cannot be found, the entry is `untested`, never a guess.
 */

export const EVIDENCE_REVERIFY_DEFAULT_DAYS: Readonly<Partial<Record<CertificationLevel, number>>> = {
  sandbox_verified: 30,
  production_verified: 30,
  certified: 90,
};

const DAY_MS = 86_400_000;

/** Policy default for `reverifyBy` at creation. An explicit shorter date (certification or security policy) wins. */
export function defaultReverifyBy(level: CertificationLevel, verifiedAt: string | null, explicitShorter: string | null = null): string | null {
  const days = EVIDENCE_REVERIFY_DEFAULT_DAYS[level];
  if (days === undefined || verifiedAt === null) return null;
  const verifiedMs = Date.parse(verifiedAt);
  if (!Number.isFinite(verifiedMs)) return null;
  const policyMs = verifiedMs + days * DAY_MS;
  if (explicitShorter !== null) {
    const explicitMs = Date.parse(explicitShorter);
    if (Number.isFinite(explicitMs) && explicitMs < policyMs) return new Date(explicitMs).toISOString();
  }
  return new Date(policyMs).toISOString();
}

// ─── Declared capabilities ──────────────────────────────────────────────────────────────────────────────────
// Connectors that declare PUBLISH. Mirrors connector_definitions / the connector classes and is checked against
// the generated docs/connectors/CONNECTOR_INVENTORY.json by the manifest spec, so it cannot drift silently.
// Export-only connectors (meesho, nykaa) are not publication targets and have no entries.
export const PUBLISH_CONNECTOR_CAPABILITIES: Readonly<Record<string, readonly string[]>> = {
  "amazon-in": ["PUBLISH", "VALIDATE", "STATUS_SYNC", "WEBHOOK_RECEIVE"],
  bigcommerce: ["PUBLISH", "VALIDATE", "STATUS_SYNC"],
  "dynamics-365": ["PUBLISH", "VALIDATE", "STATUS_SYNC"],
  ebay: ["PUBLISH", "VALIDATE", "STATUS_SYNC"],
  etsy: ["PUBLISH", "VALIDATE", "STATUS_SYNC"],
  flipkart: ["PUBLISH", "VALIDATE", "STATUS_SYNC", "EXCEL_EXPORT"],
  myntra: ["PUBLISH", "VALIDATE", "STATUS_SYNC"],
  odoo: ["PUBLISH", "VALIDATE", "STATUS_SYNC"],
  prestashop: ["PUBLISH", "VALIDATE", "STATUS_SYNC"],
  shopify: ["PUBLISH", "VALIDATE", "STATUS_SYNC", "WEBHOOK_RECEIVE"],
  shopware: ["PUBLISH", "VALIDATE", "STATUS_SYNC"],
  woocommerce: ["PUBLISH", "VALIDATE", "STATUS_SYNC", "WEBHOOK_RECEIVE"],
  "zoho-inventory": ["PUBLISH", "VALIDATE", "STATUS_SYNC"],
};

// ─── Recorded evidence (everything not listed here is untested) ─────────────────────────────────────────────

interface RecordedEvidence {
  connector: string;
  capability: string;
  path: EvidencePath;
  level: CertificationLevel;
  evidenceRef: string;
  verifiedAt: string;
  verifiedBy: string;
  /** Explicit shorter expiry from certification or security policy; omitted means the policy default. */
  reverifyByOverride?: string;
}

const BATTERY = "connector-launch-policy.ts E2E battery comment (2026-10-03)";
const QA_RESULTS = "docs/test-plan/production-readiness-qa-results-2026-08-24.md";

/** PUBLISH, VALIDATE and STATUS_SYNC evidence from one Tier-2 battery that called the adapter against a real provider. */
function directAdapterBattery(connector: string, ledger: string, detail: string): RecordedEvidence[] {
  return ["PUBLISH", "VALIDATE", "STATUS_SYNC"].map((capability) => ({
    connector,
    capability,
    path: "direct_adapter" as const,
    level: "sandbox_verified" as const,
    evidenceRef: `${BATTERY}; ${ledger}; ${detail}`,
    verifiedAt: "2026-10-03",
    verifiedBy: "QA",
  }));
}

/** Tier-2 E2E batteries called the adapter with its own context, not the product export job: direct_adapter. */
const DIRECT_ADAPTER_BATTERY: RecordedEvidence[] = [
  ...directAdapterBattery("odoo", "INC-89", "T1-T6 against a real Odoo 17 instance"),
  ...directAdapterBattery("prestashop", "INC-89", "T1-T6 against a real PrestaShop 9.1.5 sandbox"),
  // Shopware was also 6/6 on 2026-09-24. Multi-store, staged rollout and webhooks were not verified.
  ...directAdapterBattery("shopware", "INC-88", "T1-T6 against a real dockware/dev Shopware sandbox"),
  // Zoho was also 6/6 on 2026-09-24. A GST-registered org was not tested.
  ...directAdapterBattery("zoho-inventory", "INC-88", "T1-T6 against a real Zoho Inventory trial org (India DC)"),
  // Etsy: OAuth and calls were real, but publish was exercised against the sandbox API with no real shop.
  ...directAdapterBattery("etsy", "INC-90", "T1-T6; publish against the sandbox API, no real shop on the account"),
];

const RECORDED: readonly RecordedEvidence[] = [
  ...DIRECT_ADAPTER_BATTERY,

  // eBay is sandbox-only by design. Publish needs Business Policy IDs that were not configured on the test account,
  // so the offer flow was validated but not completed: PUBLISH is held at integration_tested.
  { connector: "ebay", capability: "VALIDATE", path: "direct_adapter", level: "sandbox_verified", evidenceRef: `${BATTERY}; INC-90; T2 against the eBay sandbox`, verifiedAt: "2026-10-03", verifiedBy: "QA" },
  { connector: "ebay", capability: "STATUS_SYNC", path: "direct_adapter", level: "sandbox_verified", evidenceRef: `${BATTERY}; INC-90; T4 against the eBay sandbox`, verifiedAt: "2026-10-03", verifiedBy: "QA" },
  { connector: "ebay", capability: "PUBLISH", path: "direct_adapter", level: "integration_tested", evidenceRef: `${BATTERY}; INC-90; T3 offer flow validated, Business Policy IDs not configured`, verifiedAt: "2026-10-03", verifiedBy: "QA" },

  // BigCommerce: the live verification was of the prototype; the PIM1 TypeScript port is unit-tested only.
  ...["PUBLISH", "VALIDATE", "STATUS_SYNC"].map((capability) => ({ connector: "bigcommerce", capability, path: "direct_adapter" as const, level: "unit_tested" as const, evidenceRef: `${BATTERY}; INC-90; known limitation: live verification was prototype-based, PIM1 port unit-tested only`, verifiedAt: "2026-10-03", verifiedBy: "QA" })),

  // Dynamics 365: Azure AD token exchange and reachability were live; the Business Central data plane (GET /items)
  // was not re-verified after the permission fix, so publish and status-sync are held at integration_tested.
  { connector: "dynamics-365", capability: "VALIDATE", path: "direct_adapter", level: "sandbox_verified", evidenceRef: `${BATTERY}; INC-90; T1-T2 Azure AD token exchange and Business Central reachability`, verifiedAt: "2026-10-03", verifiedBy: "QA" },
  { connector: "dynamics-365", capability: "PUBLISH", path: "direct_adapter", level: "integration_tested", evidenceRef: `${BATTERY}; INC-90; T3, data plane not re-verified`, verifiedAt: "2026-10-03", verifiedBy: "QA" },
  { connector: "dynamics-365", capability: "STATUS_SYNC", path: "direct_adapter", level: "integration_tested", evidenceRef: `${BATTERY}; INC-90; T4, GET /items not re-verified`, verifiedAt: "2026-10-03", verifiedBy: "QA" },

  // Product-pipeline evidence: real publishes through the UI "Queue channel export" job on the live app against the
  // real pilot stores, with submission ids recorded. Dated 2026-08-24; the policy default has therefore expired.
  { connector: "shopify", capability: "PUBLISH", path: "product_pipeline", level: "production_verified", evidenceRef: `${QA_RESULTS}; PRQ-PUBF-SHF-001/002, PRQ-PUBV-SHF-001, PRQ-EDT-SHF-001 (real pilot store)`, verifiedAt: "2026-08-24", verifiedBy: "QA" },
  { connector: "woocommerce", capability: "PUBLISH", path: "product_pipeline", level: "production_verified", evidenceRef: `${QA_RESULTS}; PRQ-PUBF-WOO-001/002 (real pilot store, external ref 212; wp-admin confirmation not completed)`, verifiedAt: "2026-08-24", verifiedBy: "QA" },
];

function toEvidence(entry: RecordedEvidence): CapabilityEvidence {
  return {
    connector: entry.connector,
    capability: entry.capability,
    path: entry.path,
    level: entry.level,
    evidenceRef: entry.evidenceRef,
    verifiedAt: entry.verifiedAt,
    verifiedBy: entry.verifiedBy,
    reverifyBy: defaultReverifyBy(entry.level, entry.verifiedAt, entry.reverifyByOverride ?? null),
  };
}

const EVIDENCE_PATHS: readonly EvidencePath[] = ["direct_adapter", "product_pipeline"];

function untested(connector: string, capability: string, path: EvidencePath): CapabilityEvidence {
  return { connector, capability, path, level: "untested", evidenceRef: null, verifiedAt: null, verifiedBy: null, reverifyBy: null };
}

/** The recorded evidence plus an explicit `untested` entry for every other (declared capability, path). */
export function buildEvidenceManifest(
  recorded: readonly RecordedEvidence[] = RECORDED,
  declared: Readonly<Record<string, readonly string[]>> = PUBLISH_CONNECTOR_CAPABILITIES,
): CapabilityEvidence[] {
  const entries = recorded.map(toEvidence);
  const seen = new Set(entries.map((entry) => keyOf(entry)));
  for (const [connector, capabilities] of Object.entries(declared)) {
    for (const capability of capabilities) {
      for (const path of EVIDENCE_PATHS) {
        const key = keyOf({ connector, capability, path });
        if (!seen.has(key)) {
          entries.push(untested(connector, capability, path));
          seen.add(key);
        }
      }
    }
  }
  return entries.sort((a, b) => keyOf(a).localeCompare(keyOf(b)));
}

function keyOf(entry: { connector: string; capability: string; path: string }): string {
  return `${entry.connector}|${entry.capability}|${entry.path}`;
}

export const CONNECTOR_EVIDENCE_MANIFEST: readonly CapabilityEvidence[] = Object.freeze(buildEvidenceManifest());

export function evidenceForConnector(slug: string, manifest: readonly CapabilityEvidence[] = CONNECTOR_EVIDENCE_MANIFEST): CapabilityEvidence[] {
  const normalized = String(slug ?? "").trim().toLowerCase();
  return manifest.filter((entry) => entry.connector === normalized);
}

// ─── Validation (the ADR-0015 manifest invariants) ──────────────────────────────────────────────────────────

/** Returns human-readable problems; an empty array means the manifest is valid. */
export function validateEvidenceManifest(
  manifest: readonly CapabilityEvidence[],
  declared: Readonly<Record<string, readonly string[]>> = PUBLISH_CONNECTOR_CAPABILITIES,
): string[] {
  const problems: string[] = [];
  const keys = new Set<string>();

  for (const entry of manifest) {
    const key = keyOf(entry);
    if (keys.has(key)) problems.push(`duplicate entry ${key}`);
    keys.add(key);

    const capabilities = declared[entry.connector];
    if (!capabilities) problems.push(`${key}: connector is not a registered PUBLISH connector`);
    else if (!capabilities.includes(entry.capability)) problems.push(`${key}: capability is not declared by the connector`);
    if (!EVIDENCE_PATHS.includes(entry.path)) problems.push(`${key}: unknown path`);

    const rank = CERTIFICATION_LEVEL_ORDER.indexOf(entry.level);
    if (rank < 0) {
      problems.push(`${key}: unknown level ${String(entry.level)}`);
      continue;
    }
    if (entry.level === "untested") {
      if (entry.evidenceRef || entry.verifiedAt || entry.verifiedBy || entry.reverifyBy) problems.push(`${key}: untested entry carries evidence fields`);
      continue;
    }
    if (!entry.evidenceRef) problems.push(`${key}: ${entry.level} without an evidenceRef`);
    if (!entry.verifiedBy) problems.push(`${key}: ${entry.level} without verifiedBy`);
    const verifiedMs = entry.verifiedAt ? Date.parse(entry.verifiedAt) : Number.NaN;
    if (!Number.isFinite(verifiedMs)) {
      problems.push(`${key}: ${entry.level} without a parseable verifiedAt`);
      continue;
    }
    const policyDays = EVIDENCE_REVERIFY_DEFAULT_DAYS[entry.level];
    if (policyDays !== undefined) {
      const reverifyMs = entry.reverifyBy ? Date.parse(entry.reverifyBy) : Number.NaN;
      if (!Number.isFinite(reverifyMs)) problems.push(`${key}: ${entry.level} without a parseable reverifyBy`);
      else if (reverifyMs <= verifiedMs) problems.push(`${key}: reverifyBy is not after verifiedAt`);
      else if (reverifyMs > verifiedMs + policyDays * DAY_MS) problems.push(`${key}: reverifyBy exceeds the ${policyDays}-day policy default`);
    } else if (entry.reverifyBy !== null) {
      problems.push(`${key}: ${entry.level} should carry no reverifyBy`);
    }
  }

  // An entry for every declared capability on both paths, even when untested.
  for (const [connector, capabilities] of Object.entries(declared)) {
    for (const capability of capabilities) {
      for (const path of EVIDENCE_PATHS) {
        if (!keys.has(keyOf({ connector, capability, path }))) problems.push(`${connector}|${capability}|${path}: missing entry (record untested explicitly)`);
      }
    }
  }
  return problems;
}
