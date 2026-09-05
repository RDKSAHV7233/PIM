// PO decision (TC-37, option 2): SSO auto-provisioning must never block a login over the
// plan's user limit — it's continuous and passive, not a deliberate action a customer
// chooses to trigger. Instead, an over-limit tenant gets flagged for commercial follow-up
// the same way this codebase already handles "something needs Vexa's commercial attention"
// (TenantCommercialRequest + a one-time email), via OidcAuthService.findOrProvisionUser.
//
// These tests call the private findOrProvisionUser directly (via a typed cast) rather than
// the public completeLogin — completeLogin also needs oidcService.handleCallback, JWT
// signing (env-dependent), and session-timeout policy resolution, none of which this
// behavior depends on. Testing at that boundary would mean mocking unrelated machinery to
// exercise logic that doesn't touch it.
// oidc.service.ts requires the ESM-only "openid-client" package at module load time,
// which Jest's CJS transform can't parse — mock it out before OidcAuthService (which
// imports it purely for typing/DI, never invoked by the code under test here) pulls it in.
jest.mock("./oidc.service", () => ({ OidcService: class {} }));

import { OidcAuthService } from "./oidc-auth.service";

function makeService(options: {
  existingIdentity?: { userId: string; role: string; assignedRoles: string[]; isActive: boolean } | null;
  userCount: number;
  maxUsers: number;
} = { userCount: 1, maxUsers: 999 }) {
  const authIdentityCreate = jest.fn().mockResolvedValue({});
  const authIdentityCount = jest.fn().mockResolvedValue(options.userCount);
  const tenantClient = {
    authIdentity: {
      findFirst: jest.fn().mockResolvedValue(options.existingIdentity ?? null),
      create: authIdentityCreate,
      count: authIdentityCount,
    },
  };
  const prisma = { tenant: jest.fn().mockReturnValue(tenantClient) };

  const planUsageService = {
    checkLimit: jest.fn().mockImplementation((resource: string, delta: number) => {
      const current = options.userCount + delta;
      return Promise.resolve({ allowed: current <= options.maxUsers, resource, limit: options.maxUsers, current });
    }),
    getTenantPlanProfile: jest.fn().mockResolvedValue({
      tenantKey: "acme",
      planTier: "ENTERPRISE",
      billingStatus: "active_paid",
      accessStatus: "active",
    }),
  };

  const commercialRequestsService = {
    createOrReuseOverageFlag: jest.fn().mockResolvedValue({
      created: true,
      item: {
        id: "req_1",
        tenantKey: "acme",
        workspaceSlug: "acme",
        displayName: "Acme",
        requestType: "users_limit_overage",
        status: "open",
        requestedBy: "system",
        requesterRole: "system",
        currentPlanTier: "ENTERPRISE",
        requestedPlanTier: null,
        currentBillingStatus: "active_paid",
        currentAccessStatus: "active",
        notes: null,
        source: "sso_auto_provisioning",
        usageSnapshot: { resource: "users", current: options.userCount + 1, limit: options.maxUsers },
        resolvedAt: null,
        resolvedBy: null,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
      },
    }),
  };

  const commercialNotificationsService = {
    notifyCommercialOpsOverageFlag: jest.fn().mockResolvedValue({ recipientCount: 1 }),
  };

  const auditService = { record: jest.fn().mockResolvedValue(undefined) };

  const service = new OidcAuthService(
    prisma as never,
    {} as never, // oidcService — not exercised by findOrProvisionUser
    {} as never, // tenantDirectoryService
    {} as never, // authPolicyService
    auditService as never,
    planUsageService as never,
    commercialRequestsService as never,
    commercialNotificationsService as never,
  );

  return { service, tenantClient, planUsageService, commercialRequestsService, commercialNotificationsService, auditService, authIdentityCreate };
}

// Type-safe access to the private method without loosening the class's public API.
function findOrProvisionUser(
  service: OidcAuthService,
  tenantKey: string,
  userId: string,
  claimedRoles: string[],
) {
  return (service as unknown as {
    findOrProvisionUser(t: string, u: string, r: string[]): Promise<{ userId: string; role: string; assignedRoles: string[] }>;
  }).findOrProvisionUser(tenantKey, userId, claimedRoles);
}

describe("OidcAuthService.findOrProvisionUser — never blocks login on the user plan limit", () => {
  it("provisions the user and returns normally even when the tenant is already over its user limit", async () => {
    const { service, authIdentityCreate } = makeService({ userCount: 999, maxUsers: 998 });

    const result = await findOrProvisionUser(service, "acme", "new.person@example.com", []);

    expect(authIdentityCreate).toHaveBeenCalledTimes(1);
    expect(result.userId).toBe("new.person@example.com");
  });

  it("in-limit tenant: checkLimit runs but no overage flag is created", async () => {
    const { service, planUsageService, commercialRequestsService } = makeService({ userCount: 5, maxUsers: 999 });

    await findOrProvisionUser(service, "acme", "new.person@example.com", []);

    expect(planUsageService.checkLimit).toHaveBeenCalledWith("users", 0, "acme");
    expect(commercialRequestsService.createOrReuseOverageFlag).not.toHaveBeenCalled();
  });

  it("over-limit tenant: creates an overage flag with the resource/current/limit, and notifies commercial ops", async () => {
    const { service, commercialRequestsService, commercialNotificationsService } = makeService({
      userCount: 999,
      maxUsers: 998,
    });

    await findOrProvisionUser(service, "acme", "new.person@example.com", []);

    expect(commercialRequestsService.createOrReuseOverageFlag).toHaveBeenCalledWith(
      "acme",
      expect.objectContaining({
        resource: "users",
        current: 999, // checkLimit's delta=0 means this reflects the live, post-create count directly
        limit: 998,
        source: "sso_auto_provisioning",
      }),
    );
    expect(commercialNotificationsService.notifyCommercialOpsOverageFlag).toHaveBeenCalledWith({
      tenantKey: "acme",
      request: expect.objectContaining({ id: "req_1" }),
    });
  });

  it("does not send a second notification when an overage flag already exists (createOrReuseOverageFlag returns created=false)", async () => {
    const { service, commercialRequestsService, commercialNotificationsService } = makeService({
      userCount: 999,
      maxUsers: 998,
    });
    commercialRequestsService.createOrReuseOverageFlag.mockResolvedValue({
      created: false,
      item: { id: "req_existing" },
    });

    await findOrProvisionUser(service, "acme", "another.person@example.com", []);

    expect(commercialNotificationsService.notifyCommercialOpsOverageFlag).not.toHaveBeenCalled();
  });

  it("a failure while flagging the overage is swallowed — the user is still provisioned and the login result still returns normally", async () => {
    const { service, authIdentityCreate, commercialRequestsService } = makeService({ userCount: 999, maxUsers: 998 });
    commercialRequestsService.createOrReuseOverageFlag.mockRejectedValue(new Error("DB unavailable"));

    // The whole point of the try/catch around flagUserLimitOverageIfNeeded: this must
    // resolve normally, not reject, even though the flagging step threw internally.
    const result = await findOrProvisionUser(service, "acme", "new.person@example.com", []);

    expect(result.userId).toBe("new.person@example.com");
    expect(authIdentityCreate).toHaveBeenCalledTimes(1);
  });

  it("an already-existing user logging in again does not re-check or re-flag the limit — only new provisioning does", async () => {
    const { service, planUsageService } = makeService({
      existingIdentity: { userId: "existing@example.com", role: "viewer", assignedRoles: [], isActive: true },
      userCount: 999,
      maxUsers: 999,
    });

    await findOrProvisionUser(service, "acme", "existing@example.com", []);

    expect(planUsageService.checkLimit).not.toHaveBeenCalled();
  });
});
