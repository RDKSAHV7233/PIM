export const colors = {
  ink: "#0f1117",
  inkMid: "#2d3142",
  inkSoft: "#6b7280",
  inkGhost: "#9ca3af",
  paper: "#f8f7f4",
  paperWarm: "#eeece9",
  paperMid: "#e2dedd",
  surface: "#ffffff",

  accent: "#e8450a",
  accentSoft: "#fff1ec",
  info: "#1d4ed8",
  infoSoft: "#eff6ff",
  success: "#059669",
  successSoft: "#ecfdf5",
  warning: "#d97706",
  warningSoft: "#fffbeb",
  danger: "#dc2626",
  dangerSoft: "#fef2f2",

  amazon: "#f90",
  amazonText: "#111",
  flipkart: "#2874f0",
  meesho: "#e8450a",
} as const;

export const radius = {
  sm: "4px",
  md: "6px",
  lg: "10px",
  xl: "14px",
} as const;

export type Severity = "error" | "warning" | "info" | "success";

export const severityConfig: Record<
  Severity,
  { bg: string; border: string; text: string; dot: string; label: string }
> = {
  error: { bg: "#fef2f2", border: "#fecaca", text: "#dc2626", dot: "#dc2626", label: "Error" },
  warning: {
    bg: "#fffbeb",
    border: "#fde68a",
    text: "#d97706",
    dot: "#d97706",
    label: "Warning",
  },
  info: { bg: "#eff6ff", border: "#bfdbfe", text: "#1d4ed8", dot: "#1d4ed8", label: "Info" },
  success: {
    bg: "#ecfdf5",
    border: "#a7f3d0",
    text: "#059669",
    dot: "#059669",
    label: "Success",
  },
};

export type Channel = "amazon" | "flipkart" | "meesho";

export const channelConfig: Record<
  Channel,
  { label: string; short: string; bg: string; text: string; border: string }
> = {
  amazon: { label: "Amazon.in", short: "A", bg: "#fffbeb", text: "#92400e", border: "#fbbf24" },
  flipkart: { label: "Flipkart", short: "F", bg: "#eff6ff", text: "#1e40af", border: "#93c5fd" },
  meesho: { label: "Meesho", short: "M", bg: "#fff1ec", text: "#9a3412", border: "#fdba74" },
};
