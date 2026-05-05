#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * JWT Blocklist Contract Test
 *
 * Validates the JwtBlocklistService behavioral contract:
 * 1. In-memory revocation works without Redis (JWT_BLOCKLIST_REDIS_DISABLED=true)
 * 2. Graceful degradation: when Redis URL points to a port with no listener,
 *    the service falls back to in-memory and still blocks revoked tokens within
 *    the same process lifetime.
 * 3. Tokens not in the blocklist are correctly reported as NOT revoked.
 *
 * This test does NOT require a live Redis instance.
 * The production Redis path (cross-process persistence) must be verified in staging
 * with a live Redis instance using the auth-revocation integration test.
 */
"use strict";

const path = require("node:path");
const fs = require("node:fs");

const DIST_ROOT = path.resolve(__dirname, "../../dist");
const BLOCKLIST_MODULE = path.join(DIST_ROOT, "auth", "jwt-blocklist.service.js");

const results = [];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function makeService(redisDisabled) {
  // Clear module cache so each test gets a fresh service with fresh env.
  Object.keys(require.cache).forEach((key) => {
    if (key.includes("jwt-blocklist")) {
      delete require.cache[key];
    }
  });
  process.env.JWT_BLOCKLIST_REDIS_DISABLED = redisDisabled ? "true" : "false";
  // Use a port with no listener to force immediate Redis failure in non-disabled case.
  process.env.REDIS_URL = "redis://127.0.0.1:6399";
  process.env.JWT_BLOCKLIST_KEY_PREFIX = "test_jti_contract:";
  const { JwtBlocklistService } = require(BLOCKLIST_MODULE);
  return new JwtBlocklistService();
}

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function testInMemoryRevocationBlocks() {
  const service = makeService(true);
  const jti = `jti-inmem-${Date.now()}`;

  assert(!(await service.isRevoked(jti)), "TOKEN_SHOULD_NOT_BE_REVOKED_BEFORE_REVOKE_CALLED");
  await service.revoke(jti, 60);
  assert(await service.isRevoked(jti), "TOKEN_MUST_BE_REVOKED_AFTER_REVOKE_CALLED");

  const unrelated = `jti-unrelated-${Date.now()}`;
  assert(!(await service.isRevoked(unrelated)), "UNRELATED_TOKEN_MUST_NOT_BE_REVOKED");

  // Clean shutdown in in-memory mode never hangs.
  await service.onModuleDestroy();
  results.push("in_memory_revocation_blocks_token");
}

async function testUnrelatedTokenNotAffected() {
  const service = makeService(true);
  const jtiA = `jti-a-${Date.now()}`;
  const jtiB = `jti-b-${Date.now()}`;

  await service.revoke(jtiA, 60);
  assert(await service.isRevoked(jtiA), "JTI_A_MUST_BE_REVOKED");
  assert(!(await service.isRevoked(jtiB)), "JTI_B_MUST_NOT_BE_REVOKED");

  await service.onModuleDestroy();
  results.push("unrelated_token_not_affected");
}

async function testGracefulDegradationInProcessRevocation() {
  // With Redis enabled but unreachable, in-memory revocations within the same
  // process lifetime must still block the token.
  const service = makeService(false);
  const jti = `jti-degrade-${Date.now()}`;

  // Revoke: stores in memory, attempts Redis (will fail silently and fall back).
  // We do NOT await the full revoke since it may hang waiting for Redis connection.
  // Instead, use a race with a 3s timeout to allow the Redis attempt to complete/fail.
  await Promise.race([
    service.revoke(jti, 60),
    sleep(3000),
  ]);

  // The in-memory blocklist must still report the token as revoked.
  // isRevoked checks in-memory first (fast path), so Redis state doesn't matter here.
  assert(await service.isRevoked(jti), "TOKEN_MUST_BE_REVOKED_IN_DEGRADED_MODE: in-memory fallback failed");

  // Do NOT call onModuleDestroy — the Redis client's quit() hangs when the
  // connection was never established (redis v5 behavior). The process will be
  // force-exited after all tests pass. This is acceptable for a contract test.
  results.push("graceful_degradation_when_redis_unreachable");
}

async function testZeroTtlClamped() {
  const service = makeService(true);
  const jti = `jti-ttl0-${Date.now()}`;

  // TTL=0 is clamped to max(1, ...) = 1 second internally.
  await service.revoke(jti, 0);
  assert(await service.isRevoked(jti), "ZERO_TTL_CLAMPED_MUST_STILL_BLOCK_IMMEDIATELY");

  await service.onModuleDestroy();
  results.push("zero_ttl_clamped_and_revokes_immediately");
}

async function run() {
  if (!fs.existsSync(BLOCKLIST_MODULE)) {
    throw new Error(
      `Compiled blocklist service not found at ${BLOCKLIST_MODULE}. Run: npm run build --workspace @pim1/api`,
    );
  }

  await testInMemoryRevocationBlocks();
  await testUnrelatedTokenNotAffected();
  await testGracefulDegradationInProcessRevocation();
  await testZeroTtlClamped();

  process.stdout.write(
    JSON.stringify(
      {
        status: "ok",
        suite: "jwt_blocklist_contract",
        validated: results,
        note: "Redis-backed cross-process revocation persistence must be verified in staging with a live Redis instance (auth-revocation integration test).",
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ) + "\n",
  );

  // Force exit to avoid hanging on the unreachable Redis client held by testGracefulDegradation.
  process.exit(0);
}

run().catch((error) => {
  process.stderr.write("JWT blocklist contract test failed:\n");
  process.stderr.write((error instanceof Error ? error.message : String(error)) + "\n");
  process.exit(1);
});
