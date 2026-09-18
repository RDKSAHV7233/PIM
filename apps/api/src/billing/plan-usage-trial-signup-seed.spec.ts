// Regression coverage for the STARTER-vs-TRIAL signup bug: verifyPublicSignup()
// seeded a brand-new tenant's TenantPlanProfile via getTenantPlanProfile(), whose
// getOrCreateTenantPlanProfile() fallback seeds STARTER for any tenant with no
// PlanUsage history (always true for a new signup) — and createCustomerAndSubscription()
// no-ops entirely for planTier "TRIAL" (no Stripe subscription needed during a free
// trial), so nothing ever corrected the STARTER seed. Per docs/product/commercial-policy.md,
// self-serve signups are contractually entitled to Trial limits (500 SKUs/3 users/2GB/
// 90 days), not Starter's (2,500 SKUs/5 users/15GB) — every new signup silently got 5x
// the promised trial allowance for the full 90-day period.
//
// initializeTrialPlanProfile() is the fix: an explicit, idempotent TRIAL-tier seed
// scoped to the public signup path only, called instead of getTenantPlanProfile() from
// signup.service.ts's runSignupBillingProvision(). getOrCreateTenantPlanProfile()'s own
// STARTER fallback is deliberately left untouched — other tenant-provisioning paths and
// existing test harnesses depend on it.
import { PlanUsageService } from "./plan-usage.service";

function makeService(existingProfileRow: Record<string, unknown>) {
  // getOrCreateTenantPlanProfile's first $queryRaw call looks up the TenantPlanProfile
  // row by tenantKey. Every test here models the row already existing by the time
  // initializeTrialPlanProfile() re-reads it — i.e. its own $executeRaw INSERT already
  // "landed" (stubbed, not a real DB) — so that lookup finds it immediately and never
  // falls through to the latest-PlanUsage fallback path (already covered by
  // plan-usage-resource-limits.spec.ts's tests of getOrCreateTenantPlanProfile itself).
  const queryRawMock = jest.fn().mockResolvedValue([existingProfileRow]);
  const executeRawMock = jest.fn().mockResolvedValue(undefined);
  const tenantClient = { $executeRaw: executeRawMock, $queryRaw: queryRawMock };
  const prisma = { tenant: jest.fn().mockReturnValue(tenantClient) };
  const cache = { getOrSet: jest.fn(), invalidate: jest.fn().mockResolvedValue(undefined) };
  const service = new PlanUsageService(prisma as never, {} as never, cache as never);
  return { service, executeRawMock, queryRawMock, cache };
}

describe("PlanUsageService.initializeTrialPlanProfile — signup TRIAL seed (no prior coverage)", () => {
  it("inserts a TRIAL-tier profile with ON CONFLICT DO NOTHING, for idempotency", async () => {
    const { service, executeRawMock } = makeService({
      tenantKey: "acme",
      planTier: "TRIAL",
      billingStatus: "trial",
      accessStatus: "active",
      effectiveFrom: new Date(),
      trialEndsAt: new Date(),
      paidThroughAt: null,
      graceEndsAt: null,
      cancelledAt: null,
      suspendedAt: null,
      suspensionReason: null,
      billingContactEmail: null,
      updatedBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await service.initializeTrialPlanProfile("acme");

    expect(executeRawMock).toHaveBeenCalledTimes(1);
    const insertSql = String(executeRawMock.mock.calls[0][0]?.sql ?? "");
    expect(insertSql).toContain('INSERT INTO "TenantPlanProfile"');
    expect(insertSql).toContain("ON CONFLICT");
    expect(insertSql).toContain("DO NOTHING");
    // 'TRIAL'/'trial'/'active' are literal SQL constants in the query text, not ${}
    // interpolations, so they show up in the SQL string itself, not in .values.
    expect(insertSql).toContain("'TRIAL'");
    expect(insertSql).toContain("'trial'");
    const values: unknown[] = executeRawMock.mock.calls[0][0]?.values ?? [];
    expect(values).toContain("acme");
  });

  it("returns TRIAL as the resolved plan tier after seeding a brand-new tenant", async () => {
    const { service } = makeService({
      tenantKey: "newco",
      planTier: "TRIAL",
      billingStatus: "trial",
      accessStatus: "active",
      effectiveFrom: new Date(),
      trialEndsAt: new Date(),
      paidThroughAt: null,
      graceEndsAt: null,
      cancelledAt: null,
      suspendedAt: null,
      suspensionReason: null,
      billingContactEmail: null,
      updatedBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await service.initializeTrialPlanProfile("newco");

    expect(result.planTier).toBe("TRIAL");
    expect(result.billingStatus).toBe("trial");
  });

  it("invalidates the cached plan-profile entry so a subsequent read never returns a stale value", async () => {
    const { service, cache } = makeService({
      tenantKey: "acme",
      planTier: "TRIAL",
      billingStatus: "trial",
      accessStatus: "active",
      effectiveFrom: new Date(),
      trialEndsAt: new Date(),
      paidThroughAt: null,
      graceEndsAt: null,
      cancelledAt: null,
      suspendedAt: null,
      suspensionReason: null,
      billingContactEmail: null,
      updatedBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await service.initializeTrialPlanProfile("acme");

    expect(cache.invalidate).toHaveBeenCalledWith("plan:profile:acme");
  });

  it("normalizes the tenant key the same way every other tenant-scoped call in this service does", async () => {
    const { service, executeRawMock } = makeService({
      tenantKey: "acme",
      planTier: "TRIAL",
      billingStatus: "trial",
      accessStatus: "active",
      effectiveFrom: new Date(),
      trialEndsAt: new Date(),
      paidThroughAt: null,
      graceEndsAt: null,
      cancelledAt: null,
      suspendedAt: null,
      suspensionReason: null,
      billingContactEmail: null,
      updatedBy: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await service.initializeTrialPlanProfile("  acme  ");

    const values: unknown[] = executeRawMock.mock.calls[0][0]?.values ?? [];
    expect(values).toContain("acme");
    expect(values).not.toContain("  acme  ");
  });
});
