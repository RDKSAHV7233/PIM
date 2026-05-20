import type {
  ApiRequestOptions,
  ConnectorDefinition,
  ConnectorInstallation,
  ConnectorPermission,
  ConnectorPublicationTarget,
  ConnectorPublicationTargetsUpdateResponse,
  ConnectorRecoveryGroup,
  ConnectorRecoveryRetryResult,
  PaginatedResponse,
  ShopifyProductPreview,
  ShopifyStoreConfig,
  ConnectorSyncSchedule,
  ConnectorSyncState,
  ConnectorCatalogScanResult,
  ConnectorProductLink,
} from "./core";
import { deleteJson, fetchJson, patchJson, postJson } from "./core";

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

export async function getConnectorRecoveryGroups(
  installationId: string,
  options?: ApiRequestOptions,
) {
  return fetchJson<ConnectorRecoveryGroup[]>(
    `/marketplace/connectors/shopify/${encodeURIComponent(installationId)}/recovery/groups`,
    undefined,
    options,
  );
}

export async function retryConnectorRecoveryGroup(
  installationId: string,
  errorFamily: string,
  options?: ApiRequestOptions,
) {
  return postJson<ConnectorRecoveryRetryResult>(
    `/marketplace/connectors/shopify/${encodeURIComponent(installationId)}/recovery/retry-group`,
    { errorFamily },
    options,
  );
}

export async function previewShopifyProductChanges(
  installationId: string,
  productId: string,
  options?: ApiRequestOptions,
) {
  return postJson<ShopifyProductPreview>(
    `/marketplace/connectors/shopify/${encodeURIComponent(installationId)}/products/${encodeURIComponent(productId)}/preview-changes`,
    {},
    options,
  );
}

// ─── Sprint 8: Delta sync ─────────────────────────────────────────────────────
// Generic routes (Sprint G) — work for any connector slug (Amazon, Flipkart, Shopify).
// The backend resolves connectors/shopify/:id (static) before connectors/:id (dynamic)
// so Shopify installations arriving at the legacy path continue to work unchanged.

export async function getDeltaSyncCandidates(installationId: string, options?: ApiRequestOptions) {
  return fetchJson<Array<{ productId: string; version: number }>>(
    `/marketplace/connectors/${encodeURIComponent(installationId)}/sync/delta-candidates`,
    undefined,
    options,
  );
}

export async function queueDeltaSync(installationId: string, options?: ApiRequestOptions) {
  return postJson<{ queued: number; skipped: number }>(
    `/marketplace/connectors/${encodeURIComponent(installationId)}/sync/delta`,
    {},
    options,
  );
}

export async function getSyncStates(installationId: string, options?: ApiRequestOptions) {
  return fetchJson<ConnectorSyncState[]>(
    `/marketplace/connectors/${encodeURIComponent(installationId)}/sync/states`,
    undefined,
    options,
  );
}

// ─── Sprint 9: Scheduled sync ─────────────────────────────────────────────────

export async function getConnectorSchedule(installationId: string, options?: ApiRequestOptions) {
  return fetchJson<ConnectorSyncSchedule | null>(
    `/marketplace/connectors/${encodeURIComponent(installationId)}/schedule`,
    undefined,
    options,
  );
}

export async function upsertConnectorSchedule(
  installationId: string,
  body: { cronExpression: string; scope?: string; status?: string },
  options?: ApiRequestOptions,
) {
  return postJson<{ id: string }>(
    `/marketplace/connectors/${encodeURIComponent(installationId)}/schedule`,
    body,
    options,
  );
}

export async function deleteConnectorSchedule(installationId: string, options?: ApiRequestOptions) {
  return deleteJson(
    `/marketplace/connectors/${encodeURIComponent(installationId)}/schedule`,
    options,
  );
}

// ─── Sprint F: Amazon Feeds API bulk publish ─────────────────────────────────

export async function triggerBulkPublish(
  installationId: string,
  productIds: string[],
  options?: ApiRequestOptions,
) {
  return postJson<{ feedId: string; feedDocumentId: string; productCount: number; submissionIds: string[] }>(
    `/marketplace/connectors/${encodeURIComponent(installationId)}/bulk-publish`,
    { productIds },
    options,
  );
}

// ─── Sprint D: Amazon marketplace configuration ───────────────────────────────

export async function configureConnector(
  installationId: string,
  config: { marketplaceId?: string; defaultProductType?: string },
  options?: ApiRequestOptions,
) {
  return patchJson<{ updated: boolean }>(
    `/connectors/${encodeURIComponent(installationId)}/configure`,
    config,
    options,
  );
}

// ─── Sprint 2: Shopify config import ─────────────────────────────────────────

export async function getShopifyConfig(installationId: string, options?: ApiRequestOptions) {
  return fetchJson<ShopifyStoreConfig | null>(
    `/marketplace/connectors/shopify/${encodeURIComponent(installationId)}/shopify-config`,
    undefined,
    options,
  );
}

export async function importShopifyConfig(installationId: string, options?: ApiRequestOptions) {
  return postJson<ShopifyStoreConfig>(
    `/marketplace/connectors/shopify/${encodeURIComponent(installationId)}/shopify-config/import`,
    {},
    options,
  );
}

// ─── Sprint 10: Catalog linking ───────────────────────────────────────────────

export async function scanCatalogLinks(installationId: string, options?: ApiRequestOptions) {
  return postJson<ConnectorCatalogScanResult>(
    `/marketplace/connectors/shopify/${encodeURIComponent(installationId)}/catalog-link/scan`,
    {},
    options,
  );
}

export async function getProductLinks(installationId: string, options?: ApiRequestOptions) {
  return fetchJson<ConnectorProductLink[]>(
    `/marketplace/connectors/shopify/${encodeURIComponent(installationId)}/catalog-link`,
    undefined,
    options,
  );
}

export async function confirmCatalogLinks(
  installationId: string,
  links: Array<{ productId: string; shopifyGid: string; matchedBy: string }>,
  options?: ApiRequestOptions,
) {
  return postJson<{ confirmed: number }>(
    `/marketplace/connectors/shopify/${encodeURIComponent(installationId)}/catalog-link/confirm`,
    { links },
    options,
  );
}
