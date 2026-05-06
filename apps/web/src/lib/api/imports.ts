import type { ApiRequestOptions, BulkImportRun } from "./core";
import { fetchJson, postJson } from "./core";

export interface ImportValidateRequest {
  categoryId?: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}

export interface ImportValidateSampleError {
  row: number;
  field: string;
  message: string;
}

export interface ImportValidateFieldMapping {
  sourceField: string;
  mappedTo: string | null;
}

export interface ImportValidateResponse {
  valid: boolean;
  formatValid: boolean;
  schemaIssues: string[];
  categoryIssues: string[];
  rowCount: number | null;
  blockingCount: number;
  warningCount: number;
  sampleErrors: ImportValidateSampleError[];
  fieldMappingSummary: ImportValidateFieldMapping[];
  effectiveMode?: "standard" | "large" | null;
  estimatedBatchCount?: number | null;
  runId?: string | null;
  mvpCeilingExceeded?: boolean | null;
  skuCodeSummary?: { duplicateCount: number; collisionCount: number } | null;
}

export async function validateImportPreflight(
  request: ImportValidateRequest,
  options?: ApiRequestOptions,
): Promise<ImportValidateResponse> {
  return postJson<ImportValidateResponse>("/bulk-import/validate", request, options);
}

export async function validateRunPreflight(
  runId: string,
  options?: ApiRequestOptions,
): Promise<BulkImportRun> {
  return postJson<BulkImportRun>(`/bulk-import/runs/${encodeURIComponent(runId)}/validate`, {}, options);
}
