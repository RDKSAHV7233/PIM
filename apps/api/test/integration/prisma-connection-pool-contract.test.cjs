#!/usr/bin/env node
/* eslint-disable no-console */
//
// STATUS: retained as a structural contract test (not superseded)
//
// The invariants here — DATABASE_URL_POOLED preference, per-tenant Map
// caching, application_name injection, RLS tenant key, onModuleDestroy
// disconnect — are infrastructure concerns that require a real PostgreSQL
// connection to exercise behaviorally.  Source-text scanning is an acceptable
// trade-off for these structural checks because:
//   1. The patterns verified are load-bearing (changing them silently would
//      break connection pooling or RLS in production).
//   2. Bringing up a real DB in unit-test scope is disproportionate cost.
//
// If a test environment with a real PG is ever available, this file should
// be replaced with a proper integration test that exercises PrismaService
// directly and observes pg_stat_activity.
//
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PRISMA_SERVICE = path.join(
  REPO_ROOT,
  "apps",
  "api",
  "src",
  "prisma",
  "prisma.service.ts",
);
const PRISMA_DIRECT_SERVICE = path.join(
  REPO_ROOT,
  "apps",
  "api",
  "src",
  "prisma",
  "prisma-direct.service.ts",
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const pooled = fs.readFileSync(PRISMA_SERVICE, "utf8");
  const direct = fs.readFileSync(PRISMA_DIRECT_SERVICE, "utf8");

  // --- PrismaService (pooled path) ---

  // Must prefer DATABASE_URL_POOLED over DATABASE_URL so pgBouncer/Prisma Accelerate
  // is used for normal request-path queries.
  assert(
    pooled.includes("DATABASE_URL_POOLED") && pooled.includes("DATABASE_URL"),
    "PrismaService must read DATABASE_URL_POOLED with DATABASE_URL fallback.",
  );
  assert(
    pooled.includes("DATABASE_URL_POOLED ?? process.env.DATABASE_URL"),
    "PrismaService must fall back to DATABASE_URL when DATABASE_URL_POOLED is unset.",
  );

  // Per-tenant client caching via Map prevents a new PrismaClient per request.
  assert(
    pooled.includes("new Map<string, PrismaClient>()"),
    "PrismaService must maintain a per-tenant client Map to avoid creating new connections per request.",
  );
  assert(
    pooled.includes("this.clients.get(") && pooled.includes("this.clients.set("),
    "PrismaService must read from and write to the client Map (cache hit / miss paths).",
  );

  // application_name injection — allows pg_stat_activity to identify pool connections.
  assert(
    pooled.includes("DB_POOL_APP_NAME"),
    "PrismaService must support DB_POOL_APP_NAME env var for identifying pool connections.",
  );
  assert(
    pooled.includes("application_name="),
    "PrismaService must inject application_name into connection strings.",
  );
  assert(
    pooled.includes("poolApplicationName"),
    "PrismaService must store the pool application name as a class field.",
  );

  // app.tenant_key injection — drives RLS policies on the database.
  assert(
    pooled.includes("app.tenant_key="),
    "PrismaService must inject app.tenant_key into connection options for RLS.",
  );
  assert(
    pooled.includes("withTenantDatabaseUrl"),
    "PrismaService must call withTenantDatabaseUrl to scope connections per tenant.",
  );

  // getPoolStats() must query pg_stat_activity to expose live connection counts.
  assert(
    pooled.includes("async getPoolStats()"),
    "PrismaService must expose getPoolStats() for connection pool observability.",
  );
  assert(
    pooled.includes("pg_stat_activity"),
    "getPoolStats must query pg_stat_activity for live connection counts.",
  );
  assert(
    pooled.includes("active") && pooled.includes("idle") && pooled.includes("waiting"),
    "getPoolStats must return active, idle, and waiting connection counts.",
  );

  // onModuleDestroy must disconnect ALL cached tenant clients.
  assert(
    pooled.includes("this.clients.values()") && pooled.includes("$disconnect"),
    "PrismaService.onModuleDestroy must disconnect all cached tenant clients.",
  );
  assert(
    pooled.includes("this.clients.clear()"),
    "PrismaService.onModuleDestroy must clear the client Map after disconnecting.",
  );

  // --- PrismaDirectService (direct/migration path) ---

  // Must prefer DATABASE_URL_DIRECT to bypass pgBouncer for long-running
  // transactions and schema migrations (incompatible with connection pooling).
  assert(
    direct.includes("DATABASE_URL_DIRECT") && direct.includes("DATABASE_URL"),
    "PrismaDirectService must read DATABASE_URL_DIRECT with DATABASE_URL fallback.",
  );
  assert(
    direct.includes("DATABASE_URL_DIRECT ?? process.env.DATABASE_URL"),
    "PrismaDirectService must fall back to DATABASE_URL when DATABASE_URL_DIRECT is unset.",
  );

  // Direct service is a single shared client — no per-tenant caching needed.
  assert(
    direct.includes("private readonly client: PrismaClient"),
    "PrismaDirectService must hold a single PrismaClient (not a per-tenant Map).",
  );
  assert(
    direct.includes("getClient()"),
    "PrismaDirectService must expose getClient() for direct DB access.",
  );
  assert(
    !direct.includes("new Map<"),
    "PrismaDirectService must NOT use a per-tenant client Map — it is a single shared direct client.",
  );

  // onModuleDestroy must disconnect.
  assert(
    direct.includes("this.client.$disconnect()"),
    "PrismaDirectService.onModuleDestroy must disconnect the direct client.",
  );

  // Both services guard against initializing connections when not in db auth mode.
  assert(
    pooled.includes('AUTH_MODE') && pooled.includes('"db"'),
    "PrismaService.onModuleInit must skip connecting when AUTH_MODE is not 'db'.",
  );
  assert(
    direct.includes('AUTH_MODE') && direct.includes('"db"'),
    "PrismaDirectService.onModuleInit must skip connecting when AUTH_MODE is not 'db'.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "prisma_pooled_prefers_database_url_pooled",
          "prisma_pooled_per_tenant_client_map_caching",
          "prisma_pooled_application_name_injection",
          "prisma_pooled_db_pool_app_name_env_support",
          "prisma_pooled_rls_tenant_key_injection",
          "prisma_pooled_get_pool_stats_pg_stat_activity",
          "prisma_pooled_destroy_disconnects_all_tenant_clients",
          "prisma_direct_prefers_database_url_direct",
          "prisma_direct_single_shared_client_no_tenant_map",
          "prisma_direct_destroy_disconnects",
          "both_services_guard_auth_mode_db_on_init",
        ],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

try {
  run();
} catch (error) {
  console.error("Prisma connection pool contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
