import type { MarketplaceChannel } from "./marketplace-channels";

export const colors = {
  ink: "#0f172a",
  inkMid: "#334155",
  inkSoft: "#64748b",
  inkGhost: "#9ca3af",
  inkDisabled: "#cbd5e1",
  paper: "#f8fafc",
  paperWarm: "#f1f5f9",
  paperMid: "#e2e8f0",
  surface: "#ffffff",

  accent: "#2563eb",
  accentSoft: "#eff6ff",
  info: "#2563eb",
  infoSoft: "#eff6ff",
  infoBorder: "#bfdbfe",
  infoText: "#1d4ed8",
  success: "#059669",
  successSoft: "#ecfdf5",
  successBorder: "#a7f3d0",
  successText: "#047857",
  warning: "#d97706",
  warningSoft: "#fffbeb",
  warningBorder: "#fde68a",
  warningText: "#92400e",
  danger: "#dc2626",
  dangerSoft: "#fef2f2",
  dangerBorder: "#fecaca",
  dangerText: "#b91c1c",
  neutralText: "#475569",

  indigo: "#6366f1",
  indigoSoft: "#eef2ff",
  sky: "#38bdf8",
  violet: "#7c3aed",

  amazon: "#f90",
  amazonBg: "#fffbeb",
  amazonText: "#92400e",
  flipkart: "#2874f0",
  flipkartBg: "#eff6ff",
  flipkartText: "#1e40af",
  meesho: "#e8450a",
  meeshoBg: "#fff1ec",
  meeshoText: "#9a3412",
  shopify: "#008060",
  shopifyBg: "#ecfdf5",
  shopifyText: "#047857",
} as const;

export type Severity = "error" | "warning" | "info" | "success";

export const severityConfig: Record<
  Severity,
  { bg: string; border: string; text: string; dot: string; label: string }
> = {
  error: { bg: colors.dangerSoft, border: colors.dangerBorder, text: colors.danger, dot: colors.danger, label: "Error" },
  warning: { bg: colors.warningSoft, border: colors.warningBorder, text: colors.warning, dot: colors.warning, label: "Warning" },
  info: { bg: colors.infoSoft, border: colors.infoBorder, text: colors.infoText, dot: colors.infoText, label: "Info" },
  success: { bg: colors.successSoft, border: colors.successBorder, text: colors.success, dot: colors.success, label: "Success" },
};

export type Channel = MarketplaceChannel;

export const channelConfig: Record<
  Channel,
  { label: string; short: string; bg: string; text: string; border: string; color: string }
> = {
  amazon: { label: "Amazon.in", short: "A", bg: "#fffbeb", text: "#92400e", border: "#fbbf24", color: "#f90" },
  flipkart: { label: "Flipkart", short: "F", bg: "#eff6ff", text: "#1e40af", border: "#93c5fd", color: "#2874f0" },
  meesho: { label: "Meesho", short: "M", bg: "#fff1ec", text: "#9a3412", border: "#fdba74", color: "#e8450a" },
  shopify: { label: "Shopify", short: "S", bg: "#ecfdf5", text: "#047857", border: "#6ee7b7", color: "#008060" },
};

export const radius = {
  sm: "4px",
  md: "6px",
  lg: "10px",
  xl: "14px",
  "2xl": "18px",
  "3xl": "28px",
  pill: "9999px",
} as const;

export const shadows = {
  sm: "0 1px 2px rgba(15, 23, 42, 0.04)",
  card: "0 1px 2px rgba(15, 23, 42, 0.04), 0 1px 3px rgba(15, 23, 42, 0.04)",
  pop: "0 10px 24px rgba(15, 23, 42, 0.08)",
  hero: "0 28px 70px rgba(148, 163, 184, 0.18)",
  buttonDark: "0 18px 36px rgba(15, 23, 42, 0.22)",
  brand: "0 12px 32px rgba(99, 102, 241, 0.32)",
} as const;
