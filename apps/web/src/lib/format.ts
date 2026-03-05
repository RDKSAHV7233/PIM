export function formatINR(value: number | null | undefined): string {
  if (value == null) {
    return "-";
  }
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatINRCompact(value: number | null | undefined): string {
  if (value == null) {
    return "-";
  }
  if (value >= 1_00_00_000) {
    return `\u20B9${(value / 1_00_00_000).toFixed(1)}Cr`;
  }
  if (value >= 1_00_000) {
    return `\u20B9${(value / 1_00_000).toFixed(1)}L`;
  }
  if (value >= 1_000) {
    return `\u20B9${(value / 1_000).toFixed(1)}K`;
  }
  return formatINR(value);
}