import { TenantContextMiddleware } from "./tenant-context.middleware";
import { getTenantKeyFromContext } from "./tenant-context";
import { signPimJwt } from "../../auth/jwt";

// Runs globally on every request (app.module.ts: forRoutes("*")), BEFORE
// guards — it establishes a provisional AsyncLocalStorage tenant context for
// anything that runs before TenantContextInterceptor re-establishes the
// guard-verified one (e.g. rate-limiting guards that read tenant context
// during the guard phase), and caches a resolved API key on the request for
// JwtAuthGuard to reuse without a second lookup. Zero prior test coverage.
// Tested against real signed JWTs, matching the interceptor's own
// tenant-context.interceptor.spec.ts convention.
describe("TenantContextMiddleware", () => {
  beforeAll(() => {
    process.env.JWT_SECRET = "test-jwt-secret-at-least-32-characters-long-for-hkdf-derive";
  });

  function makeMiddleware(resolveApiKey: jest.Mock = jest.fn()) {
    const apiKeysService = { resolveApiKey };
    const middleware = new TenantContextMiddleware(apiKeysService as never);
    return { middleware, apiKeysService };
  }

  it("uses a valid JWT's tenantId and never attempts an API-key lookup", async () => {
    const { middleware, apiKeysService } = makeMiddleware();
    const token = signPimJwt({ sub: "user-1", tenantId: "tenant-from-jwt" });
    const req = { headers: { authorization: `Bearer ${token}` } };
    let capturedTenant = "";

    await middleware.use(req as never, {} as never, () => {
      capturedTenant = getTenantKeyFromContext();
    });

    expect(capturedTenant).toBe("tenant-from-jwt");
    expect(apiKeysService.resolveApiKey).not.toHaveBeenCalled();
  });

  it("falls back to resolving an API key when there is no valid JWT, and caches the result on the request", async () => {
    const resolveApiKey = jest.fn().mockResolvedValue({
      keyId: "key-1",
      actorId: "svc-account-1",
      tenantId: "tenant-from-api-key",
      role: "admin",
      label: "CI integration",
    });
    const { middleware } = makeMiddleware(resolveApiKey);
    const req: Record<string, unknown> = { headers: { "x-pim-api-key": "pim_live_abc123" } };
    let capturedTenant = "";

    await middleware.use(req as never, {} as never, () => {
      capturedTenant = getTenantKeyFromContext();
    });

    expect(capturedTenant).toBe("tenant-from-api-key");
    expect(req.pimResolvedApiKey).toEqual(
      expect.objectContaining({ tenantId: "tenant-from-api-key", keyId: "key-1" }),
    );
  });

  it("falls back to the default tenant when neither a valid JWT nor a resolvable API key is present", async () => {
    const resolveApiKey = jest.fn().mockResolvedValue(null);
    const { middleware } = makeMiddleware(resolveApiKey);
    const req = { headers: {} };
    let capturedTenant = "";

    await middleware.use(req as never, {} as never, () => {
      capturedTenant = getTenantKeyFromContext();
    });

    expect(capturedTenant).toBe("default");
  });

  it("ignores a JWT with an invalid signature and falls through to the API-key path rather than trusting the unverified tenantId", async () => {
    const realToken = signPimJwt({ sub: "user-1", tenantId: "attacker-target-tenant" });
    const segments = realToken.split(".");
    const tamperedToken = `${segments[0]}.${segments[1]}.${segments[2].slice(0, -1)}${segments[2].slice(-1) === "A" ? "B" : "A"}`;
    const resolveApiKey = jest.fn().mockResolvedValue(null);
    const { middleware } = makeMiddleware(resolveApiKey);
    // Include an API-key header too, specifically to prove the fallback path
    // is actually attempted (not just that the tampered JWT's tenantId is
    // ignored) — without one here, resolveApiKey would trivially never be
    // called regardless of whether the fallback logic works at all.
    const req = { headers: { authorization: `Bearer ${tamperedToken}`, "x-pim-api-key": "pim_live_irrelevant" } };
    let capturedTenant = "";

    await middleware.use(req as never, {} as never, () => {
      capturedTenant = getTenantKeyFromContext();
    });

    expect(capturedTenant).not.toBe("attacker-target-tenant");
    expect(capturedTenant).toBe("default");
    // A tampered JWT still isn't a usable JWT, so the API-key path is attempted.
    expect(resolveApiKey).toHaveBeenCalledWith("pim_live_irrelevant");
  });

  it("a JWT takes precedence over a simultaneously-present API-key header", async () => {
    const resolveApiKey = jest.fn().mockResolvedValue({
      keyId: "key-1",
      actorId: "svc-1",
      tenantId: "tenant-from-api-key",
      role: "admin",
      label: "should not be used",
    });
    const { middleware } = makeMiddleware(resolveApiKey);
    const token = signPimJwt({ sub: "user-1", tenantId: "tenant-from-jwt" });
    const req = {
      headers: { authorization: `Bearer ${token}`, "x-pim-api-key": "pim_live_abc123" },
    };
    let capturedTenant = "";

    await middleware.use(req as never, {} as never, () => {
      capturedTenant = getTenantKeyFromContext();
    });

    expect(capturedTenant).toBe("tenant-from-jwt");
    expect(resolveApiKey).not.toHaveBeenCalled();
  });

  it("handles a multi-value authorization header (array) by using the first value", async () => {
    const { middleware } = makeMiddleware();
    const token = signPimJwt({ sub: "user-1", tenantId: "tenant-from-jwt" });
    const req = { headers: { authorization: [`Bearer ${token}`, "Bearer something-else"] } };
    let capturedTenant = "";

    await middleware.use(req as never, {} as never, () => {
      capturedTenant = getTenantKeyFromContext();
    });

    expect(capturedTenant).toBe("tenant-from-jwt");
  });

  it("establishes tenant context around the entire downstream chain, including work after a microtask boundary", async () => {
    const { middleware } = makeMiddleware();
    const token = signPimJwt({ sub: "user-1", tenantId: "tenant-async" });
    const req = { headers: { authorization: `Bearer ${token}` } };
    let capturedAfterAwait = "";

    await middleware.use(req as never, {} as never, () => {
      void Promise.resolve().then(() => {
        capturedAfterAwait = getTenantKeyFromContext();
      });
    });
    await new Promise((resolve) => setImmediate(resolve));

    expect(capturedAfterAwait).toBe("tenant-async");
  });
});
