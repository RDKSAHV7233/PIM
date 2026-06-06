// Tier-gate coverage for workspace user role assignment.
//
// These tests guard the new ROLE_NOT_AVAILABLE_IN_PLAN error path added in
// workspace-users.service.ts. They use plain object stubs (no test framework
// mocks of the deep Prisma surface) so that the spec stays readable and
// resilient to unrelated Prisma schema churn.

import { BadRequestException } from "@nestjs/common";
import { WorkspaceUsersService } from "./workspace-users.service";
import type { PrismaService } from "../prisma/prisma.service";
import type { AuditService } from "../audit/audit.service";
import type { PlanUsageService } from "../billing/plan-usage.service";

function makeStubs(planTier: "STARTER" | "GROWTH" | "ENTERPRISE") {
  const authIdentity = {
    findFirst: jest.fn().mockResolvedValue(null),
    create: jest.fn().mockResolvedValue({
      id: "row-id",
      userId: "new@tenant",
      role: "editor",
      assignedRoles: [],
      isActive: true,
      lockedUntil: null,
      lastSignInAt: null,
      createdBy: "actor@tenant",
      createdAt: new Date(),
      updatedAt: new Date(),
    }),
    update: jest.fn(),
  };
  const tenantClient = {
    authIdentity,
    userMfaEnrollment: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const prisma = {
    tenant: jest.fn().mockReturnValue(tenantClient),
  } as unknown as PrismaService;

  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;

  const planUsage = {
    getTenantPlanTier: jest.fn().mockResolvedValue(planTier),
    checkLimit: jest.fn().mockResolvedValue({ allowed: true, limit: 999, current: 0 }),
  } as unknown as PlanUsageService;

  return { prisma, audit, planUsage, authIdentity };
}

async function expectRoleRejected(promise: Promise<unknown>, expectedRole: string, expectedTier: string) {
  await expect(promise).rejects.toMatchObject({
    response: {
      error: "ROLE_NOT_AVAILABLE_IN_PLAN",
      role: expectedRole,
      planTier: expectedTier,
    },
  });
  await expect(promise).rejects.toBeInstanceOf(BadRequestException);
}

describe("WorkspaceUsersService — plan-tier role gating", () => {
  const ORIGINAL_AUTH_MODE = process.env.AUTH_MODE;

  beforeEach(() => {
    process.env.AUTH_MODE = "memory";
  });

  afterEach(() => {
    process.env.AUTH_MODE = ORIGINAL_AUTH_MODE;
  });

  it("STARTER + createUser(role=approver) → throws ROLE_NOT_AVAILABLE_IN_PLAN", async () => {
    const { prisma, audit, planUsage, authIdentity } = makeStubs("STARTER");
    const svc = new WorkspaceUsersService(prisma, audit, planUsage);
    await expectRoleRejected(
      svc.createUser("tenant-a", "actor@tenant", "admin", {
        userId: "new@tenant",
        role: "approver",
      }),
      "approver",
      "STARTER",
    );
    expect(authIdentity.create).not.toHaveBeenCalled();
  });

  it("GROWTH + createUser(role=approver) → does not throw the tier gate", async () => {
    const { prisma, audit, planUsage } = makeStubs("GROWTH");
    const svc = new WorkspaceUsersService(prisma, audit, planUsage);
    // The downstream Prisma path is heavily stubbed; we only care that the
    // tier check passes for an approver on Growth. Any later failure is fine
    // for this assertion as long as it is NOT the ROLE_NOT_AVAILABLE_IN_PLAN one.
    await expect(
      svc.createUser("tenant-b", "actor@tenant", "admin", {
        userId: "new@tenant",
        role: "approver",
      }),
    ).resolves.toBeDefined();
  });

  it("STARTER + updateUserRole(role=channel_manager) → throws", async () => {
    const { prisma, audit, planUsage } = makeStubs("STARTER");
    const svc = new WorkspaceUsersService(prisma, audit, planUsage);
    await expectRoleRejected(
      svc.updateUserRole("tenant-a", "actor@tenant", "admin", "target@tenant", {
        role: "channel_manager",
      }),
      "channel_manager",
      "STARTER",
    );
  });

  it("STARTER + createUser(assignedRoles=[publisher]) → throws on the specialist path", async () => {
    const { prisma, audit, planUsage, authIdentity } = makeStubs("STARTER");
    const svc = new WorkspaceUsersService(prisma, audit, planUsage);
    await expectRoleRejected(
      svc.createUser("tenant-a", "actor@tenant", "admin", {
        userId: "new@tenant",
        role: "admin",
        assignedRoles: ["publisher"],
      } as Parameters<WorkspaceUsersService["createUser"]>[3]),
      "publisher",
      "STARTER",
    );
    expect(authIdentity.create).not.toHaveBeenCalled();
  });
});
