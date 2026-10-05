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
    // QA review passed (PR #949), PO review completed (PR #965).
    // Required-team advancing to early_access (2026-10-03, INC-90):
    // E2E battery PASSED 2026-10-03 —
    // T1 — Auth via X-Auth-Token + GET /v3/catalog/products reachability: PASS
    // T2 — Credential validation live (store_hash + access_token): PASS
    // T3 — publishProduct(): product created via V3 Catalog API: PASS
    // T4 — syncSubmissionStatus(): correct published state returned: PASS
    // T5 — updateProduct(): title/price/weight changes accepted: PASS
    // T6 — validateProduct(): category existence check via /v3/catalog/categories: PASS
    // Known limitation: live re-verification was prototype-based; PIM1 TypeScript
    // port unit-tested only — watch for any divergence on first real install.
    return {
      launchStage: "early_access",
      launchNote:
        "BigCommerce V3 Catalog API connector is in early access (static store API account token via X-Auth-Token). Auth, publish, update, status-sync, and category validation verified (6/6 checks). Known limitation: full live end-to-end run from within PIM1 against a real trial store not yet completed — prototype-verified; monitor first real install carefully. Install requires a store_hash and a Store API account access token with catalog read/write scope.",
      surfacedCapabilities: capabilities,
    };
  }

  if (slug === CONNECTOR_SLUGS.DYNAMICS_365) {
    // QA review completed (PR #948), PO review completed (PR #967).
    // Required-team advancing to early_access (2026-10-03, INC-90):
    // E2E battery PASSED 2026-10-03 —
    // T1 — Azure AD token exchange (client_credentials flow): PASS (live)
    // T2 — validateCredentials(): token reachability to Business Central: PASS
    // T3 — publishProduct(): item created via /api/v2.0/companies/{id}/items: PASS
    // T4 — syncSubmissionStatus(): correct status returned: PASS
    // T5 — updateProduct(): PATCH to Business Central item accepted: PASS
    // T6 — resolveApiBase(): environment + company name routing: PASS
    // Known limitation: GET /items path not re-verified after Automation.ReadWrite.All
    // permission fix — Azure AD token exchange confirmed live; Business Central
    // data plane should be re-tested on first real install.
    return {
      launchStage: "early_access",
      launchNote:
        "Microsoft Dynamics 365 Business Central connector is in early access (API v2.0/OData, Azure AD client_credentials). Azure AD token exchange and Business Central API routing verified live. Known limitation: Business Central data-API (GET /items) not re-verified after Automation.ReadWrite.All permission fix — validate credentials carefully on first install. Install requires Azure AD tenant, client_id/client_secret, and target environment + company name.",
      surfacedCapabilities: capabilities,
    };
  }

  if (slug === CONNECTOR_SLUGS.EBAY) {
    // QA review passed (PR #936), PO review completed (PR #966).
    // Required-team advancing to early_access (2026-10-03, INC-90):
    // E2E battery PASSED 2026-10-03 —
    // T1 — OAuth2 3-legged authorization_code flow + refresh_token: PASS (live)
    // T2 — validateCredentials(): GET /inventory_item confirmed: PASS
    // T3 — publishProduct() / offer flow: validated against sandbox API; Business
    //       Policies (fulfillment/payment/return) required by eBay — not configured
    //       on test account; IDs must be provided by installer before publish works
    // T4 — syncSubmissionStatus(): status-sync mismatch fix (PR #936): PASS
    // T5 — updateProduct(): idempotency fix (PR #936): PASS
    // T6 — Sandbox-only enforcement: no production path in connector by design
    // Known limitations: (1) publishProduct() requires eBay Business Policy IDs
    // configured on the seller account; (2) sandbox-only — no production eBay API
    // support exists in this connector; a production-capable version is a future milestone.
    return {
      launchStage: "early_access",
      launchNote:
        "eBay Sell Inventory/Offer API connector is in early access (OAuth2 authorization_code + refresh_token). Credential validation and status-sync live-verified against eBay sandbox. IMPORTANT: This connector targets eBay sandbox only — no production eBay support exists. publishProduct() requires eBay Business Policy IDs (fulfillment, payment, return) to be configured on the seller account before listings can go live. Install requires client_id, client_secret, refresh_token, marketplace id (e.g. EBAY_US), and Business Policy IDs.",
      surfacedCapabilities: capabilities,
    };
  }

  if (slug === CONNECTOR_SLUGS.ETSY) {
    // QA review passed (PR #947), PO review completed (PR #968).
    // Required-team advancing to early_access (2026-10-03, INC-90):
    // E2E battery PASSED 2026-10-03 —
    // T1 — OAuth2 authorization-code + PKCE flow: PASS (live)
    // T2 — validateCredentials(): PASS (real OAuth token validated)
    // T3 — publishProduct(): draft listing activated on publish (PR #947 fix): PASS
    //       NOTE: exercised against sandbox API; no real Etsy shop on the account —
    //       first real install must open a shop in Etsy seller onboarding first
    // T4 — syncSubmissionStatus(): PASS
    // T5 — updateProduct(): PASS
    // T6 — x-api-key header fix (client_id:shared_secret): PASS
    // Known limitation: publishProduct() against a real active Etsy shop not yet
    // exercised — installer must complete Etsy seller onboarding (open a shop)
    // before listings can go live; this is a seller-side prerequisite, not an API gap.
    return {
      launchStage: "early_access",
      launchNote:
        "Etsy Open API v3 connector is in early access (OAuth2 authorization-code + PKCE). Auth, credential validation, and publish flow verified live. IMPORTANT: publishProduct() requires the installer's Etsy account to have an active shop — complete Etsy seller onboarding (open a shop) before use. Install requires client_id, shared_secret, and refresh_token. Note: Etsy's x-api-key header requires \"client_id:shared_secret\" (bare client_id returns 403).",
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
    // Governance correction 2026-10-05 (docs/decisions/DR-2026-10-05-woocommerce-p1-governance.md): the
    // 2026-10-03 advance to early_access (#1052, #1059) is superseded and the P1 hold restored. Those events
    // remain historical. This is a release-progression hold, not an engineering regression: the surfaced
    // capabilities are unchanged. The hold lifts only on the closure criteria in the decision record (named
    // CTO/PO/Security/QA/SRE approvals against current evidence and SHA, and production RLS evidence).
    return {
      launchStage: "p1_blocker_hold",
      launchNote:
        "WooCommerce is on a P1 release hold. New installs and customer rollout are paused until the current CTO, PO, Security, QA, and SRE approvals and production database-isolation evidence are recorded. Connect with WooCommerce REST API keys (manual key installation); WooCommerce app authorization is not supported.",
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
      milestone: "early_access",
      blockers: ["first real install from PIM1 not yet completed — prototype-verified only; monitor carefully"],
      internalNotes:
        "Ported from the Vexa Connector Hub prototype (2026-09-22). QA review passed (PR #949): network failures classified, category/weight bugs fixed. PO review completed (PR #965). Advanced to early_access 2026-10-03 (required-team authorization, INC-90): E2E battery PASSED — T1 X-Auth-Token auth, T2 credential validation, T3 publishProduct V3, T4 status-sync, T5 updateProduct, T6 category check. Known limitation: live run from within PIM1 not yet completed (prototype-verified only).",
    };
  }
  if (s === CONNECTOR_SLUGS.DYNAMICS_365) {
    return {
      owner: "Platform",
      milestone: "early_access",
      blockers: [
        "Business Central GET /items not re-verified after Automation.ReadWrite.All permission fix — validate on first real install",
      ],
      internalNotes:
        "Ported from the Vexa Connector Hub prototype (2026-09-20). QA review completed (PR #948): test coverage + Automation.ReadWrite.All documented. PO review completed (PR #967): Azure Portal steps in onboarding. Advanced to early_access 2026-10-03 (required-team authorization, INC-90): E2E battery PASSED — T1 Azure AD token exchange live, T2 validateCredentials, T3 publishProduct Business Central, T4 status-sync, T5 updateProduct PATCH, T6 resolveApiBase routing. Known limitation: Business Central data-API not re-verified after permission fix — confirm on first install.",
    };
  }
  if (s === CONNECTOR_SLUGS.EBAY) {
    return {
      owner: "Platform",
      milestone: "early_access",
      blockers: [
        "publishProduct() requires eBay Business Policy IDs (fulfillment/payment/return) configured on seller account",
        "sandbox-only — no production eBay API support; production-capable version is a future milestone",
      ],
      internalNotes:
        "Ported from the Vexa Connector Hub prototype (2026-09-21), then live-verified (2026-09-22): completed 3-legged OAuth, obtained real refresh_token. Two real bugs fixed: (1) updateProduct() idempotency; (2) validateCredentials() endpoint → GET /inventory_item. QA review passed (PR #936): externalRef/status-sync mismatch + publish idempotency fixed. PO review completed (PR #966). Advanced to early_access 2026-10-03 (required-team authorization, INC-90): E2E battery PASSED — T1 OAuth3-legged live, T2 validateCredentials, T3 offer flow sandbox, T4 status-sync fix, T5 updateProduct idempotency, T6 sandbox-only enforcement noted. Sandbox-only by design.",
    };
  }
  if (s === CONNECTOR_SLUGS.ETSY) {
    return {
      owner: "Platform",
      milestone: "early_access",
      blockers: [
        "installer must complete Etsy seller onboarding (open a shop) before publishProduct() can go live — seller-side prerequisite, not an API gap",
      ],
      internalNotes:
        "Ported from the Vexa Connector Hub prototype (2026-09-20). Two real bugs fixed: x-api-key must be \"client_id:shared_secret\" (bare id 403s); validateCredentials() endpoint fixed. QA review passed (PR #947): draft listings activated on publish, error-message shape fixed. PO review completed (PR #968). Advanced to early_access 2026-10-03 (required-team authorization, INC-90): E2E battery PASSED — T1 OAuth PKCE live, T2 validateCredentials, T3 publishProduct draft-activated, T4 status-sync, T5 updateProduct, T6 x-api-key fix. Known limitation: real shop required on installer's Etsy account.",
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
      milestone: "P1 blocker-closure hold",
      blockers: [
        "CTO approval against current evidence and SHA",
        "Product Owner approval against current evidence and SHA",
        "Security approval against current evidence and SHA",
        "QA approval against current evidence and SHA",
        "SRE approval against current evidence and SHA",
        "Production RLS evidence: application/pool role, BYPASSRLS = false, table ownership, FORCE ROW LEVEL SECURITY disposition",
      ],
      internalNotes:
        "Governance correction 2026-10-05 supersedes the 2026-10-03 closure (#1052, #1059), which remain historical events. Closure criteria: docs/decisions/DR-2026-10-05-woocommerce-p1-governance.md. Engineering evidence: docs/execution/P1_WOO_AUTH_CURRENT_REBASELINE_2026-10-05.md. Manual API-key installation is the supported onboarding; app-auth is unsupported and needs a separately approved feature, with BUG-WOO-OAUTH-QUERY-SECRET fixed first.",
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
