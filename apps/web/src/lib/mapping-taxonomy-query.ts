// The taxonomy search endpoint rejects a `q` longer than 255 characters with a 400
// (ConnectorTaxonomySearchQueryDto @MaxLength(255)). The wizard passed the raw URL value through, so an
// over-long filter crashed the whole page into the generic error screen. Clamp it before it is used.

export const MAX_TAXONOMY_QUERY_LENGTH = 255;

export function clampTaxonomyQuery(value: unknown): string {
  return String(value ?? "").trim().slice(0, MAX_TAXONOMY_QUERY_LENGTH).trim();
}
