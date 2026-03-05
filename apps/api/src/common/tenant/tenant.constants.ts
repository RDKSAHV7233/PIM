const envDefaultTenantKey = process.env.PIM_DEFAULT_TENANT_KEY?.trim();
export const DEFAULT_TENANT_KEY =
  envDefaultTenantKey && envDefaultTenantKey.length > 0 ? envDefaultTenantKey : "default";
export const TENANT_HEADER = "x-pim-tenant";

export function normalizeTenantKey(value: unknown): string {
  if (typeof value !== "string") {
    return DEFAULT_TENANT_KEY;
  }
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : DEFAULT_TENANT_KEY;
}
