// Unit tests for PlanGuard — verifies HTTP 402 / PLAN_LIMIT_EXCEEDED is thrown
// when checkLimit returns allowed=false, and passes through when allowed=true.

import { HttpException, HttpStatus } from "@nestjs/common";
import { PlanGuard } from "./plan-guard.guard";

interface CheckLimitStub {
  allowed: boolean;
  resource: string;
  limit: number;
  current: number;
}

function makeGuard(checkLimitResult: CheckLimitStub) {
  const planUsageService = {
    checkLimit: jest.fn().mockResolvedValue(checkLimitResult),
  };
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(checkLimitResult.resource),
  };
  return new PlanGuard(reflector as never, planUsageService as never);
}

function makeContext(options: { pimTenant?: string; body?: Record<string, unknown> } = {}) {
  const request = {
    pimTenant: options.pimTenant ?? "acme",
    pimAdminBoundaryRoles: [],
    body: options.body ?? {},
    url: "/admin/api-keys",
    method: "POST",
  };
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({ getRequest: () => request }),
  };
}

describe("PlanGuard — HTTP 402 enforcement", () => {
  it("throws HTTP 402 with PLAN_LIMIT_EXCEEDED when checkLimit returns allowed=false", async () => {
    const guard = makeGuard({ allowed: false, resource: "api_keys", limit: 3, current: 4 });
    const ctx = makeContext();

    await expect(guard.canActivate(ctx as never)).rejects.toThrow(HttpException);

    try {
      await guard.canActivate(makeContext() as never);
    } catch (err) {
      expect(err).toBeInstanceOf(HttpException);
      const httpErr = err as HttpException;
      expect(httpErr.getStatus()).toBe(HttpStatus.PAYMENT_REQUIRED);
      const body = httpErr.getResponse() as Record<string, unknown>;
      expect(body.error).toBe("PLAN_LIMIT_EXCEEDED");
      expect(body.resource).toBe("api_keys");
      expect(body.limit).toBe(3);
      expect(body.current).toBe(4);
      expect(body.upgrade_url).toBe("/admin/plan");
    }
  });

  it("Growth tenant — 4th API key creation blocked: checkLimit current=4, limit=3 → 402", async () => {
    const guard = makeGuard({ allowed: false, resource: "api_keys", limit: 3, current: 4 });

    let caughtStatus: number | undefined;
    let caughtError: string | undefined;
    try {
      await guard.canActivate(makeContext() as never);
    } catch (err) {
      const httpErr = err as HttpException;
      caughtStatus = httpErr.getStatus();
      caughtError = (httpErr.getResponse() as Record<string, unknown>).error as string;
    }

    expect(caughtStatus).toBe(402);
    expect(caughtError).toBe("PLAN_LIMIT_EXCEEDED");
  });

  it("returns true (passes through) when checkLimit returns allowed=true", async () => {
    const guard = makeGuard({ allowed: true, resource: "api_keys", limit: 3, current: 2 });
    const result = await guard.canActivate(makeContext() as never);
    expect(result).toBe(true);
  });

  it("passes correct tenant key from request to checkLimit", async () => {
    const guard = makeGuard({ allowed: true, resource: "api_keys", limit: 3, current: 0 });
    const ctx = makeContext({ pimTenant: "tenant-xyz" });
    await guard.canActivate(ctx as never);

    const { planUsageService } = guard as never as { planUsageService: { checkLimit: jest.Mock } };
    expect(planUsageService.checkLimit).toHaveBeenCalledWith(
      "api_keys",
      1,
      "tenant-xyz",
      expect.anything(),
    );
  });

  it("bypasses all checks when no resource metadata is set on the handler", async () => {
    const planUsageService = { checkLimit: jest.fn() };
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(undefined) };
    const guard = new PlanGuard(reflector as never, planUsageService as never);
    const result = await guard.canActivate(makeContext() as never);
    expect(result).toBe(true);
    expect(planUsageService.checkLimit).not.toHaveBeenCalled();
  });

  it("boundary-role bypass: product_admin skips limit check entirely", async () => {
    const planUsageService = { checkLimit: jest.fn() };
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue("api_keys") };
    const guard = new PlanGuard(reflector as never, planUsageService as never);

    const request = {
      pimTenant: "acme",
      pimAdminBoundaryRoles: ["product_admin"],
      body: {},
      url: "/admin/api-keys",
      method: "POST",
    };
    const ctx = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => request }),
    };

    const result = await guard.canActivate(ctx as never);
    expect(result).toBe(true);
    expect(planUsageService.checkLimit).not.toHaveBeenCalled();
  });
});
