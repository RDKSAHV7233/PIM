import type { AiAttributeEnrichment, AiCategorySuggestion, AiTitleSuggestion, ApiRequestOptions, BulkEditOperation, BulkEditPreview, BulkEditScope, BulkEditUpdates, BulkImportJob, BulkImportMappingSuggestion, BulkImportRow, BulkImportRowStatus, BulkImportTemplate, BulkMediaAssociationResult, ConnectorSubmission, ConnectorSubmissionIssue, MarketplaceChannel, MarketplaceExportJob, MediaAsset, MediaValidation, OndcMapping, OndcSimulation, OndcVersionInfo, PaginatedResponse, RejectionIntelligenceScore } from "./core";
import { fetchJson, postJson } from "./core";

export async function getSubmissions(
  filters?: {
    productId?: string;
    connectorSlug?: string;
    installationId?: string;
    status?: string;
    minAttempt?: number;
    cursor?: string;
    limit?: number;
  },
  options?: ApiRequestOptions,
) {
  const params = new URLSearchParams();
  if (filters?.productId) {
    params.set("productId", filters.productId);
  }
  if (filters?.connectorSlug) {
    params.set("connectorSlug", filters.connectorSlug);
  }
  if (filters?.installationId) {
    params.set("installationId", filters.installationId);
  }
  if (filters?.status) {
    params.set("status", filters.status);
  }
  if (typeof filters?.minAttempt === "number" && Number.isFinite(filters.minAttempt)) {
    params.set("minAttempt", String(Math.max(1, Math.floor(filters.minAttempt))));
  }
  if (filters?.cursor) {
    params.set("cursor", filters.cursor);
  }
  if (typeof filters?.limit === "number" && Number.isFinite(filters.limit)) {
    params.set("limit", String(Math.max(1, Math.floor(filters.limit))));
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return fetchJson<PaginatedResponse<ConnectorSubmission> | ConnectorSubmission[]>(
    `/submissions${query}`,
    undefined,
    options,
  );
}

export async function getDeadLetterSubmissions(
  filters?: { cursor?: string; limit?: number },
  options?: ApiRequestOptions,
) {
  const params = new URLSearchParams();
  if (filters?.cursor) {
    params.set("cursor", filters.cursor);
  }
  if (typeof filters?.limit === "number" && Number.isFinite(filters.limit)) {
    params.set("limit", String(Math.max(1, Math.floor(filters.limit))));
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return fetchJson<PaginatedResponse<MarketplaceExportJob> | MarketplaceExportJob[]>(
    `/submissions/dead-letter${query}`,
    undefined,
    options,
  );
}

export async function getSubmission(submissionId: string, options?: ApiRequestOptions) {
  return fetchJson<ConnectorSubmission>(
    `/submissions/${encodeURIComponent(submissionId)}`,
    undefined,
    options,
  );
}

export async function getSubmissionIssues(submissionId: string, options?: ApiRequestOptions) {
  return fetchJson<ConnectorSubmissionIssue[]>(
    `/submissions/${encodeURIComponent(submissionId)}/issues`,
    undefined,
    options,
  );
}

export async function getBulkImportJobs(options?: ApiRequestOptions) {
  return fetchJson<BulkImportJob[]>("/bulk-import/jobs", undefined, options);
}

export async function getBulkImportTemplates(
  tenantKey: string,
  categoryId?: string,
  options?: ApiRequestOptions,
) {
  const params = new URLSearchParams();
  params.set("tenantKey", tenantKey);
  if (categoryId) {
    params.set("categoryId", categoryId);
  }
  return fetchJson<BulkImportTemplate[]>(
    `/bulk-import/templates?${params.toString()}`,
    undefined,
    options,
  );
}

export async function getBulkImportJobRows(
  jobId: string,
  status?: BulkImportRowStatus,
  limit = 100,
  options?: ApiRequestOptions,
) {
  const params = new URLSearchParams();
  if (status) {
    params.set("status", status);
  }
  params.set("limit", String(limit));
  return fetchJson<BulkImportRow[]>(
    `/bulk-import/jobs/${encodeURIComponent(jobId)}/rows?${params.toString()}`,
    undefined,
    options,
  );
}

export async function getBulkImportMappingSuggestion(
  headers: string[],
  options?: ApiRequestOptions,
) {
  return postJson<BulkImportMappingSuggestion>("/bulk-import/mapping-suggestions", {
    headers,
  }, options);
}

export async function getBulkEditPreview(
  scope: BulkEditScope,
  updates: BulkEditUpdates,
  options?: ApiRequestOptions,
) {
  return postJson<BulkEditPreview>("/bulk-edit/preview", {
    scope,
    updates,
  }, options);
}

export async function applyBulkEdit(
  scope: BulkEditScope,
  updates: BulkEditUpdates,
  options?: ApiRequestOptions,
) {
  return postJson<BulkEditOperation>("/bulk-edit/apply", {
    scope,
    updates,
  }, options);
}

export async function getBulkEditOperations(limit = 20, options?: ApiRequestOptions) {
  return fetchJson<BulkEditOperation[]>(
    `/bulk-edit/operations?limit=${encodeURIComponent(String(limit))}`,
    undefined,
    options,
  );
}

export async function getBulkEditOperation(operationId: string, options?: ApiRequestOptions) {
  return fetchJson<BulkEditOperation>(
    `/bulk-edit/operations/${encodeURIComponent(operationId)}`,
    undefined,
    options,
  );
}

export async function getMediaAssets(
  productId?: string,
  variantId?: string,
  options?: ApiRequestOptions,
) {
  const params = new URLSearchParams();
  if (productId) {
    params.set("productId", productId);
  }
  if (variantId) {
    params.set("variantId", variantId);
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return fetchJson<MediaAsset[]>(`/media/assets${query}`, undefined, options);
}

export async function getMediaAssetValidation(
  assetId: string,
  channel: MarketplaceChannel,
  options?: ApiRequestOptions,
) {
  return fetchJson<MediaValidation>(
    `/media/assets/${encodeURIComponent(assetId)}/validation?channel=${encodeURIComponent(channel)}`,
    undefined,
    options,
  );
}

export async function runBulkMediaAssociation(
  payload:
    | {
        csvContent: string;
      }
    | {
        rows: Array<{
          skuCode: string;
          imageUrl?: string;
          contentBase64?: string;
          fileName?: string;
          mimeType?: string;
          width?: number;
          height?: number;
        }>;
      },
  options?: ApiRequestOptions,
) {
  return postJson<BulkMediaAssociationResult>("/media/bulk-associations", payload, options);
}

export async function getRejectionIntelligenceScore(
  productId: string,
  channel: MarketplaceChannel,
  options?: ApiRequestOptions,
) {
  return fetchJson<RejectionIntelligenceScore>(
    `/rejection-intelligence/products/${encodeURIComponent(productId)}/score?channel=${encodeURIComponent(channel)}`,
    undefined,
    options,
  );
}

export async function getOndcVersions(options?: ApiRequestOptions) {
  return fetchJson<OndcVersionInfo[]>("/ondc/versions", undefined, options);
}

export async function getOndcMappings(
  filters: { nodeType?: string; version?: string; categoryId?: string },
  options?: ApiRequestOptions,
) {
  const params = new URLSearchParams();
  if (filters.nodeType) {
    params.set("nodeType", filters.nodeType);
  }
  if (filters.version) {
    params.set("version", filters.version);
  }
  if (filters.categoryId) {
    params.set("categoryId", filters.categoryId);
  }
  const query = params.size > 0 ? `?${params.toString()}` : "";
  return fetchJson<OndcMapping[]>(`/ondc/mappings${query}`, undefined, options);
}

export async function getOndcSimulation(
  productId: string,
  nodeType: string,
  version: string,
  mappingId?: string,
  options?: ApiRequestOptions,
) {
  const params = new URLSearchParams();
  params.set("nodeType", nodeType);
  params.set("version", version);
  if (mappingId) {
    params.set("mappingId", mappingId);
  }
  return fetchJson<OndcSimulation>(
    `/ondc/products/${encodeURIComponent(productId)}/simulate?${params.toString()}`,
    undefined,
    options,
  );
}

export async function getAiTitleSuggestion(productId: string, options?: ApiRequestOptions) {
  return fetchJson<AiTitleSuggestion>(
    `/auto-suggestions/products/${encodeURIComponent(productId)}/title-suggestion`,
    undefined,
    options,
  );
}

export async function getAiAttributeEnrichment(productId: string, options?: ApiRequestOptions) {
  return fetchJson<AiAttributeEnrichment>(
    `/auto-suggestions/products/${encodeURIComponent(productId)}/attribute-enrichment`,
    undefined,
    options,
  );
}

export async function getAiCategorySuggestion(productId: string, options?: ApiRequestOptions) {
  return fetchJson<AiCategorySuggestion>(
    `/auto-suggestions/products/${encodeURIComponent(productId)}/category-suggestion`,
    undefined,
    options,
  );
}
