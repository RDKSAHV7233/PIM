import { ConnectorCap } from "./connector.interface";
import { CONNECTOR_SLUGS } from "./connector.constants";
import { getTenantKeyFromContext } from "../common/tenant/tenant-context";
import { normalizeTenantKey } from "../common/tenant/tenant.constants";

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

// PIM#817: explicitly-opted-in override so a real onboarding + tenant-owned
// credential-write proof can be exercised for the P1 blocker checklist's
// "Real WooCommerce onboarding" evidence item, without reopening WooCommerce
// for any real customer tenant. Recorded authorization: Vishal (CTO),
// 2026-09-16, on issue #817. This does NOT constitute the full named
// CTO/PO/Security/QA/SRE signoff the P1 hold's own launchNote requires before
// a real customer pilot restart — it only unblocks one designated tenant so
// that specific missing evidence can be produced.
//
// CORRECTED 2026-09-17: this was originally gated on `APP_ENV === "staging"`
// alone, on the assumption that "staging" is a safe sandbox distinct from
// production. A same-day docs audit (PIM#867) confirmed there is only ONE
// Railway environment in this deployment — internally named "Staging" in
// `APP_ENV` terms (deploy-staging.yml sets `APP_ENV: staging`) — and it is
// the system serving real customer traffic at app.vexapim.com, including a
// paying ENTERPRISE pilot tenant. Gating on APP_ENV alone would have made
// WooCommerce installable for every real customer the moment the enable
// flag was set anywhere in that one environment — exactly the P1-held
// exposure this override was built to avoid. Fixed by additionally requiring
// the CURRENT REQUEST'S TENANT to exactly match an explicitly-designated
// proof tenant, so setting the flag only ever unlocks WooCommerce for that
// one tenant, never for the real pilot tenant or any other customer sharing
// the same environment.
function isWoocommerceStagingProofEnabled(): boolean {
  const appEnv = String(process.env.APP_ENV ?? "").trim().toLowerCase();
  const flag = String(process.env.PIM_WOOCOMMERCE_STAGING_PROOF_ENABLED ?? "").trim().toLowerCase();
  const proofTenantKeyRaw = process.env.PIM_WOOCOMMERCE_STAGING_PROOF_TENANT_KEY;
  if (appEnv !== "staging" || flag !== "true") {
    return false;
  }
  if (typeof proofTenantKeyRaw !== "string" || proofTenantKeyRaw.trim().length === 0) {
    // No designated tenant configured — refuse rather than unlock every
    // tenant in the environment. This is the exact mistake the override
    // originally made; failing closed here is deliberate.
    return false;
  }
  const proofTenantKey = normalizeTenantKey(proofTenantKeyRaw);
  const currentTenantKey = normalizeTenantKey(getTenantKeyFromContext());
  return currentTenantKey === proofTenantKey;
}

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

  if (slug === CONNECTOR_SLUGS.ETSY) {
    // Same "under_development, not in isInstallableStage()'s list" reasoning
    // as Odoo below: validateCredentials() is proven live against real Etsy
    // sandbox data, but publishProduct() has never been exercised — the
    // sandbox account has no Etsy shop open yet, a real seller-onboarding
    // step, not an API/OAuth gap. Shipping this as installable would let a
    // real tenant hit an untested write path on their first publish attempt.
    return {
      launchStage: "under_development",
      launchNote:
        "Etsy Open API v3 connector: OAuth2 authorization-code + PKCE flow and credential validation (GET /seller-taxonomy/nodes) verified live against real Etsy sandbox data. publishProduct()/updateProduct() are implemented but not yet exercised against a real listing — blocked on an Etsy shop being opened on the sandbox account (a seller-onboarding step, separate from API/OAuth setup). Not installable until a real publish is proven. Install requires client_id, shared_secret, and refresh_token — Etsy's x-api-key header rejects a bare client_id and needs \"client_id:shared_secret\".",
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
      launchStage: "live",
      launchNote:
        "Myntra supports publish, validation, and listing-status sync via the Myntra Listing Management API. API access requires account-manager enablement. Enter Merchant ID, Secret Key, and Warehouse ID from your Myntra seller account.",
      surfacedCapabilities: capabilities,
    };
  }

  if (slug === CONNECTOR_SLUGS.NYKAA) {
    return {
      launchStage: "manual",
      launchNote:
        "Nykaa is an export-only connector. Generate a category-specific Excel file and upload it to seller.nykaa.com → Catalogue Management → Catalogue Upload. Nykaa reviews listings within 7–10 business days. Direct API publishing requires Nykaa platform-partner credentials (not yet available).",
      surfacedCapabilities: capabilities,
    };
  }

  if (slug === CONNECTOR_SLUGS.ODOO) {
    // CTO review (PIM#889): "code_complete" is in isInstallableStage()'s allowed
    // list, so it made this connector installable by every real tenant against
    // their live Odoo ERP immediately on merge — despite this same launchNote
    // (and the pipeline metadata below) saying QA validation, PO review, and a
    // customer pilot haven't happened yet. Odoo writes directly to a tenant's
    // real product.template records (business inventory), the same "an
    // unvalidated integration must not be broadly available" reasoning already
    // applied to WooCommerce's P1 hold. "under_development" is NOT in
    // isInstallableStage()'s list, matching Amazon's equivalent
    // experimental/not-customer-validated precedent above.
    return {
      launchStage: "under_development",
      launchNote:
        "Odoo ERP connector: publish, update, and status-sync verified against a real Odoo 17 instance via the /jsonrpc external API (common/object services). Not yet through QA validation or a customer pilot — not installable until those clear. Install (once unblocked) requires odoo_url (HTTPS), database name, username, and a password or API key.",
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
    if (isWoocommerceStagingProofEnabled()) {
      return {
        launchStage: "early_access",
        launchNote:
          "TEMPORARY override (PIM#817, CTO-authorized 2026-09-16) to produce the missing real WooCommerce onboarding + tenant-owned credential-write proof. Installable ONLY for the one tenant named in PIM_WOOCOMMERCE_STAGING_PROOF_TENANT_KEY — no other tenant, including the real ENTERPRISE pilot tenant, is affected. This is NOT the full named CTO/PO/Security/QA/SRE signoff a real customer pilot restart still requires — P1-1/P1-2 evidence and the remaining approvals stay outstanding.",
        surfacedCapabilities: capabilities,
      };
    }
    return {
      launchStage: "p1_blocker_hold",
      launchNote:
        "WooCommerce onboarding and install are paused while P1 blocker closure is in progress. P1-1 tenant-owned app-auth credential verification, P1-2 auth revocation policy, staging runtime proof, and fresh CTO/PO/Security/QA/SRE signoff are required before any customer pilot restarts.",
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
  if (s === CONNECTOR_SLUGS.ETSY) {
    return {
      owner: "Platform",
      milestone: null,
      blockers: ["real publish test (needs an Etsy shop opened on the account)", "QA validation", "PO review"],
      internalNotes:
        "Ported from the Vexa Connector Hub prototype (2026-09-20). Two real bugs found and fixed during the port: x-api-key needs \"client_id:shared_secret\" (a bare client_id 403s), and validateCredentials() called a nonexistent endpoint (/taxonomy/seller, fixed to /seller-taxonomy/nodes). Both verified live against real Etsy sandbox data. publishProduct() implemented but never exercised — blocked on the sandbox account having no shop open yet.",
    };
  }
  if (s === CONNECTOR_SLUGS.ODOO) {
    return {
      owner: "Platform",
      milestone: null,
      blockers: ["QA validation", "PO review", "customer pilot"],
      internalNotes:
        "Ported from the Vexa Connector Hub prototype (2026-09-20). Auth switched to /jsonrpc's common/object external-API services — /web/session/authenticate rejects Odoo API keys by design (verified against real Odoo 17 source). Full auth+create+update+status-sync round trip verified live against a real Odoo 17 instance during the prototype phase; not yet re-verified against this codebase's own CI/staging.",
    };
  }
  if (s === CONNECTOR_SLUGS.WOOCOMMERCE) {
    if (isWoocommerceStagingProofEnabled()) {
      return {
        owner: "Platform",
        milestone: "PIM#817 staging onboarding proof (temporary)",
        blockers: [
          "P1-1 tenant-owned app-auth credential verification",
          "P1-2 auth revocation failure policy",
          "fresh CTO/PO/Security/QA/SRE signoff (CTO recorded 2026-09-16; PO/Security/QA/SRE still outstanding)",
        ],
        internalNotes:
          "Tenant-scoped override active (PIM_WOOCOMMERCE_STAGING_PROOF_ENABLED=true, restricted to PIM_WOOCOMMERCE_STAGING_PROOF_TENANT_KEY), authorized by Vishal (CTO) on 2026-09-16 to produce #817's missing real onboarding + tenant-owned credential-write evidence. Only the designated proof tenant is affected — every other tenant, including the real ENTERPRISE pilot tenant, still enforces the full P1 blocker hold. Revert by unsetting both env vars once the proof is captured.",
      };
    }
    return {
      owner: "Platform",
      milestone: "P1 blocker-closure hold",
      blockers: [
        "P1-1 tenant-owned app-auth credential verification",
        "P1-2 auth revocation failure policy",
        "staging runtime proof and fresh CTO/PO/Security/QA/SRE signoff",
      ],
      internalNotes:
        "W1-W10 code-complete and historical P0 remediation evidence exists, but the 2026-09-03 pilot approval is superseded for onboarding while P1-1/P1-2 are open. Not GA, not public-sellable, and not customer-installable until fresh signoff.",
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
