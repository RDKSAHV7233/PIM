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

// \u2500\u2500 Multi-currency formatters \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
// Use these when displaying prices from PriceLists (multi-market tenants).
// `formatINR` / `formatINRCompact` remain unchanged for India-only views.

type CurrencyFmtOpts = {
  /** BCP-47 locale to use for digit grouping / decimal separator. Defaults to DEFAULT_LOCALE ("en-IN"). */
  locale?: string;
  /** Number of decimal places. When omitted the ISO 4217 standard for the currency is applied by the browser/Node. */
  maximumFractionDigits?: number;
};

/**
 * Format a monetary value using Intl.NumberFormat with the given ISO 4217 currencyCode.
 *
 * @example
 *   formatCurrency(1999, "GBP")              // "\u00A31,999"
 *   formatCurrency(1999.5, "USD", { locale: "en-US" })  // "$1,999.50"
 *   formatCurrency(null, "AED")              // "-"
 */
export function formatCurrency(
  value: number | null | undefined,
  currencyCode: string,
  opts?: CurrencyFmtOpts,
): string {
  if (value == null) return "-";
  // Fall back to formatINR for INR \u2014 preserves existing locale/rounding behaviour.
  if (currencyCode === "INR" && !opts?.locale && opts?.maximumFractionDigits == null) {
    return formatINR(value);
  }
  try {
    return new Intl.NumberFormat(opts?.locale ?? DEFAULT_LOCALE, {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: opts?.maximumFractionDigits ?? 0,
    }).format(value);
  } catch {
    // Unknown currencyCode passed at runtime \u2014 fall back to plain number with code suffix.
    return `${value.toLocaleString(opts?.locale ?? DEFAULT_LOCALE)} ${currencyCode}`;
  }
}

/**
 * Compact version of `formatCurrency`.
 *
 * - INR \u2192 Indian notation (L / Cr) via `formatINRCompact`.
 * - All other currencies \u2192 SI suffixes (K / M / B) with the currency symbol.
 *
 * @example
 *   formatCurrencyCompact(1_500_000, "GBP")  // "\u00A31.5M"
 *   formatCurrencyCompact(250_000, "INR")    // "\u20B92.5L"
 *   formatCurrencyCompact(null, "USD")       // "-"
 */
export function formatCurrencyCompact(
  value: number | null | undefined,
  currencyCode: string,
  opts?: CurrencyFmtOpts,
): string {
  if (value == null) return "-";
  if (currencyCode === "INR" && !opts?.locale) {
    return formatINRCompact(value);
  }
  const absValue = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  // Determine symbol by formatting a known small value and stripping the number.
  let symbol = currencyCode;
  try {
    const formatted = new Intl.NumberFormat(opts?.locale ?? DEFAULT_LOCALE, {
      style: "currency",
      currency: currencyCode,
      maximumFractionDigits: 0,
    }).format(1);
    // Strip digits and separators to isolate the symbol (works for prefix symbols like \u00A3, $, \u20AC).
    symbol = formatted.replace(/[\d,.\s]/g, "").trim() || currencyCode;
  } catch {
    // Unknown currency \u2014 use code as symbol.
  }
  if (absValue >= 1_000_000_000) {
    return `${sign}${symbol}${(absValue / 1_000_000_000).toFixed(1)}B`;
  }
  if (absValue >= 1_000_000) {
    return `${sign}${symbol}${(absValue / 1_000_000).toFixed(1)}M`;
  }
  if (absValue >= 1_000) {
    return `${sign}${symbol}${(absValue / 1_000).toFixed(1)}K`;
  }
  return formatCurrency(value, currencyCode, opts);
}