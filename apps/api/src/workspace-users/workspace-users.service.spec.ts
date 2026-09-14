// Tier-gate coverage for workspace user role assignment.
//
// These tests guard the new ROLE_NOT_AVAILABLE_IN_PLAN error path added in
// workspace-users.service.ts. They use plain object stubs (no test framework
// mocks of the deep Prisma surface) so that the spec stays readable and
// resilient to unrelated Prisma schema churn.

import { BadRequestException } from "@nestjs/common";
import * as bcrypt from "bcryptjs";
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

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}

describe("WorkspaceUsersService — plan-tier role gating", () => {
  const ORIGINAL_AUTH_MODE = process.env.AUTH_MODE;
  const ORIGINAL_APP_ENV = process.env.APP_ENV;
  const ORIGINAL_PIM_AUTH_PASSWORD = process.env.PIM_AUTH_PASSWORD;

  beforeEach(() => {
    process.env.AUTH_MODE = "memory";
    delete process.env.APP_ENV;
    delete process.env.PIM_AUTH_PASSWORD;
  });

  afterEach(() => {
    restoreEnv("AUTH_MODE", ORIGINAL_AUTH_MODE);
    restoreEnv("APP_ENV", ORIGINAL_APP_ENV);
    restoreEnv("PIM_AUTH_PASSWORD", ORIGINAL_PIM_AUTH_PASSWORD);
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

  it("staging DB mode + createUser without password → rejects shared-password fallback", async () => {
    process.env.AUTH_MODE = "db";
    process.env.APP_ENV = "staging";
    process.env.PIM_AUTH_PASSWORD = "staging-shared-password-must-not-be-used";

    const { prisma, audit, planUsage, authIdentity } = makeStubs("ENTERPRISE");
    const svc = new WorkspaceUsersService(prisma, audit, planUsage);

    await expect(
      svc.createUser("tenant-a", "actor@tenant", "admin", {
        userId: "new@tenant",
        role: "viewer",
      }),
    ).rejects.toMatchObject({
      response: {
        error: "PASSWORD_REQUIRED",
        minLength: 8,
      },
    });
    expect(authIdentity.create).not.toHaveBeenCalled();
  });

  it("staging DB mode + createUser with password → stores per-user hash", async () => {
    process.env.AUTH_MODE = "db";
    process.env.APP_ENV = "staging";
    process.env.PIM_AUTH_PASSWORD = "staging-shared-password-must-not-be-used";

    const { prisma, audit, planUsage, authIdentity } = makeStubs("ENTERPRISE");
    const svc = new WorkspaceUsersService(prisma, audit, planUsage);

    await expect(
      svc.createUser("tenant-a", "actor@tenant", "admin", {
        userId: "new@tenant",
        role: "viewer",
        password: "Explicit#Password2026",
      }),
    ).resolves.toBeDefined();

    const createPayload = authIdentity.create.mock.calls[0]?.[0]?.data;
    expect(createPayload.passwordHash).toEqual(expect.any(String));
    expect(createPayload.passwordHash).not.toBe("Explicit#Password2026");
    await expect(bcrypt.compare("Explicit#Password2026", createPayload.passwordHash)).resolves.toBe(true);
    await expect(bcrypt.compare("staging-shared-password-must-not-be-used", createPayload.passwordHash)).resolves.toBe(false);
  });
});

// ─── deactivateUser / last-admin guard (#816) ────────────────────────────────
//
// Live-reproduced bug: with exactly one active admin, deactivating them
// succeeded instead of being rejected — Admin Coverage silently went 1 → 0.
//
// Round 1 of the fix (Serializable transaction around a plain `count`) was
// itself disproven by a real-Postgres reproduction: run 5x with the actual
// compiled service and natural concurrent timing (no artificial delay),
// Postgres's Serializable Snapshot Isolation missed the write-skew conflict
// 5/5 times on the COUNT aggregate. Round 2 (this version) uses explicit
// pessimistic row locking — `SELECT ... FOR UPDATE` on every active admin row
// — inside the transaction, before counting. A concurrent deactivation
// targeting a different admin row genuinely blocks on this SELECT until the
// first transaction commits, then re-evaluates against the post-commit state.
// Re-verified via the same real-Postgres reproduction, 5/5 runs held.
//
// These unit tests target the mechanism directly with mocks; the real
// concurrency proof lives in last-admin-guard-real-service-proof.cjs (run
// against an isolated Postgres database, not this shared tenant — see
// feedback-pim-shared-tenant-concurrency memory for why a live click-test on
// app.vexapim.com can't be trusted for this).

function makeDeactivateStubs(options: { targetRole: string; targetActive: boolean; activeAdminIds: string[] }) {
  const targetRow = {
    id: "row-target",
    userId: "target@tenant",
    role: options.targetRole,
    assignedRoles: [] as string[],
    isActive: options.targetActive,
    lockedUntil: null,
    lastSignInAt: null,
    createdBy: "actor@tenant",
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const queryRawSpy = jest.fn().mockResolvedValue(options.activeAdminIds.map((id) => ({ id })));
  const txAuthIdentity = {
    update: jest.fn().mockResolvedValue({ ...targetRow, isActive: false }),
  };

  const authIdentity = {
    findFirst: jest.fn().mockResolvedValue(targetRow),
  };

  const transactionSpy = jest.fn(async (callback: (tx: unknown) => unknown) => {
    return callback({ authIdentity: txAuthIdentity, $queryRaw: queryRawSpy });
  });

  const tenantClient = {
    authIdentity,
    $transaction: transactionSpy,
  };
  const prisma = {
    tenant: jest.fn().mockReturnValue(tenantClient),
  } as unknown as PrismaService;

  const audit = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditService;

  const planUsage = {
    getTenantPlanTier: jest.fn().mockResolvedValue("ENTERPRISE"),
    checkLimit: jest.fn().mockResolvedValue({ allowed: true, limit: 999, current: 0 }),
  } as unknown as PlanUsageService;

  return { prisma, audit, planUsage, txAuthIdentity, transactionSpy, queryRawSpy };
}

describe("WorkspaceUsersService.deactivateUser — last-admin guard (#816)", () => {
  it("rejects deactivating the sole active admin and never applies the update", async () => {
    const { prisma, audit, planUsage, txAuthIdentity } = makeDeactivateStubs({
      targetRole: "admin",
      targetActive: true,
      activeAdminIds: ["row-target"],
    });
    const svc = new WorkspaceUsersService(prisma, audit, planUsage);

    await expect(
      svc.deactivateUser("tenant-a", "actor@tenant", "admin", "target@tenant"),
    ).rejects.toMatchObject({
      response: { error: "LAST_ADMIN_GUARD" },
    });

    expect(txAuthIdentity.update).not.toHaveBeenCalled();
  });

  it("allows deactivating an admin when another active admin remains", async () => {
    const { prisma, audit, planUsage, txAuthIdentity } = makeDeactivateStubs({
      targetRole: "admin",
      targetActive: true,
      activeAdminIds: ["row-target", "row-other-admin"],
    });
    const svc = new WorkspaceUsersService(prisma, audit, planUsage);

    await expect(
      svc.deactivateUser("tenant-a", "actor@tenant", "admin", "target@tenant"),
    ).resolves.toMatchObject({ isActive: false });

    expect(txAuthIdentity.update).toHaveBeenCalledTimes(1);
  });

  it("locks active admin rows with FOR UPDATE inside the same transaction as the update, not two round trips", async () => {
    const { prisma, audit, planUsage, transactionSpy, queryRawSpy } = makeDeactivateStubs({
      targetRole: "admin",
      targetActive: true,
      activeAdminIds: ["row-target", "row-other-admin"],
    });
    const svc = new WorkspaceUsersService(prisma, audit, planUsage);

    await svc.deactivateUser("tenant-a", "actor@tenant", "admin", "target@tenant");

    expect(transactionSpy).toHaveBeenCalledTimes(1);
    expect(queryRawSpy).toHaveBeenCalledTimes(1);
    const sqlFragments = queryRawSpy.mock.calls[0]?.[0] as string[] | undefined;
    const fullSql = Array.isArray(sqlFragments) ? sqlFragments.join("?") : String(sqlFragments);
    expect(fullSql).toMatch(/FOR UPDATE/);
    expect(fullSql).toMatch(/isActive/i);
  });

  it("does not run the admin-lock guard at all for a non-admin target", async () => {
    const { prisma, audit, planUsage, txAuthIdentity, queryRawSpy } = makeDeactivateStubs({
      targetRole: "editor",
      targetActive: true,
      activeAdminIds: [],
    });
    const svc = new WorkspaceUsersService(prisma, audit, planUsage);

    await expect(
      svc.deactivateUser("tenant-a", "actor@tenant", "admin", "target@tenant"),
    ).resolves.toMatchObject({ isActive: false });

    expect(queryRawSpy).not.toHaveBeenCalled();
    expect(txAuthIdentity.update).toHaveBeenCalledTimes(1);
  });
});
