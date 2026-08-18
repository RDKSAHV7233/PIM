// Regression tests for PIM#614: the SKU usage/billing count (`recomputeUsage`'s
// `variant.count()`) had no lifecycle filter at all — every Variant row counted
// toward a tenant's "SKUs used," regardless of status (draft/in_review/rejected/
// archived all counted the same as active) and regardless of whether the parent
// Product was itself unpublished or soft-deleted.
//
// PO/CTO/Pricing decision (issue #614): a SKU is billable iff ALL of:
//   - Variant.status is approved or active
//   - parent Product.status is approved or active
//   - parent Product.deletedAt is null
// This is a Vexa catalog-lifecycle predicate, deliberately independent of any
// connector's publish/sync state.
//
// All database calls are stubbed so these run in-process with no DB dependency,
// matching this file's sibling specs (see plan-usage-resource-limits.spec.ts).
import { PlanUsageService } from "./plan-usage.service";

// A minimal evaluator for exactly the where-clause shapes SELLABLE_VARIANT_WHERE uses
// ({ in: [...] } value matchers, plain equality, one level of nested `product` relation
// matching). Not a general Prisma interpreter — narrow on purpose, so it stays trustworthy
// by inspection. Evaluating the *actual* captured where-object (not a hand-copied rule) is
// what makes the matrix below a real test of the shipped predicate, not of a duplicate of it.
function matchesWhere(record: { status: string; product: { status: string; deletedAt: string | null } }, where: unknown): boolean {
  const w = where as {
    status?: { in?: string[] };
    product?: { deletedAt?: null; status?: { in?: string[] } };
  };
  if (w.status?.in && !w.status.in.includes(record.status)) return false;
  if (w.product) {
    if ("deletedAt" in w.product && w.product.deletedAt === null && record.product.deletedAt !== null) return false;
    if (w.product.status?.in && !w.product.status.in.includes(record.product.status)) return false;
  }
  return true;
}

function makeVariant(status: string, productStatus: string, productDeletedAt: string | null = null) {
  return { status, product: { status: productStatus, deletedAt: productDeletedAt } };
}

// Builds a PlanUsageService whose only real "database" is the in-memory `variants` array —
// variant.count() actually filters that array by whatever where-clause the real source code
// passes it, so the returned count reflects the real shipped predicate, not a stand-in value.
function makeServiceWithVariants(variants: ReturnType<typeof makeVariant>[], tenantKey = "acme") {
  let capturedWhere: unknown = null;
  let capturedTenantKeyForVariant: string | null = null;
  let lastComputedSkuCount = 0;

  const variantModel = {
    count: jest.fn((args: { where?: unknown }) => {
      capturedWhere = args?.where;
      const matching = variants.filter((v) => matchesWhere(v, args?.where));
      lastComputedSkuCount = matching.length;
      return Promise.resolve(matching.length);
    }),
  };
  const marketplaceExportJob = { count: jest.fn().mockResolvedValue(0) };
  const tenantClientFactory = jest.fn((key: string) => {
    capturedTenantKeyForVariant = key;
    return {
      variant: variantModel,
      marketplaceExportJob,
      $queryRaw: jest.fn().mockResolvedValue([{ bytes: 0 }]),
      $executeRaw: jest.fn().mockResolvedValue(undefined),
    };
  });
  const prisma = { tenant: tenantClientFactory };
  const cache = { getOrSet: jest.fn() };

  const service = new PlanUsageService(prisma as never, {} as never, cache as never);
  jest.spyOn(service as never, "getOrCreateTenantPlanProfile").mockResolvedValue({
    tenantKey,
    planTier: "GROWTH",
    billingStatus: "active_paid",
    accessStatus: "active",
    effectiveFrom: null,
    trialEndsAt: null,
    paidThroughAt: null,
    billingContactEmail: null,
    updatedBy: null,
  } as never);
  // recomputeUsage upserts via $executeRaw (stubbed above) then re-reads the row via the
  // private getUsageRow() — stub that read to return whatever variant.count() just computed,
  // so `usage.skuCount` in these tests reflects the real filtered count, not a fixture value.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- spying on a private method
  // needs a looser cast than `never` here: `never` makes TS infer the mock implementation's
  // signature as `(...args: never) => never`, which no real async function can satisfy.
  jest.spyOn(service as any, "getUsageRow").mockImplementation(async () => ({
    tenantKey,
    month: "2026-08",
    planTier: "GROWTH",
    skuCount: lastComputedSkuCount,
    submissionCount: 0,
    storageGb: 0,
    connectorInstallationsCount: 0,
    connectorAccountsCount: 0,
    updatedAt: new Date(),
  }));

  return {
    service,
    variantModel,
    tenantClientFactory,
    getCapturedWhere: () => capturedWhere,
    getCapturedTenantKey: () => capturedTenantKeyForVariant,
  };
}

describe("PIM#614 — recomputeUsage's variant count uses the sellable-SKU predicate", () => {
  it("wires the predicate into the real Prisma call, on the tenant-scoped client", async () => {
    const { variantModel, getCapturedTenantKey, service } = makeServiceWithVariants([], "acme-tenant");
    await service.recomputeUsage("acme-tenant", { month: "2026-08" });

    expect(variantModel.count).toHaveBeenCalledTimes(1);
    const args = variantModel.count.mock.calls[0][0] as { where: { status: { in: string[] }; product: { deletedAt: null; status: { in: string[] } } } };
    expect(args.where).toBeDefined();
    expect(args.where.status).toEqual({ in: expect.arrayContaining(["approved", "active"]) });
    expect(args.where.status.in).toHaveLength(2);
    expect(args.where.product).toEqual({
      deletedAt: null,
      status: { in: expect.arrayContaining(["approved", "active"]) },
    });
    // Tenant isolation: the filtered count() call must run on the SAME already
    // tenant-scoped client (this.prisma.tenant(tenantKey)), not some unscoped client —
    // the new where clause must be additive to existing tenant scoping, not a bypass of it.
    expect(getCapturedTenantKey()).toBe("acme-tenant");
  });

  // --- Full matrix from the fix discussion ---
  const matrix: Array<[string, string, string, string | null, boolean]> = [
    ["draft variant, draft parent", "draft", "draft", null, false],
    ["in_review variant, in_review parent", "in_review", "in_review", null, false],
    ["rejected variant, rejected parent", "rejected", "rejected", null, false],
    ["archived variant, archived parent", "archived", "archived", null, false],
    ["approved variant, approved parent", "approved", "approved", null, true],
    ["active variant, active parent", "active", "active", null, true],
    ["approved variant, active parent (domain-valid combo)", "approved", "active", null, true],
    ["active variant, approved parent (domain-valid combo)", "active", "approved", null, true],
    ["active variant, active parent, but parent soft-deleted", "active", "active", "2026-08-19T00:00:00.000Z", false],
    ["approved variant, archived parent", "approved", "archived", null, false],
    ["archived variant, active parent", "archived", "active", null, false],
  ];

  it.each(matrix)("%s -> countsTowardUsage=%s", async (_label, variantStatus, productStatus, productDeletedAt, expected) => {
    const { service, getCapturedWhere } = makeServiceWithVariants(
      [makeVariant(variantStatus, productStatus, productDeletedAt)],
      "acme",
    );
    const usage = await service.recomputeUsage("acme", { month: "2026-08" });
    expect(usage.skuCount).toBe(expected ? 1 : 0);
    // Cross-check: the captured where-clause, evaluated against this exact record, agrees.
    expect(matchesWhere(makeVariant(variantStatus, productStatus, productDeletedAt), getCapturedWhere())).toBe(expected);
  });

  it("critical billing test: 7 real variant rows, only 3 are billable SKUs — not 7", async () => {
    const variants = [
      makeVariant("draft", "draft"),
      makeVariant("draft", "draft"),
      makeVariant("approved", "approved"),
      makeVariant("approved", "approved"),
      makeVariant("active", "active"),
      makeVariant("archived", "archived"),
      makeVariant("active", "active", "2026-08-19T00:00:00.000Z"), // active variant, soft-deleted parent
    ];
    const { service } = makeServiceWithVariants(variants, "acme");
    const usage = await service.recomputeUsage("acme", { month: "2026-08" });
    expect(usage.skuCount).toBe(3);
  });

  it("tenant isolation: two tenants' variant.count() calls are scoped to their own tenant client", async () => {
    const acme = makeServiceWithVariants([makeVariant("active", "active")], "acme");
    const globex = makeServiceWithVariants([makeVariant("active", "active"), makeVariant("active", "active")], "globex");

    await acme.service.recomputeUsage("acme", { month: "2026-08" });
    await globex.service.recomputeUsage("globex", { month: "2026-08" });

    expect(acme.getCapturedTenantKey()).toBe("acme");
    expect(globex.getCapturedTenantKey()).toBe("globex");
    // Each service instance only ever saw its own tenant's fixture data — the sellable-SKU
    // predicate is applied on top of tenant scoping, never as a substitute for it.
    expect(acme.variantModel.count).toHaveBeenCalledTimes(1);
    expect(globex.variantModel.count).toHaveBeenCalledTimes(1);
  });
});
