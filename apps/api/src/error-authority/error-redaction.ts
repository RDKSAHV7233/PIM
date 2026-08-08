import { createHmac } from "node:crypto";
import type { SafeStackFrame } from "./error-authority.types";

const SECRET_PATTERNS = [
  /bearer\s+[a-z0-9._~+/=-]+/gi,
  /password\s*[:=]\s*[^,\s}]+/gi,
  /token\s*[:=]\s*[^,\s}]+/gi,
  /secret\s*[:=]\s*[^,\s}]+/gi,
  /cookie\s*[:=]\s*[^,\s}]+/gi,
];

const NORMALIZATION_PATTERNS: Array<[RegExp, string]> = [
  [/[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}/gi, "{uuid}"],
  [/\bcm[a-z0-9]{12,}\b/gi, "{cuid}"],
  [/\b[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}\b/gi, "{email}"],
  [/https?:\/\/[^\s)]+/gi, "{url}"],
  [/\b\d{4}-\d{2}-\d{2}t\d{2}:\d{2}:\d{2}(?:\.\d+)?z\b/gi, "{timestamp}"],
  [/\b\d{6,}\b/g, "{number}"],
];

export function toSafeText(value: unknown, fallback = "Unexpected application error"): string {
  const raw = value instanceof Error ? value.message : String(value ?? "");
  let text = raw.trim() || fallback;
  for (const pattern of SECRET_PATTERNS) {
    text = text.replace(pattern, "{redacted}");
  }
  return text.slice(0, 500);
}

export function normalizeErrorMessage(value: unknown): string {
  let text = toSafeText(value).toLowerCase();
  for (const [pattern, replacement] of NORMALIZATION_PATTERNS) {
    text = text.replace(pattern, replacement);
  }
  return text.replace(/\s+/g, " ").trim().slice(0, 500);
}

export function createSafeRef(kind: "tenant" | "actor", rawValue: string | undefined, secret: string | undefined): string | undefined {
  const value = String(rawValue ?? "").trim();
  if (!value || !secret || secret.length < 32) {
    return undefined;
  }
  const digest = createHmac("sha256", secret).update(`${kind}:${value}`).digest("hex").slice(0, 24);
  return `${kind}_${digest}`;
}

export function normalizeFrames(frames: SafeStackFrame[] | undefined): SafeStackFrame[] | undefined {
  const safeFrames = (frames ?? [])
    .map((frame) => ({
      file: sanitizeFrameText(frame.file).slice(0, 240),
      functionName: frame.functionName ? sanitizeFrameText(frame.functionName).slice(0, 160) : undefined,
      line: Number.isFinite(frame.line) ? Math.max(0, Math.floor(Number(frame.line))) : undefined,
      column: Number.isFinite(frame.column) ? Math.max(0, Math.floor(Number(frame.column))) : undefined,
    }))
    .filter((frame) => frame.file.length > 0)
    .slice(0, 20);
  return safeFrames.length > 0 ? safeFrames : undefined;
}

function sanitizeFrameText(value: unknown): string {
  return String(value ?? "")
    .replace(/\\/g, "/")
    .replace(/[A-Z]:\/Users\/[^/]+/gi, "{userhome}")
    .replace(/\/home\/[^/]+/gi, "{userhome}")
    .trim();
}
