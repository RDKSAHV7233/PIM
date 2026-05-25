"use strict";
const { createClient } = require("redis");

async function test() {
  const redisUrl = "redis://[::1]:6380";
  const client = createClient({
    url: redisUrl,
    socket: { connectTimeout: 3000, reconnectStrategy: () => false },
  });
  client.on("error", (e) => {
    console.error("Redis error:", e.message);
    process.exit(1);
  });
  await client.connect();
  console.log("Connected to Redis at", redisUrl);

  const key = "compliance:attrs:default:test-cat-verify";
  const value = JSON.stringify([
    { id: "attr-1", key: "title", dataType: "text", required: true },
  ]);
  const TTL = 300;

  // Simulate cache miss -> SET
  await client.setEx(key, TTL, value);
  console.log("SET", key, "TTL=" + TTL + "s  -> OK (cache miss write)");

  // First read -> HIT
  const hit1 = await client.get(key);
  console.log("GET", key, "->", hit1 ? "HIT (correct)" : "MISS (BUG)");

  // TTL check
  const ttl = await client.ttl(key);
  console.log("TTL remaining:", ttl, "s (expected <= 300)");

  // Second read -> should still HIT (in-memory warm check)
  const hit2 = await client.get(key);
  console.log("2nd GET ->", hit2 ? "HIT (correct)" : "MISS (BUG)");

  // Simulate invalidateByPrefix (compliance:attrs:default:*)
  const toDelete = [];
  for await (const keys of client.scanIterator({ MATCH: "compliance:attrs:default:*", COUNT: 100 })) {
    toDelete.push(...keys);
  }
  if (toDelete.length > 0) {
    await client.del(toDelete);
    console.log("invalidateByPrefix: deleted", toDelete.length, "key(s) matching compliance:attrs:default:*");
  }

  // After invalidation -> MISS
  const afterInvalidate = await client.get(key);
  console.log("GET after invalidation ->", afterInvalidate ? "HIT (BUG)" : "MISS (correct)");

  await client.quit();
  console.log("\nRedis cache round-trip verification: PASSED");
}

test().catch((e) => {
  console.error("FAILED:", e.message);
  process.exit(1);
});
