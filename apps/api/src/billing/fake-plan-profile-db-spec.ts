// Test support only (excluded from the build by the *spec.ts pattern; not collected by jest because it has no `.spec.` segment).
//
// An in-memory stand-in for the TenantPlanProfile table with the two behaviours that decide whether a cross-tenant job works:
//
//  - "restricted": row level security is enforced. A query sees only the tenant whose context is set. On the BASE client the context
//    is the default tenant, exactly like a restricted role with no app.tenant_key, so an unscoped scan sees ONE tenant.
//  - "superuser": row level security is bypassed, as the production runtime role does today. A query sees every row unless its own
//    SQL filters by tenant. An unscoped per-tenant scan therefore returns everyone's rows in every iteration (the duplicate trap).
//
// Only the two discovery queries of the billing jobs are interpreted (trial-ending window, expired grace period), by the bound
// parameters and the column names in the SQL, which is enough to exercise discovery honestly without a SQL engine.

export type ProfileRow = {
  tenantKey: string;
  billingStatus: string;
  accessStatus: string;
  trialEndsAt?: Date | null;
  graceEndsAt?: Date | null;
  billingContactEmail?: string | null;
};

export interface FakeProfileDb {
  rows: ProfileRow[];
  base: any;
  /** Tenants whose transaction should fail (to prove an unreadable tenant is reported, never skipped silently). */
  failTenants: Set<string>;
  baseQueries: number;
  transactionTenants: string[];
}

export function makeFakeProfileDb(rows: ProfileRow[], directory: string[], mode: "restricted" | "superuser"): FakeProfileDb {
  const state: FakeProfileDb = { rows: rows.map((r) => ({ ...r })), base: null, failTenants: new Set(), baseQueries: 0, transactionTenants: [] };

  const evaluate = (sql: { sql: string; values: unknown[] }, contextTenant: string): Array<Record<string, unknown>> => {
    const text = String(sql.sql);
    const values = sql.values ?? [];
    let visible = mode === "restricted" ? state.rows.filter((r) => r.tenantKey === contextTenant) : [...state.rows];
    // Prisma.sql exposes `.sql` with `?` placeholders and `.text` with `$1`; accept either.
    const filtersByTenant = /"tenantKey"\s*=\s*(\$\d|\?)/.test(text);
    if (filtersByTenant) {
      visible = visible.filter((r) => r.tenantKey === values[0]);
    }
    const dates = values.filter((v): v is Date => v instanceof Date);
    if (text.includes('"trialEndsAt"')) {
      const [now, windowEnd] = dates;
      return visible
        .filter((r) => r.billingStatus === "trial" && r.accessStatus === "active" && r.trialEndsAt && r.trialEndsAt > now && r.trialEndsAt <= windowEnd)
        .map((r) => ({ tenantKey: r.tenantKey, trialEndsAt: r.trialEndsAt, billingContactEmail: r.billingContactEmail ?? null }));
    }
    if (text.includes('"graceEndsAt"')) {
      const [now] = dates;
      return visible
        .filter((r) => r.billingStatus === "past_due" && r.accessStatus === "active" && r.graceEndsAt && r.graceEndsAt < now)
        .map((r) => ({ tenantKey: r.tenantKey, graceEndsAt: r.graceEndsAt, billingContactEmail: r.billingContactEmail ?? null }));
    }
    throw new Error("the fake does not interpret this query");
  };

  state.base = {
    workspaceDirectory: { findMany: jest.fn(async () => directory.map((tenantKey) => ({ tenantKey }))) },
    $queryRaw: jest.fn(async (sql: { sql: string; values: unknown[] }) => {
      state.baseQueries += 1;
      return evaluate(sql, "default");
    }),
    $transaction: jest.fn(async (fn: (tx: any) => Promise<unknown>) => {
      let tenant = "default";
      const tx: any = {
        $queryRaw: jest.fn(async (first: any, ...rest: unknown[]) => {
          // forEachTenant sets the tenant with a tagged template; the job's discovery passes a Prisma.sql object.
          if (Array.isArray(first) && String(first.join("?")).includes("set_config")) {
            tenant = String(rest[0]);
            state.transactionTenants.push(tenant);
            if (state.failTenants.has(tenant)) {
              throw Object.assign(new Error("simulated failure reading this tenant"), { code: "P2034" });
            }
            return [];
          }
          return evaluate(first, tenant);
        }),
      };
      return fn(tx);
    }),
  };
  return state;
}
