import { ConnectorCap } from "./connector.interface";
import { CONNECTOR_SLUGS } from "./connector.constants";

export type ConnectorLaunchStage =
  | "planned"
  | "under_development"
  | "code_complete"
  | "qa_validation"
  | "po_review"
  | "early_access"
  | "controlled_pilot"
  | "p1_blocker_hold"
  | "manual"
  | "live"
  | "deprecated"
  | "internal_diagnostic";

type ConnectorLaunchPolicy = {
  launchStage: ConnectorLaunchStage;
  launchNote: string | null;
  surfacedCapabilities: ConnectorCap[];
};

export type ConnectorPipelineMetadata = {
  owner: string;
  milestone: string | null;
  blockers: string[];
  internalNotes: string | null;
};

export function resolveConnectorLaunchPolicy(
  slugInput: string,
  capabilities: ConnectorCap[],
): ConnectorLaunchPolicy {
  const slug = String(slugInput ?? "").trim().toLowerCase();

  if (slug === CONNECTOR_SLUGS.AMAZON) {
    return {
      launchStage: "under_development",
      launchNote:
        "Amazon India is in experimental preview. Seller install and credential validation are available; publish and status sync are under active validation. Not recommended for production catalogues.",
      surfacedCapabilities: capabilities,
    };
  }

  if (slug === CONNECTOR_SLUGS.BIGCOMMERCE) {
    // QA review passed (2026-09-26, PR #949): real bugs fixed — network failures
    // classified correctly, silent category/weight payload bugs resolved.
    // PO review completed (2026-09-26, PR #965). Required-team advancing to
    // po_review (2026-10-03). Known limitation before early_access: live
    // re-verification from within PIM1 against a real BigCommerce trial store
    // still pending — prototype-verified only; PIM1 TypeScript port unit-tested.
    return {
      launchStage: "po_review",
      launchNote:
        "BigCommerce V3 Catalog API connector (static store API account token via X-Auth-Token). QA review passed (PR #949): network failures classified, category/weight payload bugs fixed. PO review completed (PR #965). Known limitation: live re-verification from within PIM1 against a real BigCommerce trial store pending before early_access. Install requires a store_hash and a Store API account access token with catalog read/write scope.",
      surfacedCapabilities: capabilities,
    };
  }

  if (slug === CONNECTOR_SLUGS.DYNAMICS_365) {
    // QA review completed (2026-09-26, PR #948): test coverage added, permission
    // requirement documented. PO review completed (2026-09-26, PR #967): Azure
    // Portal blades documented in onboarding. Required-team advancing to po_review
    // (2026-10-03). Known limitation before early_access: Business Central data-API
    // (GET /items) needs live re-verification after the Automation.ReadWrite.All
    // permission fix — only Azure AD token exchange proven live so far.
    return {
      launchStage: "po_review",
      launchNote:
        "Microsoft Dynamics 365 Business Central connector (API v2.0/OData, Azure AD client_credentials). QA review completed (PR #948): test coverage and Automation.ReadWrite.All requirement documented. PO review completed (PR #967): Azure Portal steps documented in onboarding. Known limitation: Business Central data-API (GET /items) needs live re-verification after permission fix before early_access. Install requires Azure AD tenant, client_id/client_secret, and target environment + company name.",
      surfacedCapabilities: capabilities,
    };
  }

  if (slug === CONNECTOR_SLUGS.EBAY) {
    // QA review passed (2026-09-26, PR #936 merged): externalRef/status-sync
    // mismatch and publish idempotency fixed. PO review completed
    // (2026-09-26, PR #966 merged): onboarding + known-limitations polished.
    // Required-team authorized advancement (2026-10-03). Advancing to
    // po_review. Known limitation: publishProduct()/updateProduct() have not
    // been exercised against a real eBay sandbox listing — blocked on eBay
    // Business Policies (fulfillment/payment/return) not being configured
    // for the test account. Sandbox-only by design (no production config).
    return {
      launchStage: "po_review",
      launchNote:
        "eBay Sell Inventory/Offer API connector (OAuth2 authorization_code + refresh_token). Hardcoded to eBay's sandbox environment only — no production option exists in this connector by design. Credential validation live-verified; externalRef/status-sync mismatch and publish idempotency fixed (PR #936). Known limitation: publishProduct() not yet exercised — eBay Business Policies (fulfillment/payment/return) not configured for the test account. Install requires client_id, client_secret, refresh_token, marketplace id (e.g. EBAY_US), and Business Policy IDs for publish to work.",
      surfacedCapabilities: capabilities,
    };
  }

  if (slug === CONNECTOR_SLUGS.ETSY) {
    // QA review passed (2026-09-26, PR #947 merged): draft listings now
    // activated on publish, error-message shape fixed. PO review completed
    // (2026-09-26, PR #968 merged): onboarding, docs, and validation polished.
    // Required-team authorized advancement (2026-10-03). Advancing to
    // po_review. Known limitation: publishProduct() not yet exercised against
    // a real Etsy listing — blocked on an Etsy shop being opened on the
    // sandbox account (seller-onboarding step, not an API gap).
    return {
      launchStage: "po_review",
      launchNote:
        "Etsy Open API v3 connector: OAuth2 authorization-code + PKCE flow and credential validation live-verified. Draft listings now activated on publish (PR #947). Known limitation: publishProduct() not yet exercised against a real listing — blocked on opening an Etsy shop on the sandbox account (seller-onboarding step, not an API/OAuth gap). Install requires client_id, shared_secret, and refresh_token — Etsy's x-api-key header needs \"client_id:shared_secret\".",
      surfacedCapabilities: capabilities,
    };
  }

  if (slug === CONNECTOR_SLUGS.MEESHO) {
    return {
      launchStage: "manual",
      launchNote:
        "Meesho is an export-only connector. Generate a category-specific Excel file and upload it to Meesho Supplier Panel. Credential validation is pending Meesho API access (RD-MEESHO-1).",
      surfacedCapabilities: capabilities,
    };
  }

  if (slug === CONNECTOR_SLUGS.MYNTRA) {
    return {
      launchStage: "under_development",
      launchNote:
        "Myntra supports publish, validation, and listing-status sync via the Myntra Listing Management API. API access requires account-manager enablement. Enter Merchant ID, Secret Key, and Warehouse ID from your Myntra seller account.",
      surfacedCapabilities: capabilities,
    };
  }

  if (slug === CONNECTOR_SLUGS.NYKAA) {
    return {
      launchStage: "under_development",
      launchNote:
        "Nykaa is an export-only connector. Generate a category-specific Excel file and upload it to seller.nykaa.com → Catalogue Management → Catalogue Upload. Nykaa reviews listings within 7–10 business days. Direct API publishing requires Nykaa platform-partner credentials (not yet available).",
      surfacedCapabilities: capabilities,
    };
  }

  if (slug === CONNECTOR_SLUGS.ODOO) {
    // QA validation passed (2026-09-22, PR #935 merged): duplicate-reference
    // risk found and fixed. PO sign-off cleared 2026-10-03 (required-team
    // authorization). Advancing to early_access:
    // E2E battery PASSED 2026-10-03 —
    // T1 — Auth via /jsonrpc common/authenticate (real Odoo 17 instance): PASS
    // T2 — Credential validation live against real Odoo 17 sandbox: PASS
    // T3 — publishProduct(): product created via /jsonrpc object.execute_kw: PASS
    // T4 — syncSubmissionStatus(): correct status returned: PASS
    // T5 — updateProduct(): title/description changes accepted and reflected: PASS
    // T6 — validateProduct(): ODOO_DUPLICATE_REFERENCE_RISK live search_read: PASS
    // Known limitation: customer pilot with a real production Odoo tenant not yet run.
    return {
      launchStage: "early_access",
      launchNote:
        "Odoo ERP connector is in early access. Auth, publish, update, status-sync, and duplicate-reference validation verified live (6/6 checks) against a real Odoo 17 instance via the /jsonrpc external API. Install requires odoo_url (HTTPS), database name, username, and a password or API key.",
      surfacedCapabilities: capabilities,
    };
  }

  if (slug === CONNECTOR_SLUGS.PRESTASHOP) {
    // QA validation passed (2026-09-22, issue #931): 9/9 checks, no blockers.
    // PO sign-off cleared 2026-10-03 (required-team authorization).
    // Advancing to early_access:
    // E2E battery PASSED 2026-10-03 —
    // T1 — Auth via HTTP Basic (Webservice API key) + GET /api reachability: PASS
    // T2 — Credential validation live against real PrestaShop 9.1.5 sandbox: PASS
    // T3 — publishProduct(): product created via POST /api/products (XML): PASS
    // T4 — syncSubmissionStatus(): correct active status returned: PASS
    // T5 — updateProduct(): title/price changes applied with <id> fix: PASS
    // T6 — validateProduct(): live category + reference uniqueness checks: PASS
    // Known limitation: normaliseError() error-code table targets v9.1.5 real codes
    // (41/85); older PrestaShop versions may use different codes.
    return {
      launchStage: "early_access",
      launchNote:
        "PrestaShop Webservice API connector is in early access. Publish, update, status-sync, and live category/reference validation verified against a real PrestaShop 9.1.5 sandbox (9/9 checks). Install requires store_url (HTTPS), a Webservice API key with products + categories (+ languages) read/write permission, and a language id.",
      surfacedCapabilities: capabilities,
    };
  }

  if (slug === CONNECTOR_SLUGS.SHOPWARE) {
    // 6/6 live-verified from within PIM1 (2026-09-24): auth, publish,
    // status-sync, and update all confirmed working end-to-end against a real
    // local dockware/dev Shopware sandbox. QA+PO gates cleared 2026-10-03
    // (required-team authorization). Advancing to early_access:
    // E2E battery PASSED 2026-10-03 —
    // T1 — Auth via client_credentials + /api/_info/config reachability: PASS
    // T2 — Credential validation live-verified (real Integration client): PASS
    // T3 — publishProduct(): product created on real Shopware instance: PASS
    // T4 — syncSubmissionStatus(): correct Published state returned: PASS
    // T5 — updateProduct(): title/price changes accepted and reflected: PASS
    // T6 — Tax-rate fix: reads tax_rate_percent attr, 19% fallback only: PASS
    // Known limitation: multi-store, staged-rollout, and webhook paths not verified.
    return {
      launchStage: "early_access",
      launchNote:
        "Shopware 6 is in early access. Auth, publish, status-sync, and update verified live (6/6 checks). Tax-rate reads product's own attribute, falls back to 19% only as last resort. Install requires store_url (HTTPS), an Integration client_id, and client_secret with Administrator API access.",
      surfacedCapabilities: capabilities,
    };
  }

  if (slug === CONNECTOR_SLUGS.SHOPIFY) {
    return {
      launchStage: "live",
      launchNote:
        "Shopify direct-token (custom app) connector: publish, edit/republish (single-variant verified), publication target selection, status sync (polling), reconnect with live credential validation, jobs visibility, manual bulk publish (≤50). Managed OAuth, webhook subscriptions, and multi-image sync are NOT verified for production use.",
      surfacedCapabilities: capabilities,
    };
  }

  if (slug === CONNECTOR_SLUGS.WOOCOMMERCE) {
    // E2E battery PASSED 2026-10-03 (QA/PO/required-team signoff, advancing to early_access):
    // T1 — ACTIVE, Healthy; credentials masked; 100 submissions; 0 pending/retrying.
    // T2 — Credentials masked in UI; Replace Credentials requires admin password step-up.
    // T3 — 67 products in scope, 69 variants, 0 blocking readiness issues. Recovery: 0 failures.
    //       23 "errors" are all QA test fixtures with non-public image URLs — correct connector
    //       behaviour (WC reports inaccessible URL and stops); not real merchant product failures.
    // T4 — Real publishes confirmed: products 2383, 2381, 307, 260, 404, 212 all SUCCESS.
    // T5 — Last full sync 14/9/2026; delta sync available for 1 pending product.
    // T6 — Mappings: Export readiness Ready, 0 missing fields.
    // Known limitation: multi-variant publishing not yet verified (QAPILOT-002 internal_server_error).
    // P1-1 CLOSED 2026-10-03; P1-2 CLOSED 2026-10-03 (INC-85, PR #1052).
    return {
      launchStage: "early_access",
      launchNote:
        "WooCommerce is in early access. Single-product publish, edit/republish, status sync, credential management, and reconnect are verified. Multi-variant publishing is not yet verified for production use.",
      surfacedCapabilities: capabilities,
    };
  }

  if (slug === CONNECTOR_SLUGS.ZOHO_INVENTORY) {
    // 6/6 live-verified from within PIM1 (2026-09-24): auth, publish,
    // status-sync, and update all confirmed working end-to-end against a real
    // Zoho Inventory trial org on the India data center. QA+PO gates cleared
    // 2026-10-03 (required-team authorization). Advancing to early_access:
    // E2E battery PASSED 2026-10-03 —
    // T1 — OAuth2 refresh_token exchange (India data center): PASS
    // T2 — Credential validation (real org, real token): PASS
    // T3 — publishProduct(): item created on real Zoho Inventory org: PASS
    // T4 — syncSubmissionStatus(): correct status returned: PASS
    // T5 — updateProduct(): price/description changes accepted: PASS
    // T6 — Regional data-center routing from marketplaceId: PASS (India host)
    // Known limitation: GST-registered org not tested; HSN/SAC classification
    // only tested on non-GST org (taxability_type/is_taxable dropped by fix).
    return {
      launchStage: "early_access",
      launchNote:
        "Zoho Inventory is in early access. Auth, publish, status-sync, and update verified live (6/6 checks) against a real Zoho Inventory trial org on the India data center. Regional data-center routing and tax-field fixes included. Install requires Zoho API Console client_id/client_secret, a refresh_token, an organization_id, and optionally a data-center region code (com/eu/in/com.au/jp/com.cn, defaults to com).",
      surfacedCapabilities: capabilities,
    };
  }

  if (slug.startsWith("diag-")) {
    return {
      launchStage: "internal_diagnostic",
      launchNote: "Internal diagnostic connector. Not visible to customers and not installable.",
      surfacedCapabilities: [],
    };
  }

  return {
    launchStage: "live",
    launchNote: null,
    surfacedCapabilities: capabilities,
  };
}

export function isCustomerVisibleStage(stage: ConnectorLaunchStage): boolean {
  return stage === "live" || stage === "manual";
}

export function isInstallableStage(stage: ConnectorLaunchStage): boolean {
  return (
    stage === "live" ||
    stage === "manual" ||
    stage === "code_complete" ||
    stage === "qa_validation" ||
    stage === "po_review" ||
    stage === "early_access"
  );
}

const LAUNCH_STAGE_LABELS: Record<ConnectorLaunchStage, string> = {
  planned: "Planned",
  under_development: "Under development",
  code_complete: "Code complete",
  qa_validation: "QA validation",
  po_review: "PO review",
  early_access: "Early access",
  controlled_pilot: "Controlled pilot",
  p1_blocker_hold: "P1 blocker-closure hold",
  manual: "Manual export",
  live: "Live",
  deprecated: "Deprecated",
  internal_diagnostic: "Internal diagnostic",
};

export function formatLaunchStageLabel(stage: ConnectorLaunchStage): string {
  return LAUNCH_STAGE_LABELS[stage] ?? stage;
}

export function resolveConnectorPipelineMetadata(slug: string): ConnectorPipelineMetadata {
  const s = String(slug ?? "").trim().toLowerCase();

  if (s === CONNECTOR_SLUGS.SHOPIFY) {
    return { owner: "Platform", milestone: null, blockers: ["managed OAuth live verification", "webhook subscription creation"], internalNotes: "GA for direct-token publishing. #662 multi-variant metafield drift RESOLVED (PR #665 merged). Managed OAuth and webhook subscriptions are code-complete but NOT live-verified." };
  }
  if (s === CONNECTOR_SLUGS.MYNTRA) {
    return { owner: "Platform", milestone: null, blockers: [], internalNotes: "GA — Listing Management API." };
  }
  if (s === CONNECTOR_SLUGS.FLIPKART) {
    return { owner: "Platform", milestone: null, blockers: [], internalNotes: "GA — default fallback connector." };
  }
  if (s === CONNECTOR_SLUGS.MEESHO) {
    return { owner: "Platform", milestone: "RD-MEESHO-1", blockers: ["Meesho API access pending"], internalNotes: "Export-only. Waiting on Meesho partner API programme." };
  }
  if (s === CONNECTOR_SLUGS.NYKAA) {
    return { owner: "Platform", milestone: null, blockers: ["Nykaa platform-partner credentials"], internalNotes: "Export-only. Direct API requires partner credentials." };
  }
  if (s === CONNECTOR_SLUGS.AMAZON) {
    return { owner: "Platform", milestone: "Sprint F", blockers: ["Feeds API bulk publish validation"], internalNotes: "Experimental preview. Install + credential validation available; publish under validation." };
  }
  if (s === CONNECTOR_SLUGS.BIGCOMMERCE) {
    return {
      owner: "Platform",
      milestone: null,
      blockers: ["live re-verification from within PIM1 against a real BigCommerce trial store required before early_access"],
      internalNotes:
        "Ported from the Vexa Connector Hub prototype (2026-09-22). QA review passed (PR #949, 2026-09-26): network failures classified correctly, silent category/weight payload bugs resolved. PO review completed (PR #965, 2026-09-26). Advanced to po_review (2026-10-03, required-team authorization). Prototype-verified against a real BigCommerce trial store with no bugs; PIM1 TypeScript port unit-tested only — live re-verification from within PIM1 still pending before early_access.",
    };
  }
  if (s === CONNECTOR_SLUGS.DYNAMICS_365) {
    return {
      owner: "Platform",
      milestone: null,
      blockers: [
        "Business Central data-API (GET /items) live re-verification after Automation.ReadWrite.All permission fix required before early_access",
      ],
      internalNotes:
        "Ported from the Vexa Connector Hub prototype (2026-09-20). QA review completed (PR #948, 2026-09-26): test coverage added for publish/update/resolveApiBase; Automation.ReadWrite.All permission documented. PO review completed (PR #967, 2026-09-26): Azure Portal blades documented in onboarding copy. Advanced to po_review (2026-10-03, required-team authorization). Data-API gap: only the Azure AD token exchange has been proven live — Business Central GET /items not re-verified after permission fix. Do not advance to early_access until validateCredentials() is confirmed working with the correct permissions.",
    };
  }
  if (s === CONNECTOR_SLUGS.EBAY) {
    return {
      owner: "Platform",
      milestone: null,
      blockers: [
        "real publish test (eBay Business Policies not yet configured for sandbox test account)",
        "production support (sandbox-only by design — no production option in code)",
      ],
      internalNotes:
        "Ported from the Vexa Connector Hub prototype (2026-09-21), then fully live-verified (2026-09-22): completed 3-legged OAuth consent flow, obtained real refresh_token. Two real bugs found and fixed: (1) updateProduct() idempotency fixed; (2) validateCredentials() endpoint fixed to GET /inventory_item. QA review passed (PR #936, 2026-09-26): externalRef/status-sync mismatch and publish idempotency fixed. PO review completed (PR #966, 2026-09-26). Advanced to po_review (2026-10-03, required-team authorization). Known limitation: sandbox-only by design; publishProduct() not yet exercised (needs eBay Business Policies configured).",
    };
  }
  if (s === CONNECTOR_SLUGS.ETSY) {
    return {
      owner: "Platform",
      milestone: null,
      blockers: [
        "real publish test (needs an Etsy shop opened on the sandbox account — seller-onboarding step, not an API gap)",
      ],
      internalNotes:
        "Ported from the Vexa Connector Hub prototype (2026-09-20). Two real bugs found and fixed during port: x-api-key needs \"client_id:shared_secret\" (bare client_id 403s), validateCredentials() endpoint fixed. QA review passed (PR #947, 2026-09-26): draft listings now activated on publish, error-message shape fixed. PO review completed (PR #968, 2026-09-26). Advanced to po_review (2026-10-03, required-team authorization). Known limitation: publishProduct() not yet exercised — blocked on sandbox account having no Etsy shop open.",
    };
  }
  if (s === CONNECTOR_SLUGS.ODOO) {
    return {
      owner: "Platform",
      milestone: "early_access",
      blockers: ["customer pilot with a real production Odoo tenant not yet run"],
      internalNotes:
        "Ported from the Vexa Connector Hub prototype (2026-09-20). Auth switched to /jsonrpc common/object — /web/session/authenticate rejects API keys by design (verified against real Odoo 17 source). Full auth+create+update+status-sync round trip live-verified (2026-09-22) against a real Odoo 17 sandbox via this codebase's own connector.ts. QA validation PASSED (PR #935): ODOO_DUPLICATE_REFERENCE_RISK check added via live search_read. Advanced to early_access 2026-10-03 (required-team authorization): E2E battery PASSED — T1 /jsonrpc auth, T2 credential validation live, T3 publishProduct, T4 status-sync, T5 updateProduct, T6 validateProduct duplicate-reference check.",
    };
  }
  if (s === CONNECTOR_SLUGS.PRESTASHOP) {
    return {
      owner: "Platform",
      milestone: "early_access",
      blockers: ["error-code table targets PrestaShop 9.1.5 real codes (41/85); older versions may differ"],
      internalNotes:
        "Ported from the Vexa Connector Hub prototype (2026-09-20), then fully live-verified from within PIM1 (2026-09-21) against a real local PrestaShop 9.1.5 Docker sandbox (9/9 checks). Three real bugs found and fixed: (1) normaliseError() error-code table stale for v9.1.5 (real codes 41/85, not 47/84/83); (2) XML error envelope never parsed; (3) updateProduct() missing required <id> field — all fixed and re-verified live. QA validation PASSED (2026-09-22, issue #931): no blockers. Advanced to early_access 2026-10-03 (required-team authorization): E2E battery PASSED — T1 HTTP Basic + GET /api, T2 credential validation live, T3 publishProduct XML, T4 status-sync, T5 updateProduct with <id> fix, T6 live category/reference checks.",
    };
  }
  if (s === CONNECTOR_SLUGS.SHOPWARE) {
    return {
      owner: "Platform",
      milestone: "early_access",
      blockers: ["Multi-store, staged-rollout, and webhook paths not verified"],
      internalNotes:
        "Ported from the Vexa Connector Hub prototype (2026-09-22), then fully live-verified from within PIM1 (2026-09-24) against a real local dockware/dev Shopware sandbox (6/6 checks). Tax-rate bug fixed during port. Advanced to early_access 2026-10-03 (required-team authorization): E2E battery PASSED — T1 auth via client_credentials, T2 credential validation live, T3 publish product, T4 status-sync, T5 update product, T6 tax-rate attribute read.",
    };
  }
  if (s === CONNECTOR_SLUGS.WOOCOMMERCE) {
    return {
      owner: "Platform",
      milestone: "early_access",
      blockers: ["Multi-variant publishing not yet verified (QAPILOT-002 internal_server_error)"],
      internalNotes:
        "Advanced to early_access 2026-10-03 after full E2E battery (QA/PO/required-team signoff): T1 ACTIVE Healthy, T2 credentials masked+step-up, T3 67 products 0 blockers (23 QA-fixture image errors are correct connector behaviour), T4 real publishes 2383/2381/307/260/404/212 SUCCESS, T5 last sync 14/9/2026, T6 mappings ready. P1-1 CLOSED (runtime-confirmed Healthy, masked creds, admin step-up). P1-2 CLOSED (validateCredentials() returns false on 401/403, atomic deleteInstallationTransaction, reconnectRequestedAt 2026-09-30 live). BUG-WOO-HEALTH-001 open (transient network errors → inconclusive, not revocation). Pilot installation 4cc83efd-a71b-4d61-8649-299795c35e11 active at vexapim.com.",
    };
  }
  if (s === CONNECTOR_SLUGS.ZOHO_INVENTORY) {
    return {
      owner: "Platform",
      milestone: "early_access",
      blockers: ["GST-registered org not tested (taxability_type/is_taxable dropped by fix — correct for non-GST)"],
      internalNotes:
        "Ported from the Vexa Connector Hub prototype (2026-09-24), then fully live-verified from within PIM1 (2026-09-24) against a real Zoho Inventory trial org on the India data center (6/6 checks). Three real bugs fixed: (1) US data-center hardcode → region from marketplaceId; (2)/(3) taxability_type and is_taxable dropped (rejected by non-GST orgs). Advanced to early_access 2026-10-03 (required-team authorization): E2E battery PASSED — T1 OAuth2 refresh_token exchange, T2 credential validation live, T3 publish item, T4 status-sync, T5 update item, T6 regional host routing.",
    };
  }
  return { owner: "Unknown", milestone: null, blockers: [], internalNotes: null };
}

export function resolveSafeConnectorFallbackSlugs(): string[] {
  const configured = String(process.env.CONNECTOR_SAFE_FALLBACK_SLUGS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);

  if (configured.length > 0) {
    return configured;
  }

  return ["flipkart"];
}
