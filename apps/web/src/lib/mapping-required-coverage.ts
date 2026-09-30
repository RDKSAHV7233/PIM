// `required_fields` are canonical PIM field names (e.g. "title", "attributes.mainImageUrl"). A mapping
// covers one either as a target row or, when the channel renames it (WooCommerce maps title -> name),
// as a source key of field_mappings. The API's readiness check (connector-mapping.service.ts,
// mappingHasSource / mappingHasTarget) already counts both, but the wizard only counted target rows, so
// it showed "missing" for fields the mapping already covered and contradicted the Readiness card.

export interface RequiredCoverage {
  source: string;
  targets: string[];
}

function targetsOf(value: unknown): string[] {
  const list = Array.isArray(value) ? value : [value];
  return Array.from(new Set(list.map((item) => String(item ?? "").trim()).filter((item) => item.length > 0)));
}

// Same normalisation the API uses: a required "sku" matches an "attributes.sku" source key and vice versa.
function sourceCandidates(requiredField: string): string[] {
  const field = requiredField.trim();
  if (!field) {
    return [];
  }
  const alternate = field.startsWith("attributes.") ? field.slice("attributes.".length) : `attributes.${field}`;
  return Array.from(new Set([field, alternate].filter((item) => item.length > 0 && item !== "attributes.")));
}

export function findRequiredCoverage(requiredField: string, fieldMap: Record<string, unknown>): RequiredCoverage | null {
  for (const candidate of sourceCandidates(requiredField)) {
    const targets = targetsOf(fieldMap[candidate]);
    if (targets.length > 0) {
      return { source: candidate, targets };
    }
  }
  return null;
}

// Required fields with no target row mapped that the field map still covers as a source key.
export function requiredCoverageBySource(
  requiredFields: string[],
  fieldMap: Record<string, unknown>,
  mappedTargetToSource: Record<string, string>,
): Record<string, RequiredCoverage> {
  const covered: Record<string, RequiredCoverage> = {};
  for (const field of requiredFields) {
    if (mappedTargetToSource[field]) {
      continue;
    }
    const coverage = findRequiredCoverage(field, fieldMap);
    if (coverage) {
      covered[field] = coverage;
    }
  }
  return covered;
}
