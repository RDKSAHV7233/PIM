import { ConnectorCap } from "./connector.interface";

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

  if (slug === "amazon-in") {
    return {
      launchStage: "live",
      launchNote:
        "Amazon India supports seller install, credential validation, publish, status sync, and webhook relay handling. Install with seller ID plus Amazon LWA credentials.",
      surfacedCapabilities: capabilities,
    };
  }

  if (slug === "meesho") {
    return {
      launchStage: "planned",
      launchNote:
        "Meesho managed export (Excel/ExcelJS) is not yet complete. Hidden from operator UI until P5-S4 is shipped.",
      surfacedCapabilities: [],
    };
  }

  if (slug === "shopify") {
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
