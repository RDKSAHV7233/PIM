import type {
  ApiRequestOptions,
  ConnectorDefinition,
  ConnectorInstallation,
  ConnectorPermission,
  ConnectorPublicationTarget,
  PaginatedResponse,
} from "./core";
import { deleteJson, fetchJson, postJson } from "./core";

export async function getInstalledConnectors(options?: ApiRequestOptions) {
  const response = await fetchJson<PaginatedResponse<ConnectorInstallation> | ConnectorInstallation[]>(
    "/connectors/installed?limit=200",
    undefined,
    options,
  );
  if (Array.isArray(response)) {
    return response;
  }
  return response.items ?? [];
}

export async function getConnectorDefinitions(options?: ApiRequestOptions) {
  return fetchJson<ConnectorDefinition[]>("/connectors/definitions", undefined, options);
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
