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
      launchStage: "manual",
      launchNote:
        "Meesho is still a guided manual/export workflow. Keep it out of seller self-serve onboarding until the managed export path is complete.",
      surfacedCapabilities: capabilities.filter((capability) => capability === "VALIDATE"),
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
