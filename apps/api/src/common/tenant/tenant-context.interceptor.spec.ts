import { of, throwError, firstValueFrom, Observable } from "rxjs";
import type { CallHandler, ExecutionContext } from "@nestjs/common";
import { TenantContextInterceptor } from "./tenant-context.interceptor";
import { getTenantKeyFromContext } from "./tenant-context";
import { signPimJwt } from "../../auth/jwt";

// This interceptor decides which tenant's AsyncLocalStorage context every
// downstream ORM call and manually-filtered raw-SQL call runs under for the
// lifetime of an HTTP request — a bug here is a tenant-isolation bug by
// definition, so this is tested against real signed JWTs (not a mocked
// verifier) the same way jwt.step-up-scope.spec.ts does.
describe("TenantContextInterceptor", () => {
  beforeAll(() => {
    process.env.JWT_SECRET = "test-jwt-secret-at-least-32-characters-long-for-hkdf-derive";
  });

  function makeContext(type: "http" | "rpc" | "ws", request: Record<string, unknown>): ExecutionContext {
    return {
      getType: () => type,
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;
  }

  function makeHandlerCapturingContext(): { handler: CallHandler; capturedTenant: () => string } {
    let captured = "";
    const handler: CallHandler = {
      handle: () => {
        captured = getTenantKeyFromContext();
        return of("handler-result");
      },
    };
    return { handler, capturedTenant: () => captured };
  }

  it("bypasses tenant-context setup entirely for non-HTTP contexts (rpc/ws)", async () => {
    const interceptor = new TenantContextInterceptor();
    const context = makeContext("rpc", {});
    const handleSpy = jest.fn(() => of("rpc-result"));
    const handler: CallHandler = { handle: handleSpy };

    const result = await firstValueFrom(interceptor.intercept(context, handler));

    expect(result).toBe("rpc-result");
    expect(handleSpy).toHaveBeenCalledTimes(1);
  });

  it("uses request.pimTenant when already set by an auth guard, without needing a JWT at all", async () => {
    const interceptor = new TenantContextInterceptor();
    const { handler, capturedTenant } = makeHandlerCapturingContext();
    const context = makeContext("http", { pimTenant: "tenant-from-guard", headers: {} });

    await firstValueFrom(interceptor.intercept(context, handler));

    expect(capturedTenant()).toBe("tenant-from-guard");
  });

  it("request.pimTenant takes precedence over a JWT claim for a different tenant", async () => {
    const interceptor = new TenantContextInterceptor();
    const { handler, capturedTenant } = makeHandlerCapturingContext();
    const token = signPimJwt({ sub: "user-1", tenantId: "tenant-from-jwt" });
    const context = makeContext("http", {
      pimTenant: "tenant-from-guard",
      headers: { authorization: `Bearer ${token}` },
    });

    await firstValueFrom(interceptor.intercept(context, handler));

    expect(capturedTenant()).toBe("tenant-from-guard");
  });

  it("falls back to a valid JWT's tenantId when request.pimTenant is not set", async () => {
    const interceptor = new TenantContextInterceptor();
    const { handler, capturedTenant } = makeHandlerCapturingContext();
    const token = signPimJwt({ sub: "user-1", tenantId: "tenant-from-jwt" });
    const context = makeContext("http", { headers: { authorization: `Bearer ${token}` } });

    await firstValueFrom(interceptor.intercept(context, handler));

    expect(capturedTenant()).toBe("tenant-from-jwt");
  });

  it("falls back to the default tenant when neither pimTenant nor a valid JWT is present", async () => {
    const interceptor = new TenantContextInterceptor();
    const { handler, capturedTenant } = makeHandlerCapturingContext();
    const context = makeContext("http", { headers: {} });

    await firstValueFrom(interceptor.intercept(context, handler));

    expect(capturedTenant()).toBe("default");
  });

  it("ignores a JWT with an invalid signature — falls back to default, never trusts the unverified payload", async () => {
    const interceptor = new TenantContextInterceptor();
    const { handler, capturedTenant } = makeHandlerCapturingContext();
    const realToken = signPimJwt({ sub: "user-1", tenantId: "attacker-target-tenant" });
    // Tamper with the signature segment only — payload (including tenantId)
    // stays byte-identical, proving this is a signature check, not a shape
    // check that a well-formed-but-forged payload could slip past.
    const segments = realToken.split(".");
    const tamperedToken = `${segments[0]}.${segments[1]}.${segments[2].slice(0, -1)}${segments[2].slice(-1) === "A" ? "B" : "A"}`;
    const context = makeContext("http", { headers: { authorization: `Bearer ${tamperedToken}` } });

    await firstValueFrom(interceptor.intercept(context, handler));

    expect(capturedTenant()).not.toBe("attacker-target-tenant");
    expect(capturedTenant()).toBe("default");
  });

  it("ignores an expired JWT — falls back to default rather than trusting a stale tenantId", async () => {
    const interceptor = new TenantContextInterceptor();
    const { handler, capturedTenant } = makeHandlerCapturingContext();
    const now = Date.now();
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] }).setSystemTime(now);
    try {
      const token = signPimJwt({
        sub: "user-1",
        tenantId: "tenant-from-jwt",
        expiresInSeconds: 60,
        minimumExpiresInSeconds: 1,
      });
      jest.setSystemTime(now + 61_000); // past the 60s expiry
      const context = makeContext("http", { headers: { authorization: `Bearer ${token}` } });

      await firstValueFrom(interceptor.intercept(context, handler));

      expect(capturedTenant()).toBe("default");
    } finally {
      jest.useRealTimers();
    }
  });

  it("forwards next(), error(), and complete() from the wrapped handler to the subscriber", async () => {
    const interceptor = new TenantContextInterceptor();
    const context = makeContext("http", { headers: {} });
    const values: unknown[] = [];
    const handler: CallHandler = { handle: () => of("a", "b", "c") };

    await new Promise<void>((resolve, reject) => {
      interceptor.intercept(context, handler).subscribe({
        next: (v) => values.push(v),
        error: reject,
        complete: resolve,
      });
    });

    expect(values).toEqual(["a", "b", "c"]);
  });

  it("propagates an error from the wrapped handler to the subscriber's error callback", async () => {
    const interceptor = new TenantContextInterceptor();
    const context = makeContext("http", { headers: {} });
    const handler: CallHandler = { handle: () => throwError(() => new Error("downstream failure")) };

    await expect(firstValueFrom(interceptor.intercept(context, handler))).rejects.toThrow("downstream failure");
  });

  it("establishes tenant context around the ENTIRE downstream handler, including work after a microtask boundary", async () => {
    const interceptor = new TenantContextInterceptor();
    const context = makeContext("http", { pimTenant: "tenant-async" });
    let capturedAfterAwait = "";
    const handler: CallHandler = {
      handle: () =>
        new Observable((subscriber) => {
          // A microtask boundary (Promise.resolve().then(...)) is enough to
          // escape a plain synchronous call stack — proves the
          // AsyncLocalStorage-backed context survives past that boundary,
          // not just the interceptor's own synchronous call frame.
          Promise.resolve().then(() => {
            capturedAfterAwait = getTenantKeyFromContext();
            subscriber.next("done");
            subscriber.complete();
          });
        }),
    };

    await firstValueFrom(interceptor.intercept(context, handler));

    expect(capturedAfterAwait).toBe("tenant-async");
  });
});
