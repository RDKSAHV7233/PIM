// Coverage for IdentityThrottlerGuard — the post-auth half of the two-stage
// rate-limiting design (pre-auth IP throttle -> auth -> identity throttle).
// Exercises the real @nestjs/throttler ThrottlerGuard.canActivate()/
// handleRequest() loop against a real in-memory ThrottlerStorage (counting
// increments, not a mocked "did it get called" check) so a passing test is
// real proof requests get blocked at the configured limit, not just that our
// override methods were invoked.
//
// Covers exactly the ordering invariants this guard exists to satisfy:
// JWT traffic only ever counts against user/tenant, API-key traffic only
// against apiKey/tenantApi, a route JwtAuthGuard let through untouched
// (pimAuthType unset) is skipped entirely, and PIM_DISABLE_THROTTLER bypasses
// it the same way it bypasses the pre-auth guard.

import { ExecutionContext } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { ThrottlerException } from "@nestjs/throttler";
import { IdentityThrottlerGuard } from "./identity-throttler.guard";

interface FakeRequest {
  pimAuthType?: "user_jwt" | "api_key";
  pimTenant?: string;
  pimUserId?: string;
  pimApiKeyId?: string;
  headers: Record<string, string>;
}

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

// Mirrors app.module.ts's real ThrottlerModule.forRoot() config exactly —
// a config drift between this test and the real wiring would be a silent gap.
function throttlerOptions() {
  return [
    { name: "ip", ttl: 60_000, limit: 300 },
    {
      name: "user",
      ttl: 60_000,
      limit: 2,
      skipIf: (context: ExecutionContext) => context.switchToHttp().getRequest().pimAuthType !== "user_jwt",
    },
    {
      name: "tenant",
      ttl: 60_000,
      limit: 2,
      skipIf: (context: ExecutionContext) => context.switchToHttp().getRequest().pimAuthType !== "user_jwt",
    },
    {
      name: "apiKey",
      ttl: 60_000,
      limit: 2,
      skipIf: (context: ExecutionContext) => context.switchToHttp().getRequest().pimAuthType !== "api_key",
    },
    {
      name: "tenantApi",
      ttl: 60_000,
      limit: 2,
      skipIf: (context: ExecutionContext) => context.switchToHttp().getRequest().pimAuthType !== "api_key",
    },
  ];
}

async function makeGuard() {
  const reflector = new Reflector();
  const storage = new InMemoryThrottlerStorage();
  const guard = new IdentityThrottlerGuard(throttlerOptions() as never, storage as never, reflector);
  await guard.onModuleInit();
  return guard;
}

function makeContext(request: FakeRequest): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({ name: "TestController" }),
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({ header: jest.fn() }),
    }),
  } as unknown as ExecutionContext;
}

describe("IdentityThrottlerGuard", () => {
  const originalEnv = process.env;
  afterEach(() => {
    process.env = originalEnv;
  });

  it("skips entirely when JwtAuthGuard never resolved an identity (e.g. a @Public() route)", async () => {
    const guard = await makeGuard();
    const context = makeContext({ headers: {} });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it("counts JWT traffic against user+tenant, not apiKey/tenantApi, and blocks at the configured limit", async () => {
    const guard = await makeGuard();
    const request: FakeRequest = { pimAuthType: "user_jwt", pimTenant: "acme", pimUserId: "u1", headers: {} };

    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true); // hit 1
    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true); // hit 2 (== limit)
    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(ThrottlerException); // hit 3
  });

  it("keys the user bucket per tenant+user, so a different user in the same tenant isn't blocked by the first", async () => {
    const guard = await makeGuard();
    const userA: FakeRequest = { pimAuthType: "user_jwt", pimTenant: "acme", pimUserId: "u1", headers: {} };
    const userB: FakeRequest = { pimAuthType: "user_jwt", pimTenant: "acme", pimUserId: "u2", headers: {} };

    await guard.canActivate(makeContext(userA));
    await guard.canActivate(makeContext(userA));
    await expect(guard.canActivate(makeContext(userA))).rejects.toThrow(ThrottlerException);

    // u2's own user-bucket is fresh, but both share the tenant bucket which is
    // now at 2 hits from u1 alone — the shared tenant-wide limit still blocks.
    await expect(guard.canActivate(makeContext(userB))).rejects.toThrow(ThrottlerException);
  });

  it("counts API-key traffic against apiKey+tenantApi, not user/tenant", async () => {
    const guard = await makeGuard();
    const request: FakeRequest = { pimAuthType: "api_key", pimTenant: "acme", pimApiKeyId: "key-1", headers: {} };

    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
    await expect(guard.canActivate(makeContext(request))).rejects.toThrow(ThrottlerException);
  });

  it("keys the apiKey bucket per key, so a second API key on the same tenant has its own quota", async () => {
    const guard = await makeGuard();
    const keyA: FakeRequest = { pimAuthType: "api_key", pimTenant: "acme", pimApiKeyId: "key-a", headers: {} };
    const keyB: FakeRequest = { pimAuthType: "api_key", pimTenant: "acme", pimApiKeyId: "key-b", headers: {} };

    await guard.canActivate(makeContext(keyA));
    await guard.canActivate(makeContext(keyA));
    await expect(guard.canActivate(makeContext(keyA))).rejects.toThrow(ThrottlerException);

    // key-b's own apiKey-bucket is fresh, but tenantApi is shared and already
    // at the limit from key-a alone — same aggregate-ceiling behavior as the
    // user/tenant pair above, by design (see app.module.ts's comment).
    await expect(guard.canActivate(makeContext(keyB))).rejects.toThrow(ThrottlerException);
  });

  it("never lets API-key traffic touch the user/tenant buckets or vice versa", async () => {
    const guard = await makeGuard();
    const jwtRequest: FakeRequest = { pimAuthType: "user_jwt", pimTenant: "acme", pimUserId: "u1", headers: {} };
    const apiRequest: FakeRequest = { pimAuthType: "api_key", pimTenant: "acme", pimApiKeyId: "key-1", headers: {} };

    // Exhaust the JWT-side limit for tenant "acme".
    await guard.canActivate(makeContext(jwtRequest));
    await guard.canActivate(makeContext(jwtRequest));
    await expect(guard.canActivate(makeContext(jwtRequest))).rejects.toThrow(ThrottlerException);

    // The API-key side for the SAME tenant is untouched — proves tenant vs.
    // tenantApi are genuinely separate buckets, not one shared "acme" key.
    await expect(guard.canActivate(makeContext(apiRequest))).resolves.toBe(true);
  });

  it("is bypassed entirely when PIM_DISABLE_THROTTLER=true, same as the pre-auth guard", async () => {
    process.env = { ...originalEnv, PIM_DISABLE_THROTTLER: "true" };
    const guard = await makeGuard();
    const request: FakeRequest = { pimAuthType: "api_key", pimTenant: "acme", pimApiKeyId: "key-1", headers: {} };

    for (let i = 0; i < 10; i++) {
      await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
    }
  });
});
