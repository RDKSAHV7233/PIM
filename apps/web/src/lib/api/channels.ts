import type { ApiRequestOptions, ChannelMappingTemplate, ConnectorMappingCompatibility, ConnectorMappingPreflight, ConnectorMappingResolved, ConnectorMappingVersion, ConnectorPayloadPreviewResponse, ConnectorPublishReadiness, ConnectorTaxonomyItem, ExportJobListQuery, MarketplaceChannel, MarketplaceChannelConfig, MarketplaceChannelMapping, MarketplaceExportJob, MarketplaceSimulation } from "./core";
import { deleteJson, fetchJson, patchJson, postJson } from "./core";

function isApiRequestOptions(value: unknown): value is ApiRequestOptions {
  if (!value || typeof value !== "object") {
    return false;
  }
  return "role" in value || "tenantKey" in value || "authHeader" in value || "headers" in value;
}

export async function getMarketplaceChannels(options?: ApiRequestOptions) {
  return fetchJson<MarketplaceChannelConfig[]>("/marketplace/channels", undefined, options);
}

export async function getMarketplaceChannelMapping(
  channel: MarketplaceChannel,
  categoryId?: string,
  templateId?: string,
  options?: ApiRequestOptions,
) {
  const params = new URLSearchParams();
  if (categoryId) {
    params.set("categoryId", categoryId);
  }
  if (templateId) {
    params.set("templateId", templateId);
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return fetchJson<MarketplaceChannelMapping>(
    `/marketplace/channels/${encodeURIComponent(channel)}/mapping${query}`,
    undefined,
    options,
  );
}

export async function getMarketplaceTemplates(
  categoryId: string,
  channel?: MarketplaceChannel,
  options?: ApiRequestOptions,
) {
  const query = channel ? `?channel=${encodeURIComponent(channel)}` : "";
  return fetchJson<ChannelMappingTemplate[]>(
    `/marketplace/categories/${categoryId}/templates${query}`,
    undefined,
    options,
  );
}

export async function getConnectorMappingVersions(
  connectorSlug: string,
  input?: { categoryScope?: string; includeArchived?: boolean },
  options?: ApiRequestOptions,
) {
  const params = new URLSearchParams();
  if (input?.categoryScope) {
    params.set("categoryScope", input.categoryScope);
  }
  if (typeof input?.includeArchived === "boolean") {
    params.set("includeArchived", String(input.includeArchived));
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return fetchJson<ConnectorMappingVersion[]>(
    `/marketplace/connectors/${encodeURIComponent(connectorSlug)}/mappings/versions${query}`,
    undefined,
    options,
  );
}

export async function createConnectorMappingVersion(
  connectorSlug: string,
  body: {
    categoryScope: string;
    mappingLevel: "tenant_connector_default" | "tenant_connector_category_mapping";
    connectorDefinitionId: string;
    connectorDefinitionVersion: string;
    compatibilityState?: ConnectorMappingCompatibility;
    mappingRules: Record<string, unknown>;
    fallbackPolicy?: Record<string, unknown>;
    fallbackAckRequired?: boolean;
  },
  options?: ApiRequestOptions,
) {
  return postJson<ConnectorMappingVersion>(
    `/marketplace/connectors/${encodeURIComponent(connectorSlug)}/mappings/versions`,
    body,
    options,
  );
}

export async function validateConnectorMappingVersion(
  connectorSlug: string,
  versionId: string,
  options?: ApiRequestOptions,
) {
  return postJson<ConnectorMappingVersion>(
    `/marketplace/connectors/${encodeURIComponent(connectorSlug)}/mappings/versions/${encodeURIComponent(versionId)}/validate`,
    {},
    options,
  );
}

export async function publishConnectorMappingVersion(
  connectorSlug: string,
  versionId: string,
  body: { confirm: boolean },
  options?: ApiRequestOptions,
) {
  return postJson<ConnectorMappingVersion>(
    `/marketplace/connectors/${encodeURIComponent(connectorSlug)}/mappings/versions/${encodeURIComponent(versionId)}/publish`,
    body,
    options,
  );
}

export async function archiveConnectorMappingVersion(
  connectorSlug: string,
  versionId: string,
  body: { reason: string },
  options?: ApiRequestOptions,
) {
  return postJson<ConnectorMappingVersion>(
    `/marketplace/connectors/${encodeURIComponent(connectorSlug)}/mappings/versions/${encodeURIComponent(versionId)}/archive`,
    body,
    options,
  );
}

export async function rollbackConnectorMappingVersion(
  connectorSlug: string,
  versionId: string,
  body: { confirm: boolean; reason: string },
  options?: ApiRequestOptions,
) {
  return postJson<{
    published: ConnectorMappingVersion;
    superseded: string[];
    rollbackSourceVersionId: string;
  }>(
    `/marketplace/connectors/${encodeURIComponent(connectorSlug)}/mappings/versions/${encodeURIComponent(versionId)}/rollback`,
    body,
    options,
  );
}

export async function resolveConnectorMapping(
  connectorSlug: string,
  categoryScope: string,
  options?: ApiRequestOptions,
) {
  const query = new URLSearchParams({ categoryScope }).toString();
  return fetchJson<ConnectorMappingResolved>(
    `/marketplace/connectors/${encodeURIComponent(connectorSlug)}/mappings/resolve?${query}`,
    undefined,
    options,
  );
}

export async function evaluateConnectorMappingPreflight(
  connectorSlug: string,
  body: { categoryScope: string; installationId?: string; fallbackAcknowledged?: boolean },
  options?: ApiRequestOptions,
) {
  return postJson<ConnectorMappingPreflight>(
    `/marketplace/connectors/${encodeURIComponent(connectorSlug)}/mappings/preflight`,
    body,
    options,
  );
}

export async function searchConnectorTaxonomy(
  connectorSlug: string,
  input?: { q?: string; limit?: number },
  options?: ApiRequestOptions,
) {
  const params = new URLSearchParams();
  if (input?.q) {
    params.set("q", input.q);
  }
  if (typeof input?.limit === "number" && Number.isFinite(input.limit)) {
    params.set("limit", String(Math.max(1, Math.floor(input.limit))));
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return fetchJson<ConnectorTaxonomyItem[]>(
    `/marketplace/connectors/${encodeURIComponent(connectorSlug)}/taxonomy/search${query}`,
    undefined,
    options,
  );
}

export async function getUnmappedConnectorTaxonomy(connectorSlug: string, options?: ApiRequestOptions) {
  return fetchJson<Array<{ id: string; path: string; requiredAttributes: string[] }>>(
    `/marketplace/connectors/${encodeURIComponent(connectorSlug)}/taxonomy/unmapped`,
    undefined,
    options,
  );
}

export async function evaluateConnectorPublishReadiness(
  connectorSlug: string,
  body: { categoryScope: string; installationId?: string; fallbackAcknowledged?: boolean; productId?: string },
  options?: ApiRequestOptions,
) {
  return postJson<ConnectorPublishReadiness>(
    `/marketplace/connectors/${encodeURIComponent(connectorSlug)}/publish-readiness`,
    body,
    options,
  );
}

export async function getMarketplaceTemplate(templateId: string, options?: ApiRequestOptions) {
  return fetchJson<ChannelMappingTemplate>(
    `/marketplace/templates/${encodeURIComponent(templateId)}`,
    undefined,
    options,
  );
}

export async function updateMarketplaceTemplate(
  templateId: string,
  body: {
    name?: string;
    channel?: MarketplaceChannel;
    requiredFields?: string[];
    fieldMap?: Record<string, string>;
    isDefault?: boolean;
    version?: number;
  },
  options?: ApiRequestOptions,
) {
  return patchJson<ChannelMappingTemplate>(
    `/marketplace/templates/${encodeURIComponent(templateId)}`,
    body,
    options,
  );
}

export async function cloneMarketplaceTemplate(
  templateId: string,
  body?: { name?: string; isDefault?: boolean },
  options?: ApiRequestOptions,
) {
  return postJson<ChannelMappingTemplate>(
    `/marketplace/templates/${encodeURIComponent(templateId)}/clone`,
    body ?? {},
    options,
  );
}

export async function deleteMarketplaceTemplate(templateId: string, options?: ApiRequestOptions) {
  return deleteJson(`/marketplace/templates/${encodeURIComponent(templateId)}`, options);
}

export async function getConnectorPayloadPreview(
  installationId: string,
  body: {
    productId: string;
    templateId?: string;
    channel?: MarketplaceChannel;
  },
  options?: ApiRequestOptions,
) {
  return postJson<ConnectorPayloadPreviewResponse>(
    `/connectors/${encodeURIComponent(installationId)}/payload-preview`,
    body,
    options,
  );
}

export async function getMarketplaceSimulation(
  productId: string,
  channel: MarketplaceChannel,
  templateId?: string,
  options?: ApiRequestOptions,
) {
  const params = new URLSearchParams();
  params.set("channel", channel);
  if (templateId) {
    params.set("templateId", templateId);
  }
  return fetchJson<MarketplaceSimulation>(
    `/marketplace/products/${productId}/simulate?${params.toString()}`,
    undefined,
    options,
  );
}

export async function getMarketplaceExportJobs(
  productId: string,
  inputOrOptions?: ExportJobListQuery | ApiRequestOptions,
  maybeOptions?: ApiRequestOptions,
) {
  const queryInput = isApiRequestOptions(inputOrOptions) || !inputOrOptions ? {} : inputOrOptions;
  const options = isApiRequestOptions(inputOrOptions) ? inputOrOptions : maybeOptions;
  const params = new URLSearchParams();
  params.set("productId", productId);
  if (queryInput.templateSummary) {
    params.set("templateSummary", "true");
  }
  if (queryInput.cursor) {
    params.set("cursor", queryInput.cursor);
    params.set("pagination", "cursor");
  }
  if (typeof queryInput.limit === "number" && Number.isFinite(queryInput.limit)) {
    params.set("limit", String(Math.max(1, Math.floor(queryInput.limit))));
  }
  return fetchJson<MarketplaceExportJob[]>(
    `/marketplace/export-jobs?${params.toString()}`,
    undefined,
    options,
  );
}
