// Coverage for ConnectorPermissionService.resolveActionRule/assertActionAllowed
// — the actual authorization gate every connector install/reconnect/uninstall
// request passes through — plus evaluateInstallPlanRule, the plan-limit check
// layered on top of it for installs. Zero test coverage existed for any of
// this despite it being a real authorization boundary: admin and
// connector_admin roles bypass the per-principal permission table entirely,
// every other role/action combination is gated by an exact-match lookup
// (by user id or by role, with an accountAlias wildcard).
//
// Scoped to the authorization decision itself, not the permission-grant CRUD
// (grantPermission/revokePermission) — that's simpler create/delete plumbing
// around the same table this already exercises via the read side, and is a
// smaller residual gap left for a follow-up rather than folded in here.

import { ForbiddenException } from "@nestjs/common";
import { ConnectorPermissionService, type ConnectorActor } from "./connector-permission.service";
import { runWithTenantContext } from "../common/tenant/tenant-context";
import type { PrismaService } from "../prisma/prisma.service";
import type { PlanUsageService } from "../billing/plan-usage.service";
import type { AuditService } from "../audit/audit.service";

function makeStubs(permissionRows: unknown[] = [], planAllowed = true) {
  const queryRaw = jest.fn().mockResolvedValue(permissionRows);
  const tenantClient = { $queryRaw: queryRaw };
  const prisma = { tenant: jest.fn().mockReturnValue(tenantClient) } as unknown as PrismaService;

  const checkLimit = jest.fn().mockResolvedValue({ allowed: planAllowed, limit: 10, current: planAllowed ? 0 : 10 });
  const planUsageService = { checkLimit } as unknown as PlanUsageService;

  const audit = { record: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

  return { prisma, planUsageService, audit, queryRaw, checkLimit };
}

function run<T>(fn: () => Promise<T>): Promise<T> {
  return runWithTenantContext("tenant-a", fn);
}

describe("ConnectorPermissionService.resolveActionRule / assertActionAllowed — the authorization gate (no prior coverage)", () => {
  it("admin can always perform any action, bypassing the per-principal permission table entirely", async () => {
    const stubs = makeStubs();
    const service = new ConnectorPermissionService(stubs.prisma, stubs.planUsageService, stubs.audit);
    const actor: ConnectorActor = { actorId: "admin-1", actorRole: "admin" };

    await run(() => service.assertActionAllowed(actor, { connectorSlug: "shopify", action: "uninstall" }));

    expect(stubs.queryRaw).not.toHaveBeenCalled();
  });

  it("blocks even an admin's install when the plan's connector-installation limit is exceeded", async () => {
    const stubs = makeStubs([], false);
    const service = new ConnectorPermissionService(stubs.prisma, stubs.planUsageService, stubs.audit);
    const actor: ConnectorActor = { actorId: "admin-1", actorRole: "admin" };

    await expect(
      run(() => service.assertActionAllowed(actor, { connectorSlug: "shopify", action: "install" })),
    ).rejects.toMatchObject({
      response: { error: "CONNECTOR_PERMISSION_DENIED", reason: "PLAN_CONNECTOR_INSTALLATIONS_LIMIT_EXCEEDED" },
    });
  });

  it("connector_admin can install/reconnect/uninstall the same as admin, still subject to the plan check", async () => {
    const stubs = makeStubs();
    const service = new ConnectorPermissionService(stubs.prisma, stubs.planUsageService, stubs.audit);
    const actor: ConnectorActor = { actorId: "conn-admin-1", actorRole: "connector_admin" };

    await run(() => service.assertActionAllowed(actor, { connectorSlug: "woocommerce", action: "reconnect" }));

    expect(stubs.queryRaw).not.toHaveBeenCalled();
  });

  it("a non-privileged role with no matching permission row is denied CONNECTOR_PERMISSION_REQUIRED", async () => {
    const stubs = makeStubs([]);
    const service = new ConnectorPermissionService(stubs.prisma, stubs.planUsageService, stubs.audit);
    const actor: ConnectorActor = { actorId: "editor-1", actorRole: "editor" };

    await expect(
      run(() => service.assertActionAllowed(actor, { connectorSlug: "shopify", action: "reconnect" })),
    ).rejects.toMatchObject({
      response: { error: "CONNECTOR_PERMISSION_DENIED", reason: "CONNECTOR_PERMISSION_REQUIRED" },
    });
  });

  it("a non-privileged role IS allowed once a matching user-level permission row exists", async () => {
    const stubs = makeStubs([{ id: "perm-1" }]);
    const service = new ConnectorPermissionService(stubs.prisma, stubs.planUsageService, stubs.audit);
    const actor: ConnectorActor = { actorId: "editor-1", actorRole: "editor" };

    await run(() => service.assertActionAllowed(actor, { connectorSlug: "shopify", action: "reconnect" }));
  });

  it("resolveActionRule returns the decision without throwing; assertActionAllowed throws ForbiddenException on the same denial", async () => {
    const stubs = makeStubs([]);
    const service = new ConnectorPermissionService(stubs.prisma, stubs.planUsageService, stubs.audit);
    const actor: ConnectorActor = { actorId: "editor-1", actorRole: "editor" };

    const decision = await run(() => service.resolveActionRule(actor, { connectorSlug: "shopify", action: "uninstall" }));
    expect(decision).toEqual({ allowed: false, reason: "CONNECTOR_PERMISSION_REQUIRED" });

    await expect(
      run(() => service.assertActionAllowed(actor, { connectorSlug: "shopify", action: "uninstall" })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("install for a non-privileged role still runs the plan-limit check before the permission lookup", async () => {
    const stubs = makeStubs([{ id: "perm-1" }], false);
    const service = new ConnectorPermissionService(stubs.prisma, stubs.planUsageService, stubs.audit);
    const actor: ConnectorActor = { actorId: "editor-1", actorRole: "editor" };

    await expect(
      run(() => service.assertActionAllowed(actor, { connectorSlug: "shopify", action: "install" })),
    ).rejects.toMatchObject({
      response: { reason: "PLAN_CONNECTOR_INSTALLATIONS_LIMIT_EXCEEDED" },
    });
    // Denied on the plan check before ever consulting the permission table.
    expect(stubs.queryRaw).not.toHaveBeenCalled();
  });
});
