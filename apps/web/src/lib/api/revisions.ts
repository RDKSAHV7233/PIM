import type { ApiRequestOptions } from "./core";
import { fetchJson } from "./core";

export interface ProductRevisionChangedField {
  field: string;
  displayLabel?: string;
  before: unknown;
  after: unknown;
}

export interface ProductRevision {
  revisionId: string;
  productId: string;
  createdAt: string;
  actorId: string | null;
  actorLabel: string | null;
  changedFields: ProductRevisionChangedField[];
  summary?: {
    changedSectionCount: number;
  };
}

export interface ProductRevisionsResponse {
  items: ProductRevision[];
}

export async function getProductRevisions(
  productId: string,
  options?: ApiRequestOptions,
): Promise<ProductRevisionsResponse> {
  return fetchJson<ProductRevisionsResponse>(
    `/products/${encodeURIComponent(productId)}/revisions`,
    undefined,
    options,
  );
}
