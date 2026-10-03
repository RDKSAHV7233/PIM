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
    // QA review passed (2026-09-26, PR #949 merged): real bugs found and fixed —
    // network failures now classified correctly, silent category/weight payload
    // bugs resolved. PO review completed (2026-09-26, PR #965 merged).
    // Required-team authorized advancement (2026-10-03). Advancing to
    // qa_validation (installable for QA evaluation); live re-verification from
    // within PIM1 against a real BigCommerce trial store is still pending before
    // advancing further — the PIM1 TypeScript port has only been unit-tested.
    return {
      launchStage: "qa_validation",
      launchNote:
        "BigCommerce V3 Catalog API connector (static store API account token via X-Auth-Token). QA review passed (PR #949): network failures classified correctly, category/weight payload bugs resolved. PO review completed (PR #965). Live re-verification from within PIM1 against a real BigCommerce trial store is still pending. Install requires a store_hash and a Store API account access token with catalog read/write scope.",
      surfacedCapabilities: capabilities,
    };
  }

  if (slug === CONNECTOR_SLUGS.DYNAMICS_365) {
    // QA review completed (2026-09-26, PR #948 merged): test coverage added for
    // publish/update/resolveApiBase paths; Automation.ReadWrite.All permission
    // requirement documented. PO review completed (2026-09-26, PR #967 merged):
    // exact Azure Portal blades documented in onboarding copy.
    // Required-team authorized advancement (2026-10-03). Advancing to
    // qa_validation (installable for QA evaluation). Business Central data-API
    // call (GET /items) still needs live re-verification after the
    // Automation.ReadWrite.All permission fix — only the Azure AD token exchange
    // has been proven live so far.
    return {
      launchStage: "qa_validation",
      launchNote:
        "Microsoft Dynamics 365 Business Central connector (API v2.0/OData, Azure AD client_credentials). QA review completed (PR #948): test coverage and Azure permission requirements documented. PO review completed (PR #967): exact Azure Portal blades documented in onboarding copy. Business Central data-API call (GET /items) still needs live re-verification after Automation.ReadWrite.All fix. Install requires an Azure AD tenant, app registration client_id/client_secret, and the target environment + company name.",
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
    // risk found and fixed — validateProduct() now warns ODOO_DUPLICATE_REFERENCE_RISK
    // via a live search_read on default_code, matching PrestaShop's
    // DUPLICATE_REFERENCE_RISK parity. Advancing to "po_review" stage:
    // QA is done; PO sign-off and a customer pilot remain before go-live.
    // "po_review" IS in isInstallableStage(), making this connector installable —
    // appropriate for PO evaluation against real Odoo instances.
    return {
      launchStage: "po_review",
      launchNote:
        "Odoo ERP connector: publish, update, and status-sync verified against a real Odoo 17 instance via the /jsonrpc external API (common/object services). QA validation passed (2026-09-22, PR #935): duplicate-reference risk found and fixed. Awaiting PO sign-off and customer pilot before go-live. Install requires odoo_url (HTTPS), database name, username, and a password or API key.",
      surfacedCapabilities: capabilities,
    };
  }

  if (slug === CONNECTOR_SLUGS.PRESTASHOP) {
    // QA validation passed (2026-09-22, issue #931 review): no blockers found
    // across the full publish/validate/status-sync/update round trip against a
    // real PrestaShop 9.1.5 sandbox (9/9 checks). Advancing to "po_review" stage:
    // QA is done; PO sign-off remains before go-live. "po_review" IS in
    // isInstallableStage(), making this connector installable — appropriate for
    // PO evaluation against real PrestaShop stores.
    return {
      launchStage: "po_review",
      launchNote:
        "PrestaShop Webservice API connector (XML over REST, HTTP Basic auth with the webservice key). Publish, update, status-sync, and live category/reference validation checks all verified live against a real PrestaShop 9.1.5 sandbox (9/9 checks passing). QA validation passed (2026-09-22, issue #931): no blockers found. Awaiting PO sign-off before go-live. Install requires store_url (HTTPS), a Webservice API key with products + categories (+ languages) read permission, and a language id. Note: PrestaShop's webservice enforces neither reference (SKU) uniqueness nor the category foreign key — validateProduct() adds proactive checks for both since the platform itself won't catch them.",
      surfacedCapabilities: capabilities,
    };
  }

  if (slug === CONNECTOR_SLUGS.SHOPWARE) {
    // 6/6 live-verified from within PIM1 (2026-09-24) against a real local
    // dockware/dev Shopware sandbox — full auth/publish/status-sync/update
    // round trip confirmed working end-to-end. Required-team authorized
    // advancement (2026-10-03): QA validation and PO review gates cleared.
    // Advancing to po_review (same level as Odoo/PrestaShop).
    return {
      launchStage: "po_review",
      launchNote:
        "Shopware 6 Admin API connector (OAuth2 client_credentials against /api/oauth/token). Auth, publish, status-sync, and update all verified live from within PIM1 against a real dockware/dev sandbox (6/6 checks passing). Tax-rate fix: reads product's own tax_rate_percent attribute, falls back to 19% only as last resort. Install requires store_url (HTTPS), an Integration client_id, and client_secret with Administrator API access.",
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
    // P1-1 and P1-2 blockers CLOSED 2026-10-03 (CTO/PO/required-team signoff):
    // P1-1 (tenant-owned credential verification): runtime-confirmed — Status Healthy,
    //   last sync 14/9/2026, published products 2383+2381 on vexapim.com, credentials
    //   masked in UI, Replace Credentials requires admin password step-up.
    // P1-2 (auth revocation failure policy): code-confirmed — validateCredentials()
    //   returns false on 401/403 → credentialsValidated=false; deleteInstallationTransaction
    //   atomically deletes connector_credentials before installation row; reconnectRequestedAt
    //   event 2026-09-30 proves revocation detection pathway was exercised live.
    // Pilot approval (2026-09-03) reinstated as controlled_pilot: new customer installs
    // still require explicit QA/PO gate (controlled_pilot is not in isInstallableStage).
    return {
      launchStage: "controlled_pilot",
      launchNote:
        "WooCommerce pilot (vexapim.com, installation 4cc83efd-a71b-4d61-8649-299795c35e11) running under controlled conditions. P1-1 and P1-2 blockers closed 2026-10-03. New customer installs require QA/PO gate before advancing to early_access.",
      surfacedCapabilities: capabilities,
    };
  }

  if (slug === CONNECTOR_SLUGS.ZOHO_INVENTORY) {
    // 6/6 live-verified from within PIM1 (2026-09-24) against a real Zoho
    // Inventory trial org on the India data center — full auth/publish/
    // status-sync/update round trip confirmed working end-to-end.
    // Required-team authorized advancement (2026-10-03): QA validation and
    // PO review gates cleared. Advancing to po_review (same as Odoo/PrestaShop).
    return {
      launchStage: "po_review",
      launchNote:
        "Zoho Inventory connector (OAuth2 refresh_token grant against Zoho's regional accounts host, REST API v1). Auth, publish, status-sync, and update all verified live from within PIM1 against a real Zoho Inventory trial org on the India data center (6/6 checks passing). Data-center fix: resolves region-specific host pair from the installation's marketplaceId. Tax-field fix: drops hardcoded taxability_type and is_taxable which Zoho rejects on non-GST-registered orgs. Install requires Zoho API Console client_id/client_secret, a refresh_token from a completed OAuth consent flow, an organization_id, and optionally a data-center region code (com/eu/in/com.au/jp/com.cn, defaults to com).",
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
      blockers: ["re-verify live against a real BigCommerce trial store from within PIM1 before advancing past qa_validation"],
      internalNotes:
        "Ported from the Vexa Connector Hub prototype (2026-09-22). QA review passed (PR #949, 2026-09-26): network failures classified correctly, silent category/weight payload bugs resolved. PO review completed (PR #965, 2026-09-26). Advanced to qa_validation (2026-10-03, required-team authorization). Still needs live re-verification in PIM1 from a real BigCommerce store before advancing further.",
    };
  }
  if (s === CONNECTOR_SLUGS.DYNAMICS_365) {
    return {
      owner: "Platform",
      milestone: null,
      blockers: [
        "re-verify Business Central data-API call (GET /items) after the Automation.ReadWrite.All permission fix",
        "real publish test before advancing past qa_validation",
      ],
      internalNotes:
        "Ported from the Vexa Connector Hub prototype (2026-09-20). QA review completed (PR #948, 2026-09-26): test coverage added for publish/update/resolveApiBase; Automation.ReadWrite.All permission documented. PO review completed (PR #967, 2026-09-26): Azure Portal blades documented in onboarding copy. Advanced to qa_validation (2026-10-03, required-team authorization). Data-API gap: only the Azure AD token exchange has been proven live — Business Central GET /items not re-verified after permission fix. Do not treat validateCredentials() as fully proven until that gap closes.",
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
      milestone: null,
      blockers: ["PO review", "customer pilot"],
      internalNotes:
        "Ported from the Vexa Connector Hub prototype (2026-09-20). Auth switched to /jsonrpc's common/object external-API services — /web/session/authenticate rejects Odoo API keys by design (verified against real Odoo 17 source). Full auth+create+update+status-sync round trip verified live against a real Odoo 17 instance during the prototype phase, then re-verified again (2026-09-22) directly against this codebase's own connector.ts logic (raw JSON-RPC calls reproducing publishProduct/updateProduct/syncSubmissionStatus exactly) against a restored real Odoo 17 sandbox. QA validation PASSED (2026-09-22, PR #935 merged): duplicate-reference risk found and fixed — validateProduct() now warns ODOO_DUPLICATE_REFERENCE_RISK via a live search_read on default_code, matching PrestaShop's DUPLICATE_REFERENCE_RISK parity (Odoo does not enforce default_code uniqueness, so a retried publish creates a silent duplicate without this check). Stage advanced to po_review.",
    };
  }
  if (s === CONNECTOR_SLUGS.PRESTASHOP) {
    return {
      owner: "Platform",
      milestone: null,
      blockers: ["PO review"],
      internalNotes:
        "Ported from the Vexa Connector Hub prototype (2026-09-20), then fully live-verified from within PIM1 itself (2026-09-21) against a real local PrestaShop 9.1.5 Docker sandbox: publish, validate (live category/reference checks), status sync, and update all confirmed working end-to-end (9/9 checks). Two real bugs found and fixed during the port: normaliseError()'s error-code table was completely stale for PrestaShop 9.1.5 (real codes are 41/85, not the original 47/84/83), and the connector never actually parsed PrestaShop's XML error envelope. A third real bug was found by the live-verification pass itself: updateProduct() omitted the required <id> field from the XML body, which PrestaShop's webservice rejects — fixed and re-verified live. This is the most-proven connector ported this sprint. QA validation PASSED (2026-09-22, issue #931): no blockers found across the full round trip. Stage advanced to po_review.",
    };
  }
  if (s === CONNECTOR_SLUGS.SHOPWARE) {
    return {
      owner: "Platform",
      milestone: null,
      blockers: [],
      internalNotes:
        "Ported from the Vexa Connector Hub prototype (2026-09-22), then fully live-verified from within PIM1 (2026-09-24) against a real local dockware/dev Shopware sandbox: auth, publish, status sync, and update all confirmed working end-to-end (6/6 checks). Tax-rate bug fixed during port. Advanced to po_review (2026-10-03, required-team authorization): QA and PO gates cleared.",
    };
  }
  if (s === CONNECTOR_SLUGS.WOOCOMMERCE) {
    return {
      owner: "Platform",
      milestone: "controlled_pilot",
      blockers: ["QA/PO gate before new customer installs (early_access)"],
      internalNotes:
        "P1-1 (tenant-owned credential verification) CLOSED 2026-10-03: runtime-confirmed Healthy, last sync 14/9/2026, real publishes 2383+2381, credentials masked, Replace Credentials requires admin password. P1-2 (auth revocation policy) CLOSED 2026-10-03: validateCredentials() returns false on 401/403, deleteInstallationTransaction atomically deletes connector_credentials, reconnectRequestedAt 2026-09-30T13:05:00Z confirms revocation detection live. BUG-WOO-HEALTH-001 tracked separately (transient network errors inconclusive, not treated as revocation). Pilot approval 2026-09-03 reinstated: vexapim.com installation 4cc83efd-a71b-4d61-8649-299795c35e11 active. New installs require QA/PO gate.",
    };
  }
  if (s === CONNECTOR_SLUGS.ZOHO_INVENTORY) {
    return {
      owner: "Platform",
      milestone: null,
      blockers: [],
      internalNotes:
        "Ported from the Vexa Connector Hub prototype (2026-09-24), then fully live-verified from within PIM1 (2026-09-24) against a real Zoho Inventory trial org on the India data center: auth, publish, status sync, and update all confirmed working end-to-end (6/6 checks). Three real bugs found and fixed: (1) hardcoded US data center fixed to resolve from marketplaceId; (2)/(3) hardcoded taxability_type and is_taxable dropped (rejected by non-GST-registered orgs). Advanced to po_review (2026-10-03, required-team authorization): QA and PO gates cleared.",
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
