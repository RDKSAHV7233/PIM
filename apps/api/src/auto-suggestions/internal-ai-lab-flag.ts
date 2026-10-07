/**
 * QA-AI-01 (#1236): the internal AI Lab (the legacy auto-suggestions repair path and its web page) is available only when this
 * flag is explicitly enabled. It is fail-closed: unset, empty, "false", malformed or any other value means DISABLED; only the
 * text `true` (any case, surrounding whitespace ignored) enables it.
 *
 * This is an availability control and is deliberately independent of APP_ENV. Vexa runs one deployment that serves production under
 * the environment name "Staging", so an environment name cannot be trusted to mean "production" or to authorise a feature.
 */
export const INTERNAL_AI_LAB_FLAG_ENV = "FEATURE_INTERNAL_AI_LAB_ENABLED";

export function isInternalAiLabEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return String(env[INTERNAL_AI_LAB_FLAG_ENV] ?? "").trim().toLowerCase() === "true";
}
