/**
 * QA-AI-01 (#1236): the internal AI Lab page (`/ai`) and its repair action are available only when this flag is explicitly enabled.
 * Fail-closed: unset, empty, "false", malformed or any other value means DISABLED; only the text `true` (any case, surrounding
 * whitespace ignored) enables it. Mirrors the API-side flag in `apps/api/src/auto-suggestions/internal-ai-lab-flag.ts`.
 *
 * This is deliberately independent of APP_ENV. Vexa runs one deployment that serves production under the environment name
 * "Staging", so an environment name cannot be trusted to mean "production" or to authorise a feature.
 */
export const INTERNAL_AI_LAB_FLAG_ENV = "FEATURE_INTERNAL_AI_LAB_ENABLED";

export function isInternalAiLabEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return String(env[INTERNAL_AI_LAB_FLAG_ENV] ?? "").trim().toLowerCase() === "true";
}
