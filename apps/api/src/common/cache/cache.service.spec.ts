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

// A live TCP connection with a stalled/unresponsive Redis server (a "zombie"
// connection — never errors, never closes, just never answers) isn't caught by
// connectTimeout, which only bounds the initial connect(). Every command that
// touches an already-established client must degrade to the in-memory
// fallback within REDIS_COMMAND_TIMEOUT_MS instead of hanging the caller
// forever — the same class of bug already fixed for onModuleDestroy()'s
// quit() (PIM#817-outage-proof), now closing the gap for the read/write path
// that's actually on every request.
describe("CacheService — bounded Redis commands so a zombie connection can't hang a request", () => {
  function seedZombieClient(service: CacheService, overrides: Record<string, unknown> = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- seeding private connection state for the test
    const svc = service as any;
    svc.redisClient = {
      get: jest.fn(() => new Promise(() => {})),
      setEx: jest.fn(() => new Promise(() => {})),
      del: jest.fn(() => new Promise(() => {})),
      info: jest.fn(() => new Promise(() => {})),
      scanIterator: jest.fn(() => ({
        [Symbol.asyncIterator]: () => ({ next: () => new Promise(() => {}) }),
      })),
      ...overrides,
    };
    svc.redisAvailable = true;
  }

  it("getOrSet falls through to the producer when get() never resolves", async () => {
    const service = new CacheService();
    seedZombieClient(service);
    const producer = jest.fn().mockResolvedValue("fresh-value");

    const start = Date.now();
    const result = await service.getOrSet("k", 60, producer);
    const elapsedMs = Date.now() - start;

    expect(result).toBe("fresh-value");
    expect(producer).toHaveBeenCalledTimes(1);
    expect(elapsedMs).toBeLessThan(5_000);
  });

  it("getOrSet still returns the fresh value even when the follow-up setEx() also never resolves", async () => {
    const service = new CacheService();
    seedZombieClient(service);
    const producer = jest.fn().mockResolvedValue("fresh-value");

    await expect(service.getOrSet("k", 60, producer)).resolves.toBe("fresh-value");
  });

  it("a zombie get() marks Redis unavailable so the very next call skips straight to in-memory", async () => {
    const service = new CacheService();
    seedZombieClient(service);
    const producer = jest.fn().mockResolvedValue("fresh-value");

    await service.getOrSet("k", 60, producer);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((service as any).redisAvailable).toBe(false);
  });

  it("invalidate() resolves within the timeout bound when del() never settles", async () => {
    const service = new CacheService();
    seedZombieClient(service);

    const start = Date.now();
    await service.invalidate("k");
    expect(Date.now() - start).toBeLessThan(5_000);
  });

  it("invalidateByPrefix() resolves within its (longer, multi-round-trip) bound when scanIterator never yields", async () => {
    const service = new CacheService();
    seedZombieClient(service);

    const start = Date.now();
    await service.invalidateByPrefix("prefix");
    expect(Date.now() - start).toBeLessThan(15_000);
  }, 20_000);

  it("getHealthSnapshot() returns unavailable within the timeout bound when info() never resolves", async () => {
    const service = new CacheService();
    seedZombieClient(service);

    const start = Date.now();
    await expect(service.getHealthSnapshot()).resolves.toEqual({ available: false });
    expect(Date.now() - start).toBeLessThan(5_000);
  });

  it("a healthy (fast) Redis client is unaffected — getOrSet still reads through cache normally", async () => {
    const service = new CacheService();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const svc = service as any;
    svc.redisClient = {
      get: jest.fn().mockResolvedValue(JSON.stringify("cached-value")),
      setEx: jest.fn().mockResolvedValue("OK"),
    };
    svc.redisAvailable = true;
    const producer = jest.fn().mockResolvedValue("fresh-value");

    const result = await service.getOrSet("k", 60, producer);

    expect(result).toBe("cached-value");
    expect(producer).not.toHaveBeenCalled();
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
