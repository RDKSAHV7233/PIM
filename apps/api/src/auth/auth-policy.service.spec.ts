import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { AuthPolicyService } from "./auth-policy.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuditService } from "../audit/audit.service";
import type { PlanUsageService } from "../billing/plan-usage.service";

const PERSISTED_POLICY = {
  id: "policy-1",
  tenantKey: "acme",
  externalIdentityMode: false,
  mfaRequired: false,
  mfaGracePeriodDays: 7,
  sessionTimeoutMinutes: 240,
  allowedAuthMethods: ["password"],
  createdBy: "admin@acme",
  updatedBy: "admin@acme",
  createdAt: new Date(),
  updatedAt: new Date(),
};

function makeService(planTier: string) {
  const tenantAuthPolicy = {
    findUnique: jest.fn().mockResolvedValue(null),
    upsert: jest.fn().mockResolvedValue(PERSISTED_POLICY),
  };
  const prisma = {
    tenant: jest.fn().mockReturnValue({ tenantAuthPolicy }),
  } as unknown as PrismaService;

  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;

  const planUsage = {
    getTenantPlanTier: jest.fn().mockResolvedValue(planTier),
  } as unknown as PlanUsageService;

  const service = new AuthPolicyService(prisma, audit, planUsage);
  return { service, prisma, audit, planUsage, tenantAuthPolicy };
}

describe("AuthPolicyService.updatePolicy — plan-tier write guard", () => {
  const ORIGINAL_AUTH_MODE = process.env.AUTH_MODE;
  beforeEach(() => { process.env.AUTH_MODE = "db"; });
  afterEach(() => { process.env.AUTH_MODE = ORIGINAL_AUTH_MODE; });

  it("TRIAL → throws PLAN_UPGRADE_REQUIRED before touching Prisma", async () => {
    const { service, tenantAuthPolicy } = makeService("TRIAL");
    await expect(
      service.updatePolicy("acme", "actor-1", "admin", { sessionTimeoutMinutes: 60 }),
    ).rejects.toMatchObject({ response: { error: "PLAN_UPGRADE_REQUIRED" } });
    await expect(
      service.updatePolicy("acme", "actor-1", "admin", { sessionTimeoutMinutes: 60 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tenantAuthPolicy.upsert).not.toHaveBeenCalled();
  });

  it("STARTER → throws PLAN_UPGRADE_REQUIRED before touching Prisma", async () => {
    const { service, tenantAuthPolicy } = makeService("STARTER");
    await expect(
      service.updatePolicy("acme", "actor-1", "admin", { sessionTimeoutMinutes: 60 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(tenantAuthPolicy.upsert).not.toHaveBeenCalled();
  });

  it("GROWTH + sessionTimeoutMinutes only → persists successfully", async () => {
    const { service, tenantAuthPolicy } = makeService("GROWTH");
    const result = await service.updatePolicy("acme", "actor-1", "admin", {
      sessionTimeoutMinutes: 60,
    });
    expect(tenantAuthPolicy.upsert).toHaveBeenCalledTimes(1);
    expect(result).toBeDefined();
  });

  it("GROWTH + mfaRequired → throws PLAN_UPGRADE_REQUIRED (enterprise-only field)", async () => {
    const { service, tenantAuthPolicy } = makeService("GROWTH");
    await expect(
      service.updatePolicy("acme", "actor-1", "admin", { mfaRequired: true }),
    ).rejects.toMatchObject({
      response: { error: "PLAN_UPGRADE_REQUIRED" },
    });
    expect(tenantAuthPolicy.upsert).not.toHaveBeenCalled();
  });

  it("GROWTH + externalIdentityMode → throws PLAN_UPGRADE_REQUIRED (enterprise-only field)", async () => {
    const { service } = makeService("GROWTH");
    await expect(
      service.updatePolicy("acme", "actor-1", "admin", { externalIdentityMode: true }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("GROWTH + allowedAuthMethods → throws PLAN_UPGRADE_REQUIRED (enterprise-only field)", async () => {
    const { service } = makeService("GROWTH");
    await expect(
      service.updatePolicy("acme", "actor-1", "admin", { allowedAuthMethods: ["oidc"] }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("ENTERPRISE → allows all fields including externalIdentityMode and mfaRequired", async () => {
    const { service, tenantAuthPolicy } = makeService("ENTERPRISE");
    const result = await service.updatePolicy("acme", "actor-1", "admin", {
      mfaRequired: true,
      externalIdentityMode: true,
      mfaGracePeriodDays: 3,
      sessionTimeoutMinutes: 30,
      allowedAuthMethods: ["oidc"],
    });
    expect(tenantAuthPolicy.upsert).toHaveBeenCalledTimes(1);
    expect(result).toBeDefined();
  });

  it("no fields in dto → throws NO_AUTH_POLICY_CHANGES regardless of plan", async () => {
    const { service } = makeService("ENTERPRISE");
    await expect(
      service.updatePolicy("acme", "actor-1", "admin", {}),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

// mfaRequiredSince anchors the grace-period rollout window to the actual
// false->true transition, not TenantAuthPolicy's own updatedAt (which also
// moves on unrelated field edits and would incorrectly restart the window).
describe("AuthPolicyService.updatePolicy — mfaRequiredSince rollout-window tracking", () => {
  const ORIGINAL_AUTH_MODE = process.env.AUTH_MODE;
  beforeEach(() => { process.env.AUTH_MODE = "db"; });
  afterEach(() => { process.env.AUTH_MODE = ORIGINAL_AUTH_MODE; });

  function makeDynamicService(currentRow: Record<string, unknown> | null) {
    const upsert = jest.fn(({ create, update }: { create: Record<string, unknown>; update: Record<string, unknown> }) =>
      Promise.resolve({ ...PERSISTED_POLICY, ...(currentRow ? update : create) }),
    );
    const tenantAuthPolicy = {
      findUnique: jest.fn().mockResolvedValue(currentRow),
      upsert,
    };
    const prisma = { tenant: jest.fn().mockReturnValue({ tenantAuthPolicy }) } as unknown as PrismaService;
    const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    const planUsage = { getTenantPlanTier: jest.fn().mockResolvedValue("ENTERPRISE") } as unknown as PlanUsageService;
    const service = new AuthPolicyService(prisma, audit, planUsage);
    return { service, upsert };
  }

  it("false -> true sets mfaRequiredSince to now", async () => {
    const { service, upsert } = makeDynamicService({ ...PERSISTED_POLICY, mfaRequired: false, mfaRequiredSince: null });
    const before = Date.now();

    await service.updatePolicy("acme", "actor-1", "admin", { mfaRequired: true });

    const [{ update }] = upsert.mock.calls[0] as unknown as [{ update: { mfaRequiredSince: Date } }];
    expect(update.mfaRequiredSince).toBeInstanceOf(Date);
    expect(update.mfaRequiredSince.getTime()).toBeGreaterThanOrEqual(before);
  });

  it("stays true across an unrelated field edit -> mfaRequiredSince is preserved, not bumped", async () => {
    const anchor = new Date("2026-01-01T00:00:00.000Z");
    const { service, upsert } = makeDynamicService({ ...PERSISTED_POLICY, mfaRequired: true, mfaRequiredSince: anchor });

    await service.updatePolicy("acme", "actor-1", "admin", { sessionTimeoutMinutes: 30 });

    const [{ update }] = upsert.mock.calls[0] as unknown as [{ update: { mfaRequiredSince: Date | null } }];
    expect(update.mfaRequiredSince).toEqual(anchor);
  });

  it("true -> false clears mfaRequiredSince", async () => {
    const { service, upsert } = makeDynamicService({
      ...PERSISTED_POLICY,
      mfaRequired: true,
      mfaRequiredSince: new Date("2026-01-01T00:00:00.000Z"),
    });

    await service.updatePolicy("acme", "actor-1", "admin", { mfaRequired: false });

    const [{ update }] = upsert.mock.calls[0] as unknown as [{ update: { mfaRequiredSince: Date | null } }];
    expect(update.mfaRequiredSince).toBeNull();
  });

  it("re-enabling after being off starts a fresh window, not the stale one", async () => {
    const staleAnchor = new Date("2020-01-01T00:00:00.000Z");
    const { service, upsert } = makeDynamicService({
      ...PERSISTED_POLICY,
      mfaRequired: false,
      mfaRequiredSince: staleAnchor, // shouldn't happen in practice (should've been cleared), but defend anyway
    });

    await service.updatePolicy("acme", "actor-1", "admin", { mfaRequired: true });

    const [{ update }] = upsert.mock.calls[0] as unknown as [{ update: { mfaRequiredSince: Date } }];
    expect(update.mfaRequiredSince.getTime()).toBeGreaterThan(staleAnchor.getTime());
  });
});

describe("AuthPolicyService.isWithinMfaGracePeriod", () => {
  it("null mfaRequiredSince -> false (no grace, matches pre-feature behavior)", () => {
    const service = new AuthPolicyService({} as never, {} as never, {} as never);
    expect(service.isWithinMfaGracePeriod({ mfaRequiredSince: null, mfaGracePeriodDays: 7 })).toBe(false);
  });

  it("now before mfaRequiredSince + graceDays -> true", () => {
    const service = new AuthPolicyService({} as never, {} as never, {} as never);
    const since = new Date("2026-01-01T00:00:00.000Z");
    const now = new Date("2026-01-05T00:00:00.000Z"); // 4 days in, 7-day grace
    expect(service.isWithinMfaGracePeriod({ mfaRequiredSince: since, mfaGracePeriodDays: 7 }, now)).toBe(true);
  });

  it("now at/after mfaRequiredSince + graceDays -> false", () => {
    const service = new AuthPolicyService({} as never, {} as never, {} as never);
    const since = new Date("2026-01-01T00:00:00.000Z");
    const now = new Date("2026-01-09T00:00:00.000Z"); // 8 days in, 7-day grace — expired
    expect(service.isWithinMfaGracePeriod({ mfaRequiredSince: since, mfaGracePeriodDays: 7 }, now)).toBe(false);
  });
});
