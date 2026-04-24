import type {
  ApiRequestOptions,
  ConnectorDefinition,
  ConnectorInstallation,
  ConnectorPermission,
  ConnectorPublicationTarget,
  ConnectorPublicationTargetsUpdateResponse,
  PaginatedResponse,
} from "./core";
import { deleteJson, fetchJson, postJson } from "./core";

const SHOPIFY_LIVE_LAUNCH_NOTE =
  "Shopify supports managed install, expiring offline token exchange, publication target selection, publish, status sync, and webhook relay handling.";

function normalizeShopifyLaunchMetadata<T extends ConnectorDefinition | ConnectorInstallation>(item: T): T {
  if (String(item.slug ?? "").trim().toLowerCase() !== "shopify") {
    return item;
  }
  return {
    ...item,
    implementationStatus: "full",
    launchStage: "live",
    launchNote: SHOPIFY_LIVE_LAUNCH_NOTE,
  };
}

export async function getInstalledConnectors(options?: ApiRequestOptions) {
  const response = await fetchJson<PaginatedResponse<ConnectorInstallation> | ConnectorInstallation[]>(
    "/connectors/installed?limit=200",
    undefined,
    options,
  );
  if (Array.isArray(response)) {
    return response.map(normalizeShopifyLaunchMetadata);
  }
  return (response.items ?? []).map(normalizeShopifyLaunchMetadata);
}

export async function getConnectorDefinitions(options?: ApiRequestOptions) {
  const response = await fetchJson<ConnectorDefinition[]>("/connectors/definitions", undefined, options);
  return response.map(normalizeShopifyLaunchMetadata);
}

export async function getConnectorPublications(
  installationId: string,
  options?: ApiRequestOptions,
) {
  return fetchJson<ConnectorPublicationTarget[]>(
    `/connectors/${encodeURIComponent(installationId)}/publications`,
    undefined,
    options,
  );
}

export async function getConnectorPermissions(
  connectorSlug?: string,
  options?: ApiRequestOptions,
) {
  const query = connectorSlug
    ? `?connectorSlug=${encodeURIComponent(connectorSlug)}`
    : "";
  return fetchJson<ConnectorPermission[]>(`/connectors/permissions${query}`, undefined, options);
}

export async function grantConnectorPermission(
  body: {
    principalType: "user" | "role";
    principalId: string;
    connectorSlug: string;
    accountAlias?: string;
    action: "install" | "reconnect" | "uninstall";
  },
  options?: ApiRequestOptions,
) {
  return postJson<ConnectorPermission>("/connectors/permissions", body, options);
}

export async function revokeConnectorPermission(permissionId: string, options?: ApiRequestOptions) {
  return deleteJson(`/connectors/permissions/${encodeURIComponent(permissionId)}`, options);
}

export async function updateConnectorPublicationTargets(
  installationId: string,
  body: { publicationIds: string[] },
  options?: ApiRequestOptions,
) {
  return postJson<ConnectorPublicationTargetsUpdateResponse>(
    `/connectors/${encodeURIComponent(installationId)}/publication-targets`,
    body,
    options,
  );
}
