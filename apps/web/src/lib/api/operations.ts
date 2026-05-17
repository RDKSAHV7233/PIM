import type { AiAttributeEnrichment, AiCategorySuggestion, AiTitleSuggestion, ApiRequestOptions, BulkEditOperation, BulkEditPreview, BulkEditScope, BulkEditUpdates, BulkImportJob, BulkImportMappingSuggestion, BulkImportRow, BulkImportRowStatus, BulkImportRun, BulkImportRunRow, BulkImportRunStatus, BulkImportTemplate, BulkMediaAssociationResult, ConnectorSubmission, ConnectorSubmissionIssue, MarketplaceChannel, MarketplaceExportJob, MediaAsset, MediaValidation, OndcMapping, OndcSimulation, OndcVersionInfo, PaginatedResponse, RejectionIntelligenceScore } from "./core";
import { fetchJson, postFormData, postJson } from "./core";

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

export async function retrySubmission(
  submissionId: string,
  options?: ApiRequestOptions,
) {
  return postJson<{ queued: boolean; submissionId: string; mode?: string }>(
    `/submissions/${encodeURIComponent(submissionId)}/retry`,
    {},
    options,
  );
}

export async function getBulkImportJobs(options?: ApiRequestOptions) {
  const response = await fetchJson<BulkImportJob[] | { items: BulkImportJob[] }>(
    "/bulk-import/jobs",
    undefined,
    options,
  );
  // API returns a paginated envelope { items: [...] } — extract to array
  if (response && !Array.isArray(response) && "items" in response) {
    return response.items ?? [];
  }
  return (response as BulkImportJob[]) ?? [];
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
  const response = await fetchJson<PaginatedResponse<BulkImportTemplate> | BulkImportTemplate[]>(
    `/bulk-import/templates?${params.toString()}`,
    undefined,
    options,
  );
  return Array.isArray(response) ? response : (response.items ?? []);
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
  const response = await fetchJson<PaginatedResponse<BulkImportRow> | BulkImportRow[]>(
    `/bulk-import/jobs/${encodeURIComponent(jobId)}/rows?${params.toString()}`,
    undefined,
    options,
  );
  return Array.isArray(response) ? response : (response.items ?? []);
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
  const response = await fetchJson<PaginatedResponse<BulkEditOperation> | BulkEditOperation[]>(
    `/bulk-edit/operations?limit=${encodeURIComponent(String(limit))}`,
    undefined,
    options,
  );
  return Array.isArray(response) ? response : (response.items ?? []);
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
  const response = await fetchJson<PaginatedResponse<MediaAsset> | MediaAsset[]>(
    `/media/assets${query}`,
    undefined,
    options,
  );
  return Array.isArray(response) ? response : (response.items ?? []);
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

// ── Large Import Run helpers ─────────────────────────────────────────────────

export async function uploadBulkImportRun(
  categoryId: string,
  file: File,
  sourceName?: string,
  options?: ApiRequestOptions,
) {
  const form = new FormData();
  form.append("categoryId", categoryId);
  form.append("sourceFile", file, file.name);
  if (sourceName) form.append("sourceName", sourceName);
  return postFormData<BulkImportRun>("/bulk-import/runs/upload", form, options);
}

export async function getBulkImportRuns(
  status?: BulkImportRunStatus,
  cursor?: string,
  options?: ApiRequestOptions,
) {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (cursor) params.set("cursor", cursor);
  const qs = params.toString();
  return fetchJson<BulkImportRun[] | PaginatedResponse<BulkImportRun>>(
    `/bulk-import/runs${qs ? `?${qs}` : ""}`,
    undefined,
    options,
  );
}

export async function getBulkImportRun(runId: string, options?: ApiRequestOptions) {
  return fetchJson<BulkImportRun>(`/bulk-import/runs/${encodeURIComponent(runId)}`, undefined, options);
}

export async function validateBulkImportRun(runId: string, options?: ApiRequestOptions) {
  return postJson<BulkImportRun>(`/bulk-import/runs/${encodeURIComponent(runId)}/validate`, {}, options);
}

export async function startBulkImportRun(runId: string, options?: ApiRequestOptions) {
  return postJson<BulkImportRun>(`/bulk-import/runs/${encodeURIComponent(runId)}/start`, {}, options);
}

export async function getBulkImportRunRows(
  runId: string,
  status?: string,
  cursor?: string,
  options?: ApiRequestOptions,
) {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (cursor) params.set("cursor", cursor);
  const qs = params.toString();
  return fetchJson<BulkImportRunRow[] | PaginatedResponse<BulkImportRunRow>>(
    `/bulk-import/runs/${encodeURIComponent(runId)}/rows${qs ? `?${qs}` : ""}`,
    undefined,
    options,
  );
}
