/**
 * Maps a raw `fieldPath` value (as stored in ValidationIssue) to a short
 * human-readable label for display in the issue inbox and the product Quality tab.
 *
 * Handles built-in compliance field paths and the `attributes.<key>` pattern.
 * Falls back to the raw value for anything else so future rule codes surface
 * automatically without needing a code change here.
 */
const KNOWN_FIELD_LABELS: Record<string, string> = {
  hsnCode: "HSN Code",
  gstRate: "GST Rate",
  taxCodes: "International Tax Codes",
  title: "Title",
  brand: "Brand",
  description: "Description",
  pricing: "Pricing",
};

export function humaniseFieldPath(fieldPath: string | null | undefined): string {
  if (!fieldPath || !fieldPath.trim()) {
    return "-";
  }
  if (KNOWN_FIELD_LABELS[fieldPath]) {
    return KNOWN_FIELD_LABELS[fieldPath];
  }
  if (fieldPath.startsWith("attributes.")) {
    const key = fieldPath.slice("attributes.".length);
    return `Attr: ${key}`;
  }
  return fieldPath;
}
