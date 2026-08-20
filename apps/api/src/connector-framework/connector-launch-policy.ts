import { ConnectorCap } from "./connector.interface";
import { CONNECTOR_SLUGS } from "./connector.constants";

export type ConnectorLaunchStage =
  | "planned"
  | "under_development"
  | "code_complete"
  | "qa_validation"
  | "po_review"
  | "early_access"
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

  if (slug === CONNECTOR_SLUGS.SHOPIFY) {
    return {
      launchStage: "live",
      launchNote:
        "Shopify supports managed install, expiring offline token exchange, publication target selection, publish, status sync, and webhook relay handling.",
      surfacedCapabilities: capabilities,
    };
  }

  if (slug === CONNECTOR_SLUGS.WOOCOMMERCE) {
    return {
      launchStage: "code_complete",
      launchNote:
        "WooCommerce connector is code-complete (W1–W10) and available to install and use now. General-availability sign-off (QA validation, PO review) is still in progress.",
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
    return { owner: "Platform", milestone: null, blockers: [], internalNotes: "GA — full lifecycle support." };
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
  if (s === CONNECTOR_SLUGS.WOOCOMMERCE) {
    return { owner: "Platform", milestone: "W10 complete", blockers: ["QA validation", "PO review"], internalNotes: "W1–W10 code-complete. 59 static + 49 runtime assertions passing." };
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
