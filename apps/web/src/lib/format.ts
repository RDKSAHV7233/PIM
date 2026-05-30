const IST: Intl.DateTimeFormatOptions = { timeZone: "Asia/Kolkata" };

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const d = value instanceof Date ? value : new Date(value as string);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString("en-IN", IST);
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "-";
  const d = value instanceof Date ? value : new Date(value as string);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString("en-IN", { ...IST, day: "numeric", month: "short", year: "numeric" });
}

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