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
