import { CacheService, parseRedisHealthInfo } from "./cache.service";

describe("parseRedisHealthInfo", () => {
  it("parses the approved Redis INFO fields only", () => {
    const result = parseRedisHealthInfo(
      [
        "# Server",
        "redis_version:8.2.1",
        "# Clients",
        "connected_clients:36",
        "blocked_clients:10",
        "# Memory",
        "used_memory:5242880",
        "maxmemory:0",
        "maxmemory_policy:noeviction",
        "ignored:secret",
      ].join("\r\n"),
    );

    expect(result).toEqual({
      available: true,
      usedMemory: 5242880,
      maxMemory: 0,
      maxMemoryPolicy: "noeviction",
      blockedClients: 10,
      connectedClients: 36,
    });
    expect(Object.keys(result)).toEqual([
      "available",
      "usedMemory",
      "maxMemory",
      "maxMemoryPolicy",
      "blockedClients",
      "connectedClients",
    ]);
  });

  it("keeps missing fields as null while preserving available true", () => {
    expect(parseRedisHealthInfo("connected_clients:0\nmaxmemory:0")).toEqual({
      available: true,
      usedMemory: null,
      maxMemory: 0,
      maxMemoryPolicy: null,
      blockedClients: null,
      connectedClients: 0,
    });
  });

  it("returns null for malformed numeric fields instead of collapsing the snapshot", () => {
    expect(parseRedisHealthInfo("used_memory:not-a-number\nblocked_clients:\nmaxmemory_policy:allkeys-lru")).toEqual({
      available: true,
      usedMemory: null,
      maxMemory: null,
      maxMemoryPolicy: "allkeys-lru",
      blockedClients: null,
      connectedClients: null,
    });
  });
});

describe("CacheService.getHealthSnapshot", () => {
  it("returns unavailable when Redis cannot be reached", async () => {
    const previousDisabled = process.env.CACHE_REDIS_DISABLED;
    process.env.CACHE_REDIS_DISABLED = "true";
    try {
      const service = new CacheService();

      await expect(service.getHealthSnapshot()).resolves.toEqual({ available: false });
    } finally {
      if (previousDisabled === undefined) {
        delete process.env.CACHE_REDIS_DISABLED;
      } else {
        process.env.CACHE_REDIS_DISABLED = previousDisabled;
      }
    }
  });
});

// PIM#817-outage-proof follow-up: quit() on an already-established client can
// hang indefinitely if Redis becomes unreachable mid-shutdown (half-open
// socket, no QUIT response), blocking process exit. Bounded with the same
// 300ms Promise.race pattern auth.service.ts's onModuleDestroy() already uses.
describe("CacheService.onModuleDestroy — bounded quit() so shutdown can't hang", () => {
  it("resolves within the timeout bound even when quit() never settles, and still clears the client", async () => {
    const service = new CacheService();
    const quit = jest.fn(() => new Promise(() => {}));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- seeding private connection state for the test
    const svc = service as any;
    svc.redisClient = { quit };
    svc.redisAvailable = true;

    const start = Date.now();
    await service.onModuleDestroy();
    const elapsedMs = Date.now() - start;

    expect(quit).toHaveBeenCalledTimes(1);
    expect(elapsedMs).toBeLessThan(5_000);
    expect(svc.redisClient).toBeNull();
    expect(svc.redisAvailable).toBe(false);
  });

  it("still quits normally (no hang, no error) when quit() resolves quickly", async () => {
    const service = new CacheService();
    const quit = jest.fn().mockResolvedValue(undefined);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- seeding private connection state for the test
    const svc = service as any;
    svc.redisClient = { quit };

    await expect(service.onModuleDestroy()).resolves.toBeUndefined();

    expect(quit).toHaveBeenCalledTimes(1);
  });
});
