type ErrorAuthorityEnv = NodeJS.ProcessEnv | Record<string, string | undefined>;

const STRICT_APP_ENVS = new Set(["staging", "production"]);
const DISALLOWED_RELEASE_VALUES = new Set([
  "unknown",
  "latest",
  "none",
  "null",
  "undefined",
  "development",
  "staging",
  "production",
]);

export const ERROR_AUTHORITY_LOCAL_RELEASE = "local-unversioned";

function trimmed(value: unknown): string {
  return String(value ?? "").trim();
}

export function isStrictErrorAuthorityRuntime(env: ErrorAuthorityEnv = process.env): boolean {
  const appEnv = trimmed(env.APP_ENV ?? env.NODE_ENV).toLowerCase();
  return STRICT_APP_ENVS.has(appEnv);
}

export function isErrorAuthorityEnabled(env: ErrorAuthorityEnv = process.env): boolean {
  return trimmed(env.ERROR_AUTHORITY_ENABLED).toLowerCase() === "true";
}

export function normalizeErrorAuthorityRelease(value: unknown): string | undefined {
  const release = trimmed(value);
  return release.length > 0 ? release : undefined;
}

export function getErrorAuthorityReleaseValidationIssue(value: unknown): string | undefined {
  const release = normalizeErrorAuthorityRelease(value);
  if (!release) {
    return "required";
  }
  const lower = release.toLowerCase();
  if (DISALLOWED_RELEASE_VALUES.has(lower)) {
    return `must be a deploy-specific immutable release, not "${release}"`;
  }
  if (/^\d{10,}$/.test(release)) {
    return "must not be a timestamp-only value";
  }
  if (!/^[A-Za-z0-9._:/@+-]{7,128}$/.test(release)) {
    return "must be 7-128 chars and contain only letters, numbers, dot, underscore, colon, slash, at, plus, or hyphen";
  }
  return undefined;
}

export function getErrorAuthorityIngestTokenValidationIssue(value: unknown): string | undefined {
  const token = trimmed(value);
  if (!token) {
    return "required";
  }
  if (token.length < 32) {
    return "must be at least 32 chars";
  }
  const lower = token.toLowerCase();
  if (lower.includes("replace") || lower.includes("placeholder") || lower === "changeme" || lower === "change_me") {
    return "must not be a placeholder";
  }
  return undefined;
}

export function resolveErrorAuthorityRelease(env: ErrorAuthorityEnv = process.env): string {
  const configured = normalizeErrorAuthorityRelease(env.ERROR_AUTHORITY_RELEASE);
  const issue = getErrorAuthorityReleaseValidationIssue(configured);
  if (configured && !issue) {
    return configured;
  }

  if (isStrictErrorAuthorityRuntime(env) && isErrorAuthorityEnabled(env)) {
    throw new Error(`ERROR_AUTHORITY_RELEASE: ${issue ?? "required"} when ERROR_AUTHORITY_ENABLED=true`);
  }

  return ERROR_AUTHORITY_LOCAL_RELEASE;
}
