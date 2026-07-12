const FORMULA_PREFIXES = new Set(["=", "+", "-", "@"]);

export function safeCsvCell(value: string): string {
  const str = String(value ?? "");
  const escaped = str.replace(/"/g, '""');

  const firstChar = str.charAt(0);
  if (firstChar && (FORMULA_PREFIXES.has(firstChar) || firstChar === "\t" || firstChar === "\r")) {
    return `"'${escaped}"`;
  }

  return `"${escaped}"`;
}
