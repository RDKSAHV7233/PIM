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
