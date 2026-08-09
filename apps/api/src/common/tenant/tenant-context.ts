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

/**
 * Strict variant for call sites where silently resolving to DEFAULT_TENANT_KEY
 * on missing context is itself the bug (BUG-MKT-QUEUE-002) — e.g. stamping a
 * queue payload's tenant identity. Throws instead of falling back. A real
 * tenant literally named "default" is unaffected: this checks whether a
 * context was established at all (tenantStorage.getStore() is set), not what
 * string it holds — `runWithTenantContext("default", fn)` still returns
 * "default" here without throwing.
 */
export function requireTenantKeyFromContext(): string {
  const contextTenant = tenantStorage.getStore();
  if (!contextTenant) {
    throw new Error(
      "No active tenant context. This call site requires a caller to have already established one " +
        "via runWithTenantContext(...) — silently resolving to DEFAULT_TENANT_KEY is not safe here.",
    );
  }
  return contextTenant;
}

export function runWithTenantContext<T>(value: unknown, fn: () => T): T {
  const tenantKey = normalizeTenantKey(value);
  return tenantStorage.run(tenantKey, fn);
}
