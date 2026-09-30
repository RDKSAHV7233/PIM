// A saved field map can reference a PIM attribute (e.g. "attributes.size") that has no attribute
// definition in the current category, so it had no display name and the dropdown printed the raw
// key. Give those a readable label; everything else keeps its existing label.

export function labelUndefinedSourceField(sourceField: string): string {
  const prefix = "attributes.";
  if (!sourceField.startsWith(prefix) || sourceField.length === prefix.length) {
    return sourceField;
  }
  const name = sourceField
    .slice(prefix.length)
    .split(/[._\s-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
  return name ? `${name} (Attribute)` : sourceField;
}
