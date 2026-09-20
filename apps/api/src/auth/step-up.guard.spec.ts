import { ExecutionContext, ForbiddenException, UnauthorizedException } from "@nestjs/common";
import { StepUpGuard, PIM_STEP_UP_TOKEN_HEADER } from "./step-up.guard";
import { signPimJwt, STEP_UP_SCOPE_MAPPING_HIGH_RISK, STEP_UP_SCOPE_AUTH_CONFIG_HIGH_RISK } from "./jwt";

// StepUpGuard enforces fresh re-authentication for high-risk actions (OIDC
// config changes, connector-credential replacement, mapping publish) and
// binds the step-up token to the exact access-token session, user, and
// tenant that requested it — a real anti-replay property (a step-up token
// obtained for one session must not satisfy the requirement for a
// different session, even for the same user). Zero prior test coverage on
// any of this. Tested against real signed JWTs throughout, not a mocked
// verifier — matches the convention established in jwt.step-up-scope.spec.ts
// and tenant-context.interceptor.spec.ts.
describe("StepUpGuard", () => {
  beforeAll(() => {
    process.env.JWT_SECRET = "test-jwt-secret-at-least-32-characters-long-for-hkdf-derive";
  });

  function makeContext(request: Record<string, unknown>): ExecutionContext {
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  function makeGuard(requirement: unknown, isRevoked: jest.Mock = jest.fn().mockResolvedValue(false)) {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(requirement) };
    const auditService = { record: jest.fn().mockResolvedValue(undefined) };
    const jwtBlocklistService = { isRevoked };
    const guard = new StepUpGuard(reflector as never, auditService as never, jwtBlocklistService as never);
    return { guard, auditService, jwtBlocklistService };
  }

  const REQUIREMENT = { scope: STEP_UP_SCOPE_AUTH_CONFIG_HIGH_RISK, action: "update_auth_config" };

  it("allows the request unconditionally when the route has no step-up requirement — never even looks at pimJwtClaims", () => {
    const { guard } = makeGuard(undefined);
    const context = makeContext({});
    return expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it("throws UnauthorizedException when there is no access-token claims on the request at all", async () => {
    const { guard } = makeGuard(REQUIREMENT);
    const context = makeContext({ headers: {} });
    await expect(guard.canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it("throws STEP_UP_REQUIRED and logs an audit entry when the step-up header is absent", async () => {
    const { guard, auditService } = makeGuard(REQUIREMENT);
    const accessClaims = { sub: "user-1", jti: "access-jti-1", tenantId: "acme", role: "admin" };
    const context = makeContext({ headers: {}, pimJwtClaims: accessClaims });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      response: { error: "STEP_UP_REQUIRED" },
    });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "user-1",
        action: "auth.step_up_denied",
        metadata: expect.objectContaining({ reason: "missing" }),
      }),
    );
  });

  it("throws STEP_UP_TOKEN_INVALID for a malformed/unsigned step-up token", async () => {
    const { guard, auditService } = makeGuard(REQUIREMENT);
    const accessClaims = { sub: "user-1", jti: "access-jti-1", tenantId: "acme", role: "admin" };
    const context = makeContext({
      headers: { [PIM_STEP_UP_TOKEN_HEADER]: "not-a-real-jwt" },
      pimJwtClaims: accessClaims,
    });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      response: { error: "STEP_UP_TOKEN_INVALID" },
    });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ reason: "invalid" }) }),
    );
  });

  it("rejects a regular access token presented as a step-up token — tokenType is checked, not just signature validity", async () => {
    const { guard } = makeGuard(REQUIREMENT);
    const accessToken = signPimJwt({ sub: "user-1", tenantId: "acme", tokenType: "access" });
    const accessClaims = { sub: "user-1", jti: "access-jti-1", tenantId: "acme", role: "admin" };
    // Presenting a real, validly-signed ACCESS token in the step-up header —
    // must still be rejected because tokenType !== "step_up".
    const context = makeContext({
      headers: { [PIM_STEP_UP_TOKEN_HEADER]: `Bearer ${accessToken}` },
      pimJwtClaims: accessClaims,
    });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      response: { error: "STEP_UP_TOKEN_INVALID" },
    });
  });

  it("rejects a revoked step-up token", async () => {
    const isRevoked = jest.fn().mockResolvedValue(true);
    const { guard, auditService } = makeGuard(REQUIREMENT, isRevoked);
    const accessClaims = { sub: "user-1", jti: "access-jti-1", tenantId: "acme", role: "admin" };
    const stepUpToken = signPimJwt({
      sub: "user-1",
      tenantId: "acme",
      tokenType: "step_up",
      stepUpScope: STEP_UP_SCOPE_AUTH_CONFIG_HIGH_RISK,
      parentJti: "access-jti-1",
    });
    const context = makeContext({
      headers: { [PIM_STEP_UP_TOKEN_HEADER]: `Bearer ${stepUpToken}` },
      pimJwtClaims: accessClaims,
    });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      response: { error: "STEP_UP_TOKEN_REVOKED" },
    });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ reason: "revoked" }) }),
    );
  });

  it("rejects a step-up token issued for a DIFFERENT scope than the route requires", async () => {
    const { guard, auditService } = makeGuard(REQUIREMENT);
    const accessClaims = { sub: "user-1", jti: "access-jti-1", tenantId: "acme", role: "admin" };
    const stepUpToken = signPimJwt({
      sub: "user-1",
      tenantId: "acme",
      tokenType: "step_up",
      stepUpScope: STEP_UP_SCOPE_MAPPING_HIGH_RISK, // route requires AUTH_CONFIG_HIGH_RISK
      parentJti: "access-jti-1",
    });
    const context = makeContext({
      headers: { [PIM_STEP_UP_TOKEN_HEADER]: `Bearer ${stepUpToken}` },
      pimJwtClaims: accessClaims,
    });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      response: { error: "STEP_UP_SCOPE_MISMATCH" },
    });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ reason: "scope_mismatch" }) }),
    );
    // A scope mismatch is a ForbiddenException (authenticated, wrong scope), not Unauthorized.
    const { guard: guard2 } = makeGuard(REQUIREMENT);
    const context2 = makeContext({
      headers: { [PIM_STEP_UP_TOKEN_HEADER]: `Bearer ${stepUpToken}` },
      pimJwtClaims: accessClaims,
    });
    await expect(guard2.canActivate(context2)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects a step-up token whose parentJti does not match the current access token's jti — the core anti-replay-across-sessions property", async () => {
    const { guard, auditService } = makeGuard(REQUIREMENT);
    const accessClaims = { sub: "user-1", jti: "access-jti-CURRENT-SESSION", tenantId: "acme", role: "admin" };
    // Step-up token was legitimately obtained, but for a DIFFERENT (e.g. earlier
    // or attacker-replayed) session — parentJti points at a different jti.
    const stepUpToken = signPimJwt({
      sub: "user-1",
      tenantId: "acme",
      tokenType: "step_up",
      stepUpScope: STEP_UP_SCOPE_AUTH_CONFIG_HIGH_RISK,
      parentJti: "access-jti-OLD-SESSION",
    });
    const context = makeContext({
      headers: { [PIM_STEP_UP_TOKEN_HEADER]: `Bearer ${stepUpToken}` },
      pimJwtClaims: accessClaims,
    });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      response: { error: "STEP_UP_TOKEN_SESSION_MISMATCH" },
    });
    expect(auditService.record).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: expect.objectContaining({ reason: "session_mismatch" }) }),
    );
  });

  it("rejects a step-up token belonging to a different user (sub mismatch), even with a matching parentJti", async () => {
    const { guard } = makeGuard(REQUIREMENT);
    const accessClaims = { sub: "user-VICTIM", jti: "shared-jti", tenantId: "acme", role: "admin" };
    const stepUpToken = signPimJwt({
      sub: "user-ATTACKER",
      tenantId: "acme",
      tokenType: "step_up",
      stepUpScope: STEP_UP_SCOPE_AUTH_CONFIG_HIGH_RISK,
      parentJti: "shared-jti",
    });
    const context = makeContext({
      headers: { [PIM_STEP_UP_TOKEN_HEADER]: `Bearer ${stepUpToken}` },
      pimJwtClaims: accessClaims,
    });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      response: { error: "STEP_UP_TOKEN_SESSION_MISMATCH" },
    });
  });

  it("rejects a step-up token from a different tenant (cross-tenant step-up token reuse)", async () => {
    const { guard } = makeGuard(REQUIREMENT);
    const accessClaims = { sub: "user-1", jti: "access-jti-1", tenantId: "tenant-victim", role: "admin" };
    const stepUpToken = signPimJwt({
      sub: "user-1",
      tenantId: "tenant-attacker",
      tokenType: "step_up",
      stepUpScope: STEP_UP_SCOPE_AUTH_CONFIG_HIGH_RISK,
      parentJti: "access-jti-1",
    });
    const context = makeContext({
      headers: { [PIM_STEP_UP_TOKEN_HEADER]: `Bearer ${stepUpToken}` },
      pimJwtClaims: accessClaims,
    });

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      response: { error: "STEP_UP_TOKEN_SESSION_MISMATCH" },
    });
  });

  it("allows the request when every binding check matches: same session, same user, same tenant, matching scope, not revoked", async () => {
    const { guard, jwtBlocklistService } = makeGuard(REQUIREMENT);
    const accessClaims = { sub: "user-1", jti: "access-jti-1", tenantId: "acme", role: "admin" };
    const stepUpToken = signPimJwt({
      sub: "user-1",
      tenantId: "acme",
      tokenType: "step_up",
      stepUpScope: STEP_UP_SCOPE_AUTH_CONFIG_HIGH_RISK,
      parentJti: "access-jti-1",
    });
    const context = makeContext({
      headers: { [PIM_STEP_UP_TOKEN_HEADER]: `Bearer ${stepUpToken}` },
      pimJwtClaims: accessClaims,
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(jwtBlocklistService.isRevoked).toHaveBeenCalledWith(expect.any(String));
  });

  it("accepts the step-up token header without a literal 'Bearer ' prefix too", async () => {
    const { guard } = makeGuard(REQUIREMENT);
    const accessClaims = { sub: "user-1", jti: "access-jti-1", tenantId: "acme", role: "admin" };
    const stepUpToken = signPimJwt({
      sub: "user-1",
      tenantId: "acme",
      tokenType: "step_up",
      stepUpScope: STEP_UP_SCOPE_AUTH_CONFIG_HIGH_RISK,
      parentJti: "access-jti-1",
    });
    const context = makeContext({
      headers: { [PIM_STEP_UP_TOKEN_HEADER]: stepUpToken },
      pimJwtClaims: accessClaims,
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });
});
