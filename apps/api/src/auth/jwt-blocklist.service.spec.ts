import { JwtBlocklistService } from "./jwt-blocklist.service";

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
