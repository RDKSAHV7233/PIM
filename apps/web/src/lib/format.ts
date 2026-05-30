// ── Display locale / timezone ─────────────────────────────────────────────────
// These two env vars are the single source of truth for date/time presentation.
// Set NEXT_PUBLIC_DISPLAY_LOCALE and NEXT_PUBLIC_DISPLAY_TIMEZONE in your
// Railway / .env.local to override. Defaults keep existing IST behaviour so
// no current tenant is affected. When per-tenant timezone lands (BACKLOG-TZ),
// pass overrides directly to the format* helpers instead of relying on these
// module-level defaults.
const DEFAULT_LOCALE =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_DISPLAY_LOCALE) || "en-IN";
const DEFAULT_TZ =
  (typeof process !== "undefined" && process.env.NEXT_PUBLIC_DISPLAY_TIMEZONE) || "Asia/Kolkata";

const defaultTZOpts: Intl.DateTimeFormatOptions = { timeZone: DEFAULT_TZ };

type FmtOpts = { locale?: string; timeZone?: string };

export function formatDateTime(
  value: string | Date | null | undefined,
  opts?: FmtOpts,
): string {
  if (!value) return "-";
  const d = value instanceof Date ? value : new Date(value as string);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleString(opts?.locale ?? DEFAULT_LOCALE, {
    timeZone: opts?.timeZone ?? DEFAULT_TZ,
  });
}

export function formatDate(
  value: string | Date | null | undefined,
  opts?: FmtOpts,
): string {
  if (!value) return "-";
  const d = value instanceof Date ? value : new Date(value as string);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleDateString(opts?.locale ?? DEFAULT_LOCALE, {
    ...defaultTZOpts,
    timeZone: opts?.timeZone ?? DEFAULT_TZ,
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatTime(
  value: string | Date | null | undefined,
  opts?: FmtOpts,
): string {
  if (!value) return "-";
  const d = value instanceof Date ? value : new Date(value as string);
  if (Number.isNaN(d.getTime())) return "-";
  return d.toLocaleTimeString(opts?.locale ?? DEFAULT_LOCALE, {
    timeZone: opts?.timeZone ?? DEFAULT_TZ,
  });
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