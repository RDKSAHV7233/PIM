// DEF-PC-007: a throttled (429) response must carry the standard Retry-After header,
// not only the library's per-throttler `Retry-After-<name>` variant.

import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ThrottlerException } from "@nestjs/throttler";
import { IdentityThrottlerGuard } from "./identity-throttler.guard";
import { PreAuthIpThrottlerGuard } from "./pre-auth-ip-throttler.guard";

class InMemoryThrottlerStorage {
  private readonly hits = new Map<string, number>();

  async increment(key: string, _ttl: number, limit: number) {
    const totalHits = (this.hits.get(key) ?? 0) + 1;
    this.hits.set(key, totalHits);
    return {
      totalHits,
      timeToExpire: 42,
      isBlocked: totalHits > limit,
      timeToBlockExpire: totalHits > limit ? 37 : 0,
    };
  }
}

const OPTIONS = [
  { name: "ip", ttl: 60_000, limit: 1 },
  { name: "user", ttl: 60_000, limit: 1 },
  { name: "tenant", ttl: 60_000, limit: 999 },
  { name: "apiKey", ttl: 60_000, limit: 999 },
  { name: "tenantApi", ttl: 60_000, limit: 999 },
];

function makeContext(request: Record<string, unknown>, header: jest.Mock): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({ name: "TestController" }),
    switchToHttp: () => ({
      getRequest: () => ({ ip: "1.2.3.4", headers: {}, ...request }),
      getResponse: () => ({ header }),
    }),
  } as unknown as ExecutionContext;
}

describe("standard Retry-After on throttled responses", () => {
  it("PreAuthIpThrottlerGuard sets Retry-After (seconds) next to the per-throttler header", async () => {
    const guard = new PreAuthIpThrottlerGuard(OPTIONS as never, new InMemoryThrottlerStorage() as never, new Reflector());
    await guard.onModuleInit();
    const header = jest.fn();

    await expect(guard.canActivate(makeContext({}, header))).resolves.toBe(true);
    expect(header).not.toHaveBeenCalledWith("Retry-After", expect.anything());

    await expect(guard.canActivate(makeContext({}, header))).rejects.toThrow(ThrottlerException);
    expect(header).toHaveBeenCalledWith("Retry-After-ip", 37);
    expect(header).toHaveBeenCalledWith("Retry-After", "37");
  });

  it("IdentityThrottlerGuard sets Retry-After too", async () => {
    const guard = new IdentityThrottlerGuard(OPTIONS as never, new InMemoryThrottlerStorage() as never, new Reflector());
    await guard.onModuleInit();
    const header = jest.fn();
    const principal = { pimAuthType: "user_jwt", pimTenant: "t1", pimUserId: "u1" };

    await guard.canActivate(makeContext(principal, header));
    await expect(guard.canActivate(makeContext(principal, header))).rejects.toThrow(ThrottlerException);
    expect(header).toHaveBeenCalledWith("Retry-After", "37");
  });
});
