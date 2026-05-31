import type { ApiClientScope } from "@/lib/api";

/**
 * All API key scopes that can be granted when creating an access key.
 * Single source of truth — consumed by api-keys/actions.ts validation
 * and api-keys/page.tsx scope selector.
 */
export const SUPPORTED_API_KEY_SCOPES: readonly ApiClientScope[] = [
  "catalog.read",
  "catalog.write",
  "bulk_import.read",
  "media.read",
  "compliance.read",
  "issues.read",
  "rejection_intelligence.read",
  "auto_suggestions.read",
  "taxonomy.read",
] satisfies readonly ApiClientScope[];

export const API_KEY_SCOPE_LABELS: Record<ApiClientScope, string> = {
  "catalog.read":                   "Catalog — read",
  "catalog.write":                  "Catalog — write",
  "bulk_import.read":               "Bulk import — read",
  "media.read":                     "Media — read",
  "compliance.read":                "Compliance — read",
  "issues.read":                    "Issues — read",
  "rejection_intelligence.read":    "Rejection intelligence — read",
  "auto_suggestions.read":          "AI auto-suggestions — read",
  "taxonomy.read":                  "Taxonomy — read",
};

/**
 * Plain-English scope legend for the admin API Keys page (AK-03).
 * Array form for ordered rendering — uses dot notation matching ApiClientScope.
 */
export const API_SCOPE_LEGEND = [
  {
    scope: "catalog.read" as ApiClientScope,
    description: "Read product, category, and attribute data without changing catalog records.",
  },
  {
    scope: "catalog.write" as ApiClientScope,
    description: "Create or update catalog content such as products, taxonomy, and product fields.",
  },
  {
    scope: "bulk_import.read" as ApiClientScope,
    description: "Read bulk import jobs, status, and error reports for automation monitoring.",
  },
  {
    scope: "media.read" as ApiClientScope,
    description: "Inspect media assets, validation results, and governance settings.",
  },
  {
    scope: "compliance.read" as ApiClientScope,
    description: "Read compliance check results and validation health signals.",
  },
  {
    scope: "issues.read" as ApiClientScope,
    description: "Read issue inbox, approvals, and quality health signals for integrations.",
  },
  {
    scope: "rejection_intelligence.read" as ApiClientScope,
    description: "Read rejection intelligence insights and channel feedback signals.",
  },
  {
    scope: "auto_suggestions.read" as ApiClientScope,
    description: "Read AI auto-suggestion results for catalog enrichment workflows.",
  },
  {
    scope: "taxonomy.read" as ApiClientScope,
    description: "Read taxonomy categories, attributes, and classification data.",
  },
] satisfies readonly { scope: ApiClientScope; description: string }[];
