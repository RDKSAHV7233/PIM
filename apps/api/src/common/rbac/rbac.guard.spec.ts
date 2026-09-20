import { ExecutionContext, ForbiddenException } from "@nestjs/common";
import { RbacGuard } from "./rbac.guard";
import { ROLES_KEY } from "./roles";
import { ADMIN_BOUNDARY_ACCESS_KEY } from "./admin-boundary.decorator";
import { FOUNDATION_ROLE_ACCESS_KEY } from "./foundation-role-access.decorator";
import {
  API_CLIENT_ROUTE_POLICY_KEY,
  API_CLIENT_REQUIRED_SCOPES_KEY,
  DISALLOW_API_CLIENT_KEY,
} from "./api-client-policy.decorator";
import { READ_ACCESS_POLICY_KEY } from "./read-access-policy.decorator";
import { IS_PUBLIC_KEY } from "../../auth/public.decorator";

// Read-method requests also pass through a SEPARATE gate — read-classification
// enforcement — independent of every other check this file targets. Disabled
// by default here so GET-based test cases (most of them) exercise only the
// specific layer under test; the dedicated "read-method classification"
// describe block below manages this env var itself, per test, to test that
// layer directly.
const ORIGINAL_READ_CLASSIFICATION_ENV = process.env.PIM_ENFORCE_READ_CLASSIFICATION;
beforeAll(() => {
  process.env.PIM_ENFORCE_READ_CLASSIFICATION = "false";
});
afterAll(() => {
  process.env.PIM_ENFORCE_READ_CLASSIFICATION = ORIGINAL_READ_CLASSIFICATION_ENV;
});

type ReflectorStub = { getAllAndOverride: jest.Mock };

function makeReflector(overrides: Record<string, unknown> = {}): ReflectorStub {
  return {
    getAllAndOverride: jest.fn((key: string) => overrides[key] ?? undefined),
  };
}

function makeContext(request: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function makeGuard(reflectorOverrides: Record<string, unknown> = {}) {
  const reflector = makeReflector(reflectorOverrides);
  const auditService = { record: jest.fn().mockResolvedValue(undefined) };
  const accessPolicyService = {
    can: jest.fn(),
    recordShadowMismatch: jest.fn().mockResolvedValue(undefined),
  };
  const guard = new RbacGuard(reflector as never, auditService as never, accessPolicyService as never);
  return { guard, reflector, auditService, accessPolicyService };
}

describe("RbacGuard.canActivate — public and baseline checks", () => {
  it("allows a @Public() route unconditionally, before any tenant/role check", async () => {
    const { guard } = makeGuard({ [IS_PUBLIC_KEY]: true });
    const context = makeContext({});
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it("throws when the request has no tenant context, even for an otherwise-open route", async () => {
    const { guard } = makeGuard();
    const context = makeContext({ pimRole: "admin" });
    await expect(guard.canActivate(context)).rejects.toThrow("Tenant context is required.");
  });

  it("defaults a missing pimRole to the least-privileged role (viewer), not an elevated one", async () => {
    const { guard } = makeGuard();
    const request: Record<string, unknown> = { pimTenant: "t1", method: "GET" };
    await guard.canActivate(makeContext(request));
    expect(request.pimRole).toBe("viewer");
  });
});

describe("RbacGuard.canActivate — admin-boundary access (regression: was inverted, allowed every role)", () => {
  // This is the actual bug found and fixed: resolveAdminBoundaryDenialReason's
  // no-explicit-boundary-role fallback branch returned `null` (allowed) for
  // EVERY role, not just "admin" — silently disabling the intended
  // admin-boundary restriction for any route relying on it (alone, or as a
  // supposedly-tighter second layer on top of a looser @Roles()).
  it("denies a non-admin role with no explicit admin-boundary role, when the route has no other @Roles() gate", async () => {
    const { guard } = makeGuard({
      [ADMIN_BOUNDARY_ACCESS_KEY]: { capability: "manage_security" },
    });
    const context = makeContext({ pimTenant: "t1", pimRole: "viewer", method: "GET" });
    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it("denies an editor the same way — the fix is not admin-specific, it's role-agnostic", async () => {
    const { guard } = makeGuard({
      [ADMIN_BOUNDARY_ACCESS_KEY]: { allowedRoles: ["system_admin", "super_admin"] },
    });
    const context = makeContext({ pimTenant: "t1", pimRole: "editor", method: "GET" });
    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it("allows a plain legacy 'admin' role via fallback when no explicit admin-boundary role exists and fallback isn't disabled", async () => {
    const { guard } = makeGuard({
      [ADMIN_BOUNDARY_ACCESS_KEY]: { capability: "manage_security" },
    });
    const context = makeContext({ pimTenant: "t1", pimRole: "admin", method: "GET" });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it("denies even a plain 'admin' role when allowLegacyAdminFallback is explicitly false", async () => {
    const { guard } = makeGuard({
      [ADMIN_BOUNDARY_ACCESS_KEY]: { allowedRoles: ["system_admin", "super_admin"], allowLegacyAdminFallback: false },
    });
    const context = makeContext({ pimTenant: "t1", pimRole: "admin", method: "GET" });
    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it("allows an actor whose explicit admin-boundary role matches allowedRoles", async () => {
    const { guard } = makeGuard({
      [ADMIN_BOUNDARY_ACCESS_KEY]: { allowedRoles: ["system_admin", "super_admin"] },
    });
    const context = makeContext({
      pimTenant: "t1",
      pimRole: "editor",
      pimAdminBoundaryRoles: ["system_admin"],
      method: "GET",
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it("denies an actor whose explicit admin-boundary role does NOT match allowedRoles, even though it exists", async () => {
    const { guard } = makeGuard({
      [ADMIN_BOUNDARY_ACCESS_KEY]: { allowedRoles: ["super_admin"] },
    });
    const context = makeContext({
      pimTenant: "t1",
      pimRole: "editor",
      pimAdminBoundaryRoles: ["product_admin"],
      method: "GET",
    });
    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it("allows an actor whose explicit admin-boundary role grants the required capability", async () => {
    const { guard } = makeGuard({
      [ADMIN_BOUNDARY_ACCESS_KEY]: { capability: "manage_product_data" },
    });
    const context = makeContext({
      pimTenant: "t1",
      pimRole: "editor",
      pimAdminBoundaryRoles: ["product_admin"],
      method: "GET",
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it("denies an actor whose explicit admin-boundary role does not grant the required capability", async () => {
    const { guard } = makeGuard({
      [ADMIN_BOUNDARY_ACCESS_KEY]: { capability: "manage_platform" },
    });
    const context = makeContext({
      pimTenant: "t1",
      pimRole: "editor",
      pimAdminBoundaryRoles: ["system_admin"],
      method: "GET",
    });
    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it("real-world shape: a looser class-level @Roles('admin') plus a tighter allowedRoles no longer lets plain admin masquerade as the narrower tier for a route with NO @Roles() bypass path", async () => {
    // Mirrors billing.controller.ts's pattern: AdminBoundaryAccess({allowedRoles:
    // ["system_admin","super_admin"]}) with no allowLegacyAdminFallback override
    // (defaults to allowed) — plain "admin" is still let through via the
    // documented fallback, which is intentional here (matches every other
    // billing.controller.ts route using this exact shape), but a non-admin
    // role must not be.
    const { guard } = makeGuard({
      [ADMIN_BOUNDARY_ACCESS_KEY]: { allowedRoles: ["system_admin", "super_admin"] },
    });
    await expect(
      guard.canActivate(makeContext({ pimTenant: "t1", pimRole: "admin", method: "GET" })),
    ).resolves.toBe(true);
    await expect(
      guard.canActivate(makeContext({ pimTenant: "t1", pimRole: "viewer", method: "GET" })),
    ).rejects.toThrow(ForbiddenException);
  });
});

describe("RbacGuard.canActivate — @Roles() handler check and admin-boundary bypass", () => {
  it("allows an actor whose role is in the required list", async () => {
    const { guard } = makeGuard({ [ROLES_KEY]: ["admin", "editor"] });
    const context = makeContext({ pimTenant: "t1", pimRole: "editor", method: "GET" });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it("denies an actor whose role is not in the required list", async () => {
    const { guard } = makeGuard({ [ROLES_KEY]: ["admin"] });
    const context = makeContext({ pimTenant: "t1", pimRole: "viewer", method: "GET" });
    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it("bypasses a failed @Roles() check when the actor has an explicit admin-boundary role grant (ADMIN_BOUNDARY_ROLE_BYPASS)", async () => {
    const { guard } = makeGuard({
      [ROLES_KEY]: ["admin"],
      [ADMIN_BOUNDARY_ACCESS_KEY]: { capability: "manage_product_data" },
    });
    const context = makeContext({
      pimTenant: "t1",
      pimRole: "editor",
      pimAdminBoundaryRoles: ["product_admin"],
      method: "GET",
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});

describe("RbacGuard.canActivate — foundation-role blocking (category_manager/vendor)", () => {
  it("blocks a category_manager from a route with no explicit foundation-role allowance", async () => {
    const { guard } = makeGuard();
    const context = makeContext({
      pimTenant: "t1",
      pimRole: "editor",
      pimEffectiveRoles: ["editor", "category_manager"],
      method: "GET",
    });
    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it("allows a category_manager when the route explicitly allows that foundation role", async () => {
    const { guard } = makeGuard({
      [FOUNDATION_ROLE_ACCESS_KEY]: { allowedRoles: ["category_manager"] },
    });
    const context = makeContext({
      pimTenant: "t1",
      pimRole: "editor",
      pimEffectiveRoles: ["editor", "category_manager"],
      method: "GET",
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it("does not block an actor with neither category_manager nor vendor in effective roles", async () => {
    const { guard } = makeGuard();
    const context = makeContext({
      pimTenant: "t1",
      pimRole: "editor",
      pimEffectiveRoles: ["editor"],
      method: "GET",
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});

describe("RbacGuard.canActivate — API-client (api_key auth) policy", () => {
  it("denies an api_key actor when the route has no api-client policy configured (default: human only)", async () => {
    const { guard } = makeGuard();
    const context = makeContext({ pimTenant: "t1", pimRole: "admin", pimAuthType: "api_key", method: "GET" });
    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it("denies an api_key actor when the route explicitly disallows api clients", async () => {
    const { guard } = makeGuard({ [DISALLOW_API_CLIENT_KEY]: true });
    const context = makeContext({ pimTenant: "t1", pimRole: "admin", pimAuthType: "api_key", method: "GET" });
    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it("requires a matching scope when the route's api-client policy is allowed_with_api_scope", async () => {
    const { guard } = makeGuard({
      [API_CLIENT_ROUTE_POLICY_KEY]: "allowed_with_api_scope",
      [API_CLIENT_REQUIRED_SCOPES_KEY]: ["catalog.write"],
    });
    const denied = makeContext({
      pimTenant: "t1",
      pimRole: "admin",
      pimAuthType: "api_key",
      pimApiScopes: ["catalog.read"],
      method: "GET",
    });
    await expect(guard.canActivate(denied)).rejects.toThrow(ForbiddenException);

    const allowed = makeContext({
      pimTenant: "t1",
      pimRole: "admin",
      pimAuthType: "api_key",
      pimApiScopes: ["catalog.write"],
      method: "GET",
    });
    await expect(guard.canActivate(allowed)).resolves.toBe(true);
  });
});

describe("RbacGuard.canActivate — read-method classification and default write-role fallback", () => {
  const ORIGINAL_ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it("allows a GET with no read-access-policy attached when classification enforcement is off", async () => {
    process.env.PIM_ENFORCE_READ_CLASSIFICATION = "false";
    const { guard } = makeGuard();
    const context = makeContext({ pimTenant: "t1", pimRole: "viewer", method: "GET" });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it("denies an unclassified GET when classification enforcement is on (the default)", async () => {
    process.env.PIM_ENFORCE_READ_CLASSIFICATION = "true";
    const { guard } = makeGuard();
    const context = makeContext({ pimTenant: "t1", pimRole: "viewer", method: "GET" });
    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it("allows a GET carrying a read-access-policy id regardless of enforcement setting", async () => {
    process.env.PIM_ENFORCE_READ_CLASSIFICATION = "true";
    const { guard } = makeGuard({ [READ_ACCESS_POLICY_KEY]: "catalog_stats_redacted" });
    const context = makeContext({ pimTenant: "t1", pimRole: "viewer", method: "GET" });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it("allows a write-role actor (default: admin/editor) on a non-GET method with no explicit @Roles()", async () => {
    const { guard } = makeGuard();
    const context = makeContext({ pimTenant: "t1", pimRole: "editor", method: "POST" });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it("denies a non-write-role actor (e.g. viewer) on a non-GET method with no explicit @Roles()", async () => {
    const { guard } = makeGuard();
    const context = makeContext({ pimTenant: "t1", pimRole: "viewer", method: "POST" });
    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });
});

describe("RbacGuard.canActivate — audit logging on denial", () => {
  it("records a denied attempt via AuditService with the actor, reason, and requested resource", async () => {
    const { guard, auditService } = makeGuard({ [ROLES_KEY]: ["admin"] });
    const context = makeContext({
      pimTenant: "tenant-1",
      pimRole: "viewer",
      pimUserId: "user-1",
      method: "DELETE",
      url: "/admin/dangerous-thing",
    });
    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "user-1",
        actorRole: "viewer",
        action: "AUTHORIZATION_DENIED",
        resource: "/admin/dangerous-thing",
        metadata: expect.objectContaining({
          result: "denied",
          reasonCode: "ROLE_FORBIDDEN",
          tenantId: "tenant-1",
        }),
      }),
    );
  });

  it("does not record an audit entry when access is allowed", async () => {
    const { guard, auditService } = makeGuard({ [ROLES_KEY]: ["admin"] });
    const context = makeContext({ pimTenant: "t1", pimRole: "admin", method: "GET" });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(auditService.record).not.toHaveBeenCalled();
  });
});
