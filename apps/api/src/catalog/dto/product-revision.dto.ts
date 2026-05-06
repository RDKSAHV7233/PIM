export interface ChangedField {
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
  changedFields: ChangedField[];
  summary?: {
    changedSectionCount: number;
  };
}

export interface ProductRevisionsResponse {
  items: ProductRevision[];
}
