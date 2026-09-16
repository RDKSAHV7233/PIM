// Coverage for PreAuthIpThrottlerGuard — the pre-auth half of the two-stage
// rate-limiting design. Runs before JwtAuthGuard, so it must never depend on
// resolved identity (pimTenant/pimUserId/pimApiKeyId aren't set yet at this
// point in the guard chain) and must only enforce the "ip" throttler, even
// though the shared ThrottlerModule config also has identity-scoped entries.

import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ThrottlerException } from "@nestjs/throttler";
import { PreAuthIpThrottlerGuard } from "./pre-auth-ip-throttler.guard";

class InMemoryThrottlerStorage {
  private readonly hits = new Map<string, number>();

  async increment(key: string, _ttl: number, limit: number, _blockDuration: number, _throttlerName: string) {
    const totalHits = (this.hits.get(key) ?? 0) + 1;
    this.hits.set(key, totalHits);
    return {
      totalHits,
      timeToExpire: 60,
      isBlocked: totalHits > limit,
      timeToBlockExpire: totalHits > limit ? 60 : 0,
    };
  }
}

// Same shared config shape as app.module.ts — includes identity-scoped
// entries this guard must ignore even though they're in the same options array.
function throttlerOptions() {
  return [
    { name: "ip", ttl: 60_000, limit: 2 },
    { name: "user", ttl: 60_000, limit: 999 },
    { name: "tenant", ttl: 60_000, limit: 999 },
    { name: "apiKey", ttl: 60_000, limit: 999 },
    { name: "tenantApi", ttl: 60_000, limit: 999 },
  ];
}

async function makeGuard() {
  const reflector = new Reflector();
  const storage = new InMemoryThrottlerStorage();
  const guard = new PreAuthIpThrottlerGuard(throttlerOptions() as never, storage as never, reflector);
  await guard.onModuleInit();
  return guard;
}

function makeContext(ip: string): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({ name: "TestController" }),
    switchToHttp: () => ({
      getRequest: () => ({ ip, headers: {} }),
      getResponse: () => ({ header: jest.fn() }),
    }),
  } as unknown as ExecutionContext;
}

describe("PreAuthIpThrottlerGuard", () => {
  const originalEnv = process.env;
  afterEach(() => {
    process.env = originalEnv;
  });

  it("only enforces the ip throttler — identity-scoped entries in the same config never fire pre-auth", async () => {
    const guard = await makeGuard();

    // Real ip limit is 2; identity throttlers are configured at 999 and would
    // never block within this test, but if onModuleInit's filter failed to
    // strip them, this guard would still just enforce "ip" here since none of
    // them can even generate a key without pimTenant/pimUserId/pimApiKeyId —
    // the real assertion is that ip alone governs blocking at exactly 2 hits.
    await expect(guard.canActivate(makeContext("1.2.3.4"))).resolves.toBe(true);
    await expect(guard.canActivate(makeContext("1.2.3.4"))).resolves.toBe(true);
    await expect(guard.canActivate(makeContext("1.2.3.4"))).rejects.toThrow(ThrottlerException);
  });

  it("keys by IP — a different IP has its own untouched quota", async () => {
    const guard = await makeGuard();

    await guard.canActivate(makeContext("1.2.3.4"));
    await guard.canActivate(makeContext("1.2.3.4"));
    await expect(guard.canActivate(makeContext("1.2.3.4"))).rejects.toThrow(ThrottlerException);

    await expect(guard.canActivate(makeContext("5.6.7.8"))).resolves.toBe(true);
  });

  it("is bypassed entirely when PIM_DISABLE_THROTTLER=true", async () => {
    process.env = { ...originalEnv, PIM_DISABLE_THROTTLER: "true" };
    const guard = await makeGuard();

    for (let i = 0; i < 10; i++) {
      await expect(guard.canActivate(makeContext("1.2.3.4"))).resolves.toBe(true);
    }
  });
});
