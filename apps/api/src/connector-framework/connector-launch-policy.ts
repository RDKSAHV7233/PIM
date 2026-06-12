import { ConnectorCap } from "./connector.interface";
import { CONNECTOR_SLUGS } from "./connector.constants";

export type ConnectorLaunchStage = "live" | "manual" | "planned";

type ConnectorLaunchPolicy = {
  launchStage: ConnectorLaunchStage;
  launchNote: string | null;
  surfacedCapabilities: ConnectorCap[];
};

export function resolveConnectorLaunchPolicy(
  slugInput: string,
  capabilities: ConnectorCap[],
): ConnectorLaunchPolicy {
  const slug = String(slugInput ?? "").trim().toLowerCase();

  if (slug === CONNECTOR_SLUGS.AMAZON) {
    return {
      launchStage: "planned",
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

  if (slug === CONNECTOR_SLUGS.SHOPIFY) {
    return {
      launchStage: "live",
      launchNote:
        "Shopify supports managed install, expiring offline token exchange, publication target selection, publish, status sync, and webhook relay handling.",
      surfacedCapabilities: capabilities,
    };
  }

  return {
    launchStage: "live",
    launchNote: null,
    surfacedCapabilities: capabilities,
  };
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
