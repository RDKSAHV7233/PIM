import type { ConnectorInstallation } from "@/lib/api";

export function connectorHealthTone(status: string): "neutral" | "success" | "warning" | "danger" {
  const normalized = String(status ?? "").trim().toUpperCase();
  if (normalized === "ACTIVE") return "success";
  if (normalized === "CREDENTIAL_EXPIRED" || normalized === "FAILED" || normalized === "ERROR") return "danger";
  if (normalized === "PAUSED" || normalized === "DISABLED" || normalized === "INACTIVE") return "warning";
  return "neutral";
}

export function connectorHealthLabel(status: string): string {
  const normalized = String(status ?? "").trim().toUpperCase();
  if (normalized === "ACTIVE") return "Healthy";
  if (normalized === "CREDENTIAL_EXPIRED") return "Credentials expired";
  if (normalized === "PAUSED") return "Paused";
  if (normalized === "DISABLED") return "Disabled";
  if (normalized === "FAILED" || normalized === "ERROR") return "Needs attention";
  return status || "Unknown";
}

function readMetadataValue(metadata: unknown, key: string): string | null {
  const record = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? (metadata as Record<string, unknown>)
    : {};
  const value = record[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveInstallationLabel(installation: ConnectorInstallation): string {
  const shopName = readMetadataValue(installation.metadata, "shopName");
  const shopDomain = readMetadataValue(installation.metadata, "shopDomain");
  const accountContext = shopName || shopDomain || installation.externalAccountRef || installation.accountAlias;
  return `${installation.accountAlias} (${accountContext})`;
}

export function resolveInstallationContextDetail(installation: ConnectorInstallation): string {
  const shopName = readMetadataValue(installation.metadata, "shopName");
  const shopDomain = readMetadataValue(installation.metadata, "shopDomain");
  const externalRef = installation.externalAccountRef;
  const context = [shopName, shopDomain, externalRef].filter(Boolean).join(" | ");
  const prefix = context.length > 0
    ? `${installation.displayName} | ${context} | status ${installation.status}`
    : `${installation.displayName} | status ${installation.status}`;
  return `${prefix}. Readiness and publish checks now follow the selected connector account in this workbench.`;
}
