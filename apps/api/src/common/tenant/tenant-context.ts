import { AsyncLocalStorage } from "node:async_hooks";
import { DEFAULT_TENANT_KEY, normalizeTenantKey } from "./tenant.constants";

const tenantStorage = new AsyncLocalStorage<string>();

export function getTenantKeyFromContext(): string {
  const contextTenant = tenantStorage.getStore();
  if (contextTenant) {
    return contextTenant;
  }
  return normalizeTenantKey(process.env.PIM_DEFAULT_TENANT_KEY ?? DEFAULT_TENANT_KEY);
}

export function runWithTenantContext<T>(value: unknown, fn: () => T): T {
  const tenantKey = normalizeTenantKey(value);
  return tenantStorage.run(tenantKey, fn);
}
