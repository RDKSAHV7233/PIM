// Test support only (excluded from the build by the *spec.ts pattern, not collected by jest because it has no `.spec.` segment).
//
// An in-memory stand-in for a PostgreSQL database with row level security, narrow on purpose: it models what the tenant-iteration
// helper and the credential-rotation sweeps depend on.
//
//  - Rows carry a tenantKey. A query on the BASE client has no tenant context, so it sees only the `default` tenant (this is exactly
//    what a restricted role does, and why an unscoped sweep silently covers one tenant).
//  - A transaction sees only the tenant most recently set with `set_config('app.tenant_key', <tenant>, true)` in that transaction.
//  - A transaction that throws is rolled back; committed transactions stay committed (per-tenant failure isolation).
//
// A test that passes against this fake with the old unscoped query would be a bug in the fake, so the specs that use it also run
// the old behaviour as a mutation and expect it to fail.

export type FakeCredentialRow = {
  id: string;
  tenantKey: string;
  encryptedValue: string;
  keyVersion: string;
  updatedAt?: Date;
};

type Where = Record<string, unknown> | undefined;

function matches(row: Record<string, unknown>, where: Where): boolean {
  if (!where) {
    return true;
  }
  for (const [key, condition] of Object.entries(where)) {
    const value = row[key];
    if (condition && typeof condition === "object" && !(condition instanceof Date)) {
      const c = condition as { gt?: unknown; not?: unknown; in?: unknown[] };
      if ("gt" in c && !((value as string) > (c.gt as string))) return false;
      if ("not" in c && value === c.not) return false;
      if ("in" in c && !(c.in ?? []).includes(value)) return false;
    } else if (value !== condition) {
      return false;
    }
  }
  return true;
}

export interface FakeRlsDb {
  rows: FakeCredentialRow[];
  directory: Array<{ tenantKey: string }>;
  /** Tenants whose transaction should throw after doing its work (to prove the rollback and the isolation). */
  failCommitFor: Set<string>;
  base: any;
  /** Every tenant context a transaction ran under, in order. */
  transactionTenants: string[];
  /** How many times the base client (no tenant context) was asked for credential rows. */
  baseCredentialReads: number;
  maxConcurrentTransactions: number;
  /** Calls to connectorCredential.findMany on any client (base or transaction). */
  findManyCalls: number;
  /** Calls to update/updateMany on any client. */
  updateCalls: number;
}

export function makeFakeRlsDb(initialRows: FakeCredentialRow[], directory: string[] = []): FakeRlsDb {
  const state: FakeRlsDb = {
    rows: initialRows.map((r) => ({ ...r })),
    directory: directory.map((tenantKey) => ({ tenantKey })),
    failCommitFor: new Set(),
    base: null,
    transactionTenants: [],
    baseCredentialReads: 0,
    maxConcurrentTransactions: 0,
    findManyCalls: 0,
    updateCalls: 0,
  };
  let inFlight = 0;

  const credentialModel = (visibleTenant: () => string, onRead?: () => void) => {
    const visible = () => state.rows.filter((r) => r.tenantKey === visibleTenant());
    return {
      findMany: jest.fn(async (args: { where?: Where; orderBy?: unknown; take?: number }) => {
        onRead?.();
        state.findManyCalls += 1;
        const rows = visible()
          .filter((r) => matches(r, args.where))
          .sort((a, b) => (a.id < b.id ? -1 : 1))
          .slice(0, args.take ?? Number.MAX_SAFE_INTEGER);
        return rows.map((r) => ({ ...r }));
      }),
      count: jest.fn(async (args: { where?: Where }) => {
        onRead?.();
        return visible().filter((r) => matches(r, args.where)).length;
      }),
      updateMany: jest.fn(async (args: { where?: Where; data: Record<string, unknown> }) => {
        state.updateCalls += 1;
        const hit = visible().filter((r) => matches(r, args.where));
        for (const row of hit) {
          Object.assign(row, args.data);
        }
        return { count: hit.length };
      }),
      update: jest.fn(async (args: { where: Where; data: Record<string, unknown> }) => {
        state.updateCalls += 1;
        const hit = visible().filter((r) => matches(r, args.where));
        if (hit.length === 0) {
          throw Object.assign(new Error("Record to update not found."), { code: "P2025" });
        }
        Object.assign(hit[0], args.data);
        return { ...hit[0] };
      }),
    };
  };

  state.base = {
    // No tenant context on the base client: it sees only the default tenant, like a restricted role with no app.tenant_key.
    connectorCredential: credentialModel(() => "default", () => {
      state.baseCredentialReads += 1;
    }),
    workspaceDirectory: { findMany: jest.fn(async () => state.directory.map((d) => ({ ...d }))) },
    $queryRaw: jest.fn(async () => []),
    $transaction: jest.fn(async (fn: (tx: any) => Promise<unknown>) => {
      const snapshot = state.rows.map((r) => ({ ...r }));
      let tenant = "default";
      let usedSetConfig = false;
      const tx: any = {
        connectorCredential: credentialModel(() => tenant),
        workspaceDirectory: state.base.workspaceDirectory,
        $queryRaw: jest.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
          if (String(strings.join("?")).includes("set_config")) {
            tenant = String(values[0]);
            usedSetConfig = true;
            state.transactionTenants.push(tenant);
          }
          return [];
        }),
      };
      inFlight += 1;
      state.maxConcurrentTransactions = Math.max(state.maxConcurrentTransactions, inFlight);
      try {
        const result = await fn(tx);
        if (usedSetConfig && state.failCommitFor.has(tenant)) {
          throw Object.assign(new Error("simulated commit failure for the tenant"), { code: "P2034" });
        }
        return result;
      } catch (error) {
        // Roll back only this tenant's rows: transactions for other tenants run concurrently and keep what they committed.
        for (const original of snapshot.filter((r) => r.tenantKey === tenant)) {
          const current = state.rows.find((r) => r.id === original.id);
          if (current) {
            Object.assign(current, original);
          }
        }
        throw error;
      } finally {
        inFlight -= 1;
      }
    }),
  };
  return state;
}
