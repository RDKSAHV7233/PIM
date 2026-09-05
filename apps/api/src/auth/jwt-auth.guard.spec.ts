import { ExecutionContext, ServiceUnavailableException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ADMIN_BOUNDARY_ACCESS_KEY } from "../common/rbac/admin-boundary.decorator";
import { AUTHENTICATED_READ_ROUTE_KEY, READ_ACCESS_POLICY_KEY } from "../common/rbac/read-access-policy.decorator";
import { ROLES_KEY } from "../common/rbac/roles";
import { JwtAuthGuard } from "./jwt-auth.guard";
import { signPimJwt } from "./jwt";
import { STEP_UP_REQUIRED_KEY } from "./step-up.decorator";

function makeContext(request: Record<string, unknown>): ExecutionContext {
  return {
    getHandler: () => "handler",
    getClass: () => "class",
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

function makeGuard(metadata: Record<string, unknown>, jwtBlocklistService: Record<string, jest.Mock>) {
  const reflector = {
    getAllAndOverride: jest.fn((key: string) => metadata[key]),
  } as unknown as Reflector;
  const apiKeysService = { resolveApiKey: jest.fn() };
  const planUsageService = {
    getTenantPlanProfile: jest.fn().mockResolvedValue({ accessStatus: "active", tenantKey: "tenant1" }),
  };
  const authPolicyService = {
    getEffectiveMfaPolicy: jest.fn().mockResolvedValue({ mfaRequired: false }),
  };
  const guard = new JwtAuthGuard(
    reflector,
    jwtBlocklistService as never,
    apiKeysService as never,
    planUsageService as never,
    {} as never,
    authPolicyService as never,
  );

  return { guard, planUsageService, authPolicyService };
}

function makeRequest(method: string) {
  const token = signPimJwt({
    sub: "user1",
    tenantId: "tenant1",
    role: "viewer",
    expiresInSeconds: 3600,
  });
  return {
    method,
    path: "/catalog/products",
    headers: {
      authorization: `Bearer ${token}`,
    },
  };
}

describe("JwtAuthGuard revocation-authority outage policy", () => {
  const originalSecret = process.env.JWT_SECRET;
  const originalAuthMode = process.env.AUTH_MODE;

  beforeEach(() => {
    process.env.JWT_SECRET = "test-secret-with-enough-entropy-for-guard-policy";
    delete process.env.AUTH_MODE;
  });

  afterEach(() => {
    if (originalSecret === undefined) {
      delete process.env.JWT_SECRET;
    } else {
      process.env.JWT_SECRET = originalSecret;
    }
    if (originalAuthMode === undefined) {
      delete process.env.AUTH_MODE;
    } else {
      process.env.AUTH_MODE = originalAuthMode;
    }
  });

  it("fails closed for mutating routes when the access-token revocation check throws", async () => {
    const request = makeRequest("POST");
    const jwtBlocklistService = {
      isRevoked: jest.fn().mockRejectedValue(new Error("redis unavailable")),
      isCredentialRevoked: jest.fn(),
    };
    const { guard } = makeGuard({}, jwtBlocklistService);

    await expect(guard.canActivate(makeContext(request))).rejects.toBeInstanceOf(ServiceUnavailableException);

    expect(jwtBlocklistService.isRevoked).toHaveBeenCalledTimes(1);
    expect(jwtBlocklistService.isCredentialRevoked).not.toHaveBeenCalled();
  });

  it("fails closed for admin read routes when revocation authority is unavailable", async () => {
    const request = makeRequest("GET");
    const jwtBlocklistService = {
      isRevoked: jest.fn().mockRejectedValue(new Error("redis unavailable")),
      isCredentialRevoked: jest.fn(),
    };
    const { guard } = makeGuard(
      {
        [AUTHENTICATED_READ_ROUTE_KEY]: { classification: "self_service", responseHandling: "none" },
        [ROLES_KEY]: ["admin"],
      },
      jwtBlocklistService,
    );

    await expect(guard.canActivate(makeContext(request))).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("fails closed for step-up/security-sensitive read routes", async () => {
    const request = makeRequest("GET");
    const jwtBlocklistService = {
      isRevoked: jest.fn().mockRejectedValue(new Error("redis unavailable")),
      isCredentialRevoked: jest.fn(),
    };
    const { guard } = makeGuard(
      {
        [AUTHENTICATED_READ_ROUTE_KEY]: { classification: "self_service", responseHandling: "none" },
        [STEP_UP_REQUIRED_KEY]: { scope: "auth_config_high_risk", action: "update_auth_config" },
      },
      jwtBlocklistService,
    );

    await expect(guard.canActivate(makeContext(request))).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("allows explicit non-sensitive read policies in bounded degraded mode", async () => {
    const request = makeRequest("GET");
    const jwtBlocklistService = {
      isRevoked: jest.fn().mockRejectedValue(new Error("redis unavailable")),
      isCredentialRevoked: jest.fn().mockRejectedValue(new Error("credential revocation unavailable")),
    };
    const { guard, planUsageService, authPolicyService } = makeGuard(
      {
        [AUTHENTICATED_READ_ROUTE_KEY]: { classification: "scope_filtered", responseHandling: "none" },
        [READ_ACCESS_POLICY_KEY]: "taxonomy_safe_metadata",
      },
      jwtBlocklistService,
    );

    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);

    expect(planUsageService.getTenantPlanProfile).toHaveBeenCalledWith("tenant1");
    expect(authPolicyService.getEffectiveMfaPolicy).toHaveBeenCalledWith("tenant1");
    expect(request).toMatchObject({
      pimUserId: "user1",
      pimTenant: "tenant1",
      pimAuthType: "user_jwt",
    });
  });

  it("fails closed for self-service reads unless the route is explicitly approved for degraded mode", async () => {
    const request = makeRequest("GET");
    const jwtBlocklistService = {
      isRevoked: jest.fn().mockRejectedValue(new Error("redis unavailable")),
      isCredentialRevoked: jest.fn(),
    };
    const { guard } = makeGuard(
      {
        [AUTHENTICATED_READ_ROUTE_KEY]: { classification: "self_service", responseHandling: "none" },
      },
      jwtBlocklistService,
    );

    await expect(guard.canActivate(makeContext(request))).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("fails closed for credential-revocation outages on mutating routes", async () => {
    const request = makeRequest("PATCH");
    const jwtBlocklistService = {
      isRevoked: jest.fn().mockResolvedValue(false),
      isCredentialRevoked: jest.fn().mockRejectedValue(new Error("credential revocation unavailable")),
    };
    const { guard } = makeGuard({}, jwtBlocklistService);

    await expect(guard.canActivate(makeContext(request))).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it("fails closed for admin-boundary reads even when they are authenticated read routes", async () => {
    const request = makeRequest("GET");
    const jwtBlocklistService = {
      isRevoked: jest.fn().mockRejectedValue(new Error("redis unavailable")),
      isCredentialRevoked: jest.fn(),
    };
    const { guard } = makeGuard(
      {
        [AUTHENTICATED_READ_ROUTE_KEY]: { classification: "self_service", responseHandling: "none" },
        [ADMIN_BOUNDARY_ACCESS_KEY]: { allowedRoles: ["system_admin"] },
      },
      jwtBlocklistService,
    );

    await expect(guard.canActivate(makeContext(request))).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
