type VnextMutationEnv = NodeJS.ProcessEnv | Record<string, unknown>;

export interface VnextMutationAllowlistEntry {
  tenantKey: string;
  connectorSlug: string;
  installationId: string;
  productId: string;
}

export type VnextMutationFieldClass = "image";

const ALLOWLIST_FIELDS = ["tenantKey", "connectorSlug", "installationId", "productId"] as const;
const ALLOWED_FIELD_CLASSES = new Set<VnextMutationFieldClass>(["image"]);
const SHA_PATTERN = /^[A-Fa-f0-9]{7,64}$/;

function trimmed(value: unknown): string {
  return String(value ?? "").trim();
}

function parseAllowlist(raw: unknown): VnextMutationAllowlistEntry | undefined {
  const text = trimmed(raw);
  if (!text) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }

  const entries = Array.isArray(parsed) ? parsed : [parsed];
  if (entries.length !== 1) {
    return undefined;
  }

  const entry = entries[0];
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
    return undefined;
  }

  const record = entry as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const expectedKeys = [...ALLOWLIST_FIELDS].sort();
  if (keys.length !== expectedKeys.length || keys.some((key, index) => key !== expectedKeys[index])) {
    return undefined;
  }

  const allowlistEntry = {} as VnextMutationAllowlistEntry;
  for (const field of ALLOWLIST_FIELDS) {
    const value = record[field];
    if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
      return undefined;
    }
    allowlistEntry[field] = value;
  }

  return allowlistEntry;
}

export function isVnextMutationEnabled(env: VnextMutationEnv = process.env): boolean {
  return trimmed(env.VNEXT_MUTATION_ENABLED).toLowerCase() === "true";
}

export function getVnextMutationAllowlistValidationIssue(raw: unknown): string | undefined {
  if (!trimmed(raw)) {
    return "required when VNEXT_MUTATION_ENABLED=true";
  }
  if (!parseAllowlist(raw)) {
    return "must be a JSON object, or single-entry array, with exactly tenantKey, connectorSlug, installationId, and productId string fields";
  }
  return undefined;
}

export function getVnextMutationApprovedReleaseValidationIssue(raw: unknown): string | undefined {
  const releaseSha = trimmed(raw);
  if (!releaseSha) {
    return "required when VNEXT_MUTATION_ENABLED=true";
  }
  if (!SHA_PATTERN.test(releaseSha)) {
    return "must be a 7-64 character git commit SHA";
  }
  return undefined;
}

export function getVnextMutationAllowedFieldClassValidationIssue(raw: unknown): string | undefined {
  const fieldClass = trimmed(raw);
  if (!fieldClass) {
    return "required when VNEXT_MUTATION_ENABLED=true";
  }
  if (!ALLOWED_FIELD_CLASSES.has(fieldClass as VnextMutationFieldClass)) {
    return "must be one of: image";
  }
  return undefined;
}

export function getVnextMutationValidationIssues(env: VnextMutationEnv = process.env): string[] {
  if (!isVnextMutationEnabled(env)) {
    return [];
  }

  const issues: string[] = [];
  const allowlistIssue = getVnextMutationAllowlistValidationIssue(env.VNEXT_MUTATION_ALLOWLIST_JSON);
  if (allowlistIssue) {
    issues.push(`VNEXT_MUTATION_ALLOWLIST_JSON: ${allowlistIssue}`);
  }

  const releaseIssue = getVnextMutationApprovedReleaseValidationIssue(env.VNEXT_MUTATION_APPROVED_RELEASE_SHA);
  if (releaseIssue) {
    issues.push(`VNEXT_MUTATION_APPROVED_RELEASE_SHA: ${releaseIssue}`);
  }

  const fieldClassIssue = getVnextMutationAllowedFieldClassValidationIssue(env.VNEXT_MUTATION_ALLOWED_FIELD_CLASS);
  if (fieldClassIssue) {
    issues.push(`VNEXT_MUTATION_ALLOWED_FIELD_CLASS: ${fieldClassIssue}`);
  }

  return issues;
}

export function isMutationAllowedFor(
  tenantKey: string,
  connectorSlug: string,
  installationId: string,
  productId: string,
  env: VnextMutationEnv = process.env,
): boolean {
  if (!isVnextMutationEnabled(env)) {
    return false;
  }

  const allowlist = parseAllowlist(env.VNEXT_MUTATION_ALLOWLIST_JSON);
  return Boolean(
    allowlist &&
      allowlist.tenantKey === tenantKey &&
      allowlist.connectorSlug === connectorSlug &&
      allowlist.installationId === installationId &&
      allowlist.productId === productId,
  );
}

export function isApprovedRelease(env: VnextMutationEnv = process.env): boolean {
  const approvedRelease = trimmed(env.VNEXT_MUTATION_APPROVED_RELEASE_SHA);
  const liveRelease = trimmed(env.RAILWAY_GIT_COMMIT_SHA);
  return Boolean(approvedRelease && liveRelease && approvedRelease === liveRelease);
}

export function getVnextMutationAllowedFieldClass(
  env: VnextMutationEnv = process.env,
): VnextMutationFieldClass | undefined {
  const fieldClass = trimmed(env.VNEXT_MUTATION_ALLOWED_FIELD_CLASS);
  return ALLOWED_FIELD_CLASSES.has(fieldClass as VnextMutationFieldClass)
    ? fieldClass as VnextMutationFieldClass
    : undefined;
}

export function isVnextMutationFieldClassAllowed(
  fieldClass: VnextMutationFieldClass,
  env: VnextMutationEnv = process.env,
): boolean {
  return getVnextMutationAllowedFieldClass(env) === fieldClass;
}
