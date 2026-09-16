import { createClient } from "redis";
import { JwtBlocklistService } from "./jwt-blocklist.service";

jest.mock("redis", () => ({
  createClient: jest.fn(),
}));

// PIM#654 — revoke()'s Redis-write failure was caught and only logged (this.markRedisUnavailable),
// never reaching Error Authority. In a multi-instance deployment a token revoked on one instance
// that fails to persist to Redis still validates as active on every OTHER instance — a
// security-relevant degraded state that must be visible/alertable, not just a log line.
//
// The service manages its own Redis connection lifecycle internally rather than accepting an
// injected client, so these tests pre-seed the private redisAvailable/redisClient fields directly
// (a real Redis connection is never attempted) — the same "cast to any, touch private state"
// technique already used elsewhere in this codebase's specs for classes with self-managed
// internal state.
function makeService(setEx: jest.Mock) {
  const errorCaptureService = { captureUnexpected: jest.fn().mockResolvedValue(undefined) };
  const service = new JwtBlocklistService(errorCaptureService as never);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- seeding private connection state for the test
  const svc = service as any;
  svc.redisAvailable = true;
  svc.redisClient = { setEx };
  return { service, errorCaptureService };
}

function makeServiceWithClient(redisClient: Record<string, jest.Mock>) {
  const errorCaptureService = { captureUnexpected: jest.fn().mockResolvedValue(undefined) };
  const service = new JwtBlocklistService(errorCaptureService as never);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- seeding private connection state for the test
  const svc = service as any;
  svc.redisAvailable = true;
  svc.redisClient = redisClient;
  return { service, errorCaptureService };
}

describe("JwtBlocklistService.revoke — Error Authority capture on Redis-write failure (#654)", () => {
  it("captures the failure to Error Authority when the Redis write rejects", async () => {
    const setEx = jest.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const { service, errorCaptureService } = makeService(setEx);

    await service.revoke("jti-1", 3600);

    expect(setEx).toHaveBeenCalledTimes(1);
    expect(errorCaptureService.captureUnexpected).toHaveBeenCalledTimes(1);
    const args = errorCaptureService.captureUnexpected.mock.calls[0][0] as {
      severity: string;
      category: string;
      routeTemplate: string;
      runtime: string;
    };
    expect(args.severity).toBe("p1");
    expect(args.category).toBe("cache");
    expect(args.routeTemplate).toBe("jwt-blocklist:revoke");
    expect(args.runtime).toBe("api");
  });

  it("does not call Error Authority when the Redis write succeeds", async () => {
    const setEx = jest.fn().mockResolvedValue("OK");
    const { service, errorCaptureService } = makeService(setEx);

    await service.revoke("jti-2", 3600);

    expect(setEx).toHaveBeenCalledTimes(1);
    expect(errorCaptureService.captureUnexpected).not.toHaveBeenCalled();
  });

  it("still functions correctly (no throw) when errorCaptureService is not provided", async () => {
    const setEx = jest.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const service = new JwtBlocklistService(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- seeding private connection state for the test
    const svc = service as any;
    svc.redisAvailable = true;
    svc.redisClient = { setEx };

    await expect(service.revoke("jti-3", 3600)).resolves.toBeUndefined();
  });
});

describe("JwtBlocklistService revocation reads — fail closed on Redis read outage", () => {
  const originalDisabled = process.env.JWT_BLOCKLIST_REDIS_DISABLED;

  afterEach(() => {
    if (originalDisabled === undefined) {
      delete process.env.JWT_BLOCKLIST_REDIS_DISABLED;
    } else {
      process.env.JWT_BLOCKLIST_REDIS_DISABLED = originalDisabled;
    }
  });

  it("throws and captures when the JTI read rejects", async () => {
    delete process.env.JWT_BLOCKLIST_REDIS_DISABLED;
    const exists = jest.fn().mockRejectedValue(new Error("read reset"));
    const { service, errorCaptureService } = makeServiceWithClient({ exists });

    await expect(service.isRevoked("jti-read-failure")).rejects.toThrow("Auth service temporarily unavailable.");

    expect(errorCaptureService.captureUnexpected).toHaveBeenCalledTimes(1);
    expect(errorCaptureService.captureUnexpected.mock.calls[0][0]).toMatchObject({
      severity: "p1",
      category: "cache",
      routeTemplate: "jwt-blocklist:is-revoked",
      runtime: "api",
    });
  });

  it("throws and captures when the credential-revocation read rejects", async () => {
    delete process.env.JWT_BLOCKLIST_REDIS_DISABLED;
    const get = jest.fn().mockRejectedValue(new Error("read timeout"));
    const { service, errorCaptureService } = makeServiceWithClient({ get });

    await expect(service.isCredentialRevoked("tenant1", "user1", 123)).rejects.toThrow(
      "Auth service temporarily unavailable.",
    );

    expect(errorCaptureService.captureUnexpected).toHaveBeenCalledTimes(1);
    expect(errorCaptureService.captureUnexpected.mock.calls[0][0]).toMatchObject({
      severity: "p1",
      category: "cache",
      routeTemplate: "jwt-blocklist:is-credential-revoked",
      runtime: "api",
    });
  });

  it("still treats explicitly disabled Redis as local non-revoked mode", async () => {
    process.env.JWT_BLOCKLIST_REDIS_DISABLED = "true";
    const service = new JwtBlocklistService(undefined);

    await expect(service.isRevoked("jti-local")).resolves.toBe(false);
    await expect(service.isCredentialRevoked("tenant1", "user1", 123)).resolves.toBe(false);
  });
});

// P1-2 outage-proof finding (2026-09-16, #817 evidence-gathering session): a real
// isolated-Redis outage proof (not a mock) found that ensureRedisConnection()'s
// cleanup of a client whose FIRST-EVER connect attempt fails hung indefinitely.
// pendingClient.quit() sends a graceful QUIT command, which requires an
// established connection to send — a client stuck in a failed/never-settled
// connect attempt never reaches that state, so quit() never resolves and
// .catch(() => undefined) only handles rejection, not a promise that never
// settles at all. Every caller of ensureRedisConnection() — isRevoked(),
// isCredentialRevoked(), and transitively JwtAuthGuard.canActivate() for every
// authenticated request, and AuthService.refresh() — hung the same way, which
// is worse than the documented fail-closed policy: a hang ties up server
// resources instead of returning the bounded 503 the policy requires. Fixed
// by switching to disconnect(), which tears the socket down immediately
// regardless of connection state (verified in isolation: resolves in ~3ms
// against the same dead connection where quit() hadn't resolved after 15s+).
describe("JwtBlocklistService.ensureRedisConnection — cleanup after a failed first connection attempt", () => {
  afterEach(() => {
    jest.clearAllMocks();
  });

  it(
    "disconnects (not quit()s) a client whose connect() never settles, and still fails closed within the connect-timeout window",
    async () => {
      const disconnect = jest.fn().mockResolvedValue(undefined);
      // Never resolves — the real regression guard: if the implementation ever
      // goes back to calling quit() here, this assertion's surrounding
      // `isRevoked()` call would hang and this test would fail on Jest's own
      // test timeout, exactly reproducing the real outage-proof finding.
      const quit = jest.fn(() => new Promise(() => {}));
      const fakeClient = {
        // Also never resolves — matches the real reproduction, where the raw
        // `redis` client's own connect() promise did not settle on a dead
        // connection either; only the guard's own 1000ms race timeout ended
        // the attempt.
        connect: jest.fn(() => new Promise(() => {})),
        on: jest.fn(),
        disconnect,
        quit,
      };
      (createClient as jest.Mock).mockReturnValue(fakeClient);

      const service = new JwtBlocklistService(undefined);

      await expect(service.isRevoked("jti-outage-proof-regression")).rejects.toThrow(
        "Auth service temporarily unavailable.",
      );

      expect(disconnect).toHaveBeenCalledTimes(1);
      expect(quit).not.toHaveBeenCalled();
    },
    10_000,
  );
});

// PIM#817-outage-proof follow-up: the ensureRedisConnection() fix above only covers
// a client whose FIRST connect attempt fails. onModuleDestroy() quits an already
// -established client on graceful app shutdown, and that quit() can hang the same
// way if Redis becomes unreachable mid-shutdown (e.g. a half-open socket that never
// responds to QUIT) — worse here because it blocks the whole process from exiting,
// not just one request. Fixed by bounding the wait with the same 300ms
// Promise.race pattern auth.service.ts's onModuleDestroy() already uses.
describe("JwtBlocklistService.onModuleDestroy — bounded quit() so shutdown can't hang", () => {
  it(
    "resolves within the timeout bound even when quit() never settles, and still clears the client",
    async () => {
      const quit = jest.fn(() => new Promise(() => {}));
      const { service } = makeServiceWithClient({ quit });

      const start = Date.now();
      await service.onModuleDestroy();
      const elapsedMs = Date.now() - start;

      expect(quit).toHaveBeenCalledTimes(1);
      // Bounded by the 300ms race, not hanging indefinitely — generous upper
      // bound to avoid CI timing flakiness while still catching a regression
      // back to an unbounded `await quit()`.
      expect(elapsedMs).toBeLessThan(5_000);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- asserting private state was cleared
      expect((service as any).redisClient).toBeNull();
    },
    10_000,
  );

  it("still quits normally (no hang, no error) when quit() resolves quickly", async () => {
    const quit = jest.fn().mockResolvedValue(undefined);
    const { service } = makeServiceWithClient({ quit });

    await expect(service.onModuleDestroy()).resolves.toBeUndefined();

    expect(quit).toHaveBeenCalledTimes(1);
  });
});
