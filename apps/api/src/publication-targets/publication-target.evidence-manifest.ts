import {
  CERTIFICATION_LEVEL_ORDER,
  type CapabilityEvidence,
  type CertificationLevel,
  type EvidenceEnvironment,
  type EvidenceExecutionType,
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
  environment: EvidenceEnvironment;
  /** Who executed it. AI_RUN and UNKNOWN never carry a human approval. */
  executionType: EvidenceExecutionType;
  /** Defaults to false: a named human approval is a separate act from producing evidence. */
  humanApproval?: boolean;
  fixture?: string;
  submissionIds?: readonly string[];
  assertions?: Readonly<Record<string, boolean>>;
  limitations?: readonly string[];
}

/** The Tier-2 batteries record that they ran against a real provider instance, not who executed them. */
const SANDBOX_BATTERY = { environment: "SANDBOX", executionType: "UNKNOWN" } as const;
/** BigCommerce: the PIM1 port was only unit-tested. */
const LOCAL_BATTERY = { environment: "LOCAL", executionType: "UNKNOWN" } as const;

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
    ...SANDBOX_BATTERY,
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
  { connector: "ebay", capability: "VALIDATE", path: "direct_adapter", level: "sandbox_verified", evidenceRef: `${BATTERY}; INC-90; T2 against the eBay sandbox`, verifiedAt: "2026-10-03", verifiedBy: "QA", ...SANDBOX_BATTERY },
  { connector: "ebay", capability: "STATUS_SYNC", path: "direct_adapter", level: "sandbox_verified", evidenceRef: `${BATTERY}; INC-90; T4 against the eBay sandbox`, verifiedAt: "2026-10-03", verifiedBy: "QA", ...SANDBOX_BATTERY },
  { connector: "ebay", capability: "PUBLISH", path: "direct_adapter", level: "integration_tested", evidenceRef: `${BATTERY}; INC-90; T3 offer flow validated, Business Policy IDs not configured`, verifiedAt: "2026-10-03", verifiedBy: "QA", ...SANDBOX_BATTERY },

  // BigCommerce: the live verification was of the prototype; the PIM1 TypeScript port is unit-tested only.
  ...["PUBLISH", "VALIDATE", "STATUS_SYNC"].map((capability) => ({ connector: "bigcommerce", capability, path: "direct_adapter" as const, level: "unit_tested" as const, evidenceRef: `${BATTERY}; INC-90; known limitation: live verification was prototype-based, PIM1 port unit-tested only`, verifiedAt: "2026-10-03", verifiedBy: "QA", ...LOCAL_BATTERY })),

  // Dynamics 365: Azure AD token exchange and reachability were live; the Business Central data plane (GET /items)
  // was not re-verified after the permission fix, so publish and status-sync are held at integration_tested.
  { connector: "dynamics-365", capability: "VALIDATE", path: "direct_adapter", level: "sandbox_verified", evidenceRef: `${BATTERY}; INC-90; T1-T2 Azure AD token exchange and Business Central reachability`, verifiedAt: "2026-10-03", verifiedBy: "QA", ...SANDBOX_BATTERY },
  { connector: "dynamics-365", capability: "PUBLISH", path: "direct_adapter", level: "integration_tested", evidenceRef: `${BATTERY}; INC-90; T3, data plane not re-verified`, verifiedAt: "2026-10-03", verifiedBy: "QA", ...SANDBOX_BATTERY },
  { connector: "dynamics-365", capability: "STATUS_SYNC", path: "direct_adapter", level: "integration_tested", evidenceRef: `${BATTERY}; INC-90; T4, GET /items not re-verified`, verifiedAt: "2026-10-03", verifiedBy: "QA", ...SANDBOX_BATTERY },

  // Product-pipeline evidence: real publishes through the UI "Queue channel export" job on the live app against the
  // real pilot stores. Both entries were executed by an AI agent acting in the QA role, so neither carries a human
  // approval, and neither can stand in for the named QA sign-off the governance gate requires.
  {
    connector: "shopify",
    capability: "PUBLISH",
    path: "product_pipeline",
    level: "production_verified",
    evidenceRef: `AI-run QA 2026-10-06 on app.vexapim.com: UI publish and republish of the fixture to the real pilot store; supersedes the 2026-08-24 run (${QA_RESULTS}; PRQ-PUBF-SHF-001/002)`,
    verifiedAt: "2026-10-06",
    verifiedBy: "QA",
    environment: "PRODUCTION",
    executionType: "AI_RUN",
    fixture: "QAPILOT-20260824-001",
    submissionIds: ["6ae9670d-b62e-41dc-bb34-d649c62898b6", "0a103f48-b530-4639-b92e-5089adc38bf1"],
    assertions: {
      publishSucceeded: true,
      republishSucceeded: true,
      sameExternalReference: true,
      duplicateObserved: false,
      connectorHealthyBefore: true,
      connectorHealthyAfter: true,
    },
    limitations: [
      "Shopify admin / store-side inspection not performed (Vexa-side evidence only)",
      "bulk publish not exercised",
      "multi-variant publish not exercised",
      "image diff never converges and the Shopify CDN image id changed between publishes (tracked defect)",
      "executed by an AI agent: not a named human QA approval",
    ],
  },
  {
    connector: "woocommerce",
    capability: "PUBLISH",
    path: "product_pipeline",
    level: "production_verified",
    evidenceRef: `${QA_RESULTS}; PRQ-PUBF-WOO-001/002 (real pilot store, external ref 212; wp-admin confirmation not completed)`,
    verifiedAt: "2026-08-24",
    verifiedBy: "QA",
    environment: "PRODUCTION",
    executionType: "AI_RUN",
    fixture: "QAPILOT-20260824-001",
    submissionIds: ["4d9c4973-2974-4760-bb28-8211e43a1a42"],
    limitations: [
      "the cited submission remained PENDING in the submission history although external ref 212 persisted",
      "wp-admin confirmation not completed",
      "WooCommerce is on p1_blocker_hold; whether this evidence may stand is an open owner decision",
      "executed by an AI agent: not a named human QA approval",
    ],
  },
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
    evidenceRole: entry.verifiedBy,
    executionType: entry.executionType,
    humanApproval: entry.humanApproval ?? false,
    environment: entry.environment,
    ...(entry.fixture !== undefined ? { fixture: entry.fixture } : {}),
    ...(entry.submissionIds !== undefined ? { submissionIds: entry.submissionIds } : {}),
    ...(entry.assertions !== undefined ? { assertions: entry.assertions } : {}),
    ...(entry.limitations !== undefined ? { limitations: entry.limitations } : {}),
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

const EXECUTION_TYPES: readonly string[] = ["AI_RUN", "HUMAN_RUN", "UNKNOWN"];
const ENVIRONMENTS: readonly string[] = ["PRODUCTION", "SANDBOX", "LOCAL"];
const SUBMISSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Provenance rules for an entry above untested: who ran it, where, and whether a named human approved it. */
function validateProvenance(entry: CapabilityEvidence, key: string): string[] {
  const problems: string[] = [];
  if (!entry.evidenceRole) problems.push(`${key}: ${entry.level} without evidenceRole`);
  if (!entry.executionType || !EXECUTION_TYPES.includes(entry.executionType)) problems.push(`${key}: missing or unknown executionType`);
  if (typeof entry.humanApproval !== "boolean") problems.push(`${key}: humanApproval must be an explicit boolean`);
  if (!entry.environment || !ENVIRONMENTS.includes(entry.environment)) problems.push(`${key}: missing or unknown environment`);

  // Executing a test is not approving it: only a human-run entry can carry a human approval.
  if (entry.humanApproval === true && entry.executionType !== "HUMAN_RUN") {
    problems.push(`${key}: humanApproval is true but executionType is ${String(entry.executionType)}`);
  }
  // certified is a named human certification (ADR-0007: full QA cycle, security review, CTO/PO sign-off).
  if (entry.level === "certified" && entry.humanApproval !== true) problems.push(`${key}: certified requires a named human approval`);
  // production_verified means the provider's production environment.
  if ((entry.level === "production_verified" || entry.level === "certified") && entry.environment !== "PRODUCTION") {
    problems.push(`${key}: ${entry.level} requires a PRODUCTION environment`);
  }
  // A product-pipeline claim must be traceable to submissions.
  if (entry.path === "product_pipeline") {
    if (!entry.submissionIds || entry.submissionIds.length === 0) problems.push(`${key}: product_pipeline evidence without submissionIds`);
  }
  for (const id of entry.submissionIds ?? []) {
    if (!SUBMISSION_ID.test(id)) problems.push(`${key}: malformed submission id ${id}`);
  }
  return problems;
}

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
    // A recertification is derived from a later change (applyRecertificationTriggers); it is never recorded by hand.
    if (entry.recertification !== undefined) problems.push(`${key}: recertification is derived and must not be recorded in the manifest`);

    const rank = CERTIFICATION_LEVEL_ORDER.indexOf(entry.level);
    if (rank < 0) {
      problems.push(`${key}: unknown level ${String(entry.level)}`);
      continue;
    }
    if (entry.level === "untested") {
      if (entry.evidenceRef || entry.verifiedAt || entry.verifiedBy || entry.reverifyBy || entry.executionType || entry.humanApproval || entry.submissionIds) {
        problems.push(`${key}: untested entry carries evidence fields`);
      }
      continue;
    }
    if (!entry.evidenceRef) problems.push(`${key}: ${entry.level} without an evidenceRef`);
    if (!entry.verifiedBy) problems.push(`${key}: ${entry.level} without verifiedBy`);
    problems.push(...validateProvenance(entry, key));
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
