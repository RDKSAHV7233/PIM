const envDefaultTenantKey = process.env.PIM_DEFAULT_TENANT_KEY?.trim();
export const DEFAULT_TENANT_KEY =
  envDefaultTenantKey && envDefaultTenantKey.length > 0 ? envDefaultTenantKey : "default";
const envDefaultWorkspaceSlug = process.env.PIM_DEFAULT_WORKSPACE_SLUG?.trim().toLowerCase();
export const DEFAULT_WORKSPACE_SLUG =
  envDefaultWorkspaceSlug && envDefaultWorkspaceSlug.length > 0 ? envDefaultWorkspaceSlug : "default";
export const TENANT_HEADER = "x-pim-tenant";

export function normalizeTenantKey(value: unknown): string {
  if (typeof value !== "string") {
    return DEFAULT_TENANT_KEY;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : DEFAULT_TENANT_KEY;
}

export function normalizeWorkspaceSlug(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

export function isValidWorkspaceSlug(value: unknown): boolean {
  const normalized = normalizeWorkspaceSlug(value);
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(normalized) && normalized.length >= 3 && normalized.length <= 32;
}
