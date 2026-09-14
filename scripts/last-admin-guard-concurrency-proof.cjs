#!/usr/bin/env node
/* eslint-disable no-console */
//
// Real-Postgres concurrency proof for #816's last-admin guard.
//
// Exercises the ACTUAL WorkspaceUsersService.deactivateUser code (compiled
// from apps/api/src/workspace-users/workspace-users.service.ts), not a
// reimplementation, against an isolated Postgres database — the closest
// thing to a DB-backed integration test without booting the full NestJS HTTP
// server. Fires two concurrent deactivations at two DIFFERENT active admins
// (a write-skew shape: each request's own check sees "2 active admins" and
// neither individually looks unsafe, but if both proceed the tenant ends up
// with zero). Round 1 of the fix (Serializable transaction around a plain
// count) was disproven this way — Postgres's Serializable Snapshot Isolation
// missed the conflict 5/5 times under natural concurrent timing. Round 2
// (SELECT ... FOR UPDATE row locking before the count) held 15/15.
//
// Do NOT run this against a shared tenant (e.g. app.vexapim.com) — see the
// feedback-pim-shared-tenant-concurrency memory for why a live click-test on
// a tenant with concurrent automated writers can't be trusted for this class
// of bug. Use an isolated throwaway database instead:
//
//   docker exec pim1-postgres psql -U postgres -c "CREATE DATABASE pim1_last_admin_guard_proof;"
//   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/pim1_last_admin_guard_proof \
//     npx prisma migrate deploy --schema=packages/db/prisma/schema.prisma
//   npm run build --workspace @pim1/api
//   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/pim1_last_admin_guard_proof \
//     node scripts/last-admin-guard-concurrency-proof.cjs
//
// Exits non-zero if the bug reproduces on any run, so this can be wired into
// CI as a regression guard, not just a one-off manual check.

const path = require("node:path");
const { PrismaClient } = require("@prisma/client");

const REPO_ROOT = path.resolve(__dirname, "..");
const distRoot = path.join(REPO_ROOT, "apps", "api", "dist");
const { WorkspaceUsersService } = require(path.join(distRoot, "workspace-users", "workspace-users.service.js"));

const TENANT_KEY = "real-service-proof";

function makeStubs() {
  const audit = { record: async () => undefined };
  const planUsage = { getTenantPlanTier: async () => "ENTERPRISE", checkLimit: async () => ({ allowed: true, limit: 999, current: 0 }) };
  return { audit, planUsage };
}

async function resetTwoAdmins(prisma) {
  await prisma.authIdentity.deleteMany({ where: { OR: [{ tenantKey: TENANT_KEY }, { userId: { contains: "real-service-proof" } }] } });
  const a = await prisma.authIdentity.create({ data: { tenantKey: TENANT_KEY, userId: "admin-a@real-service-proof.test", role: "admin", isActive: true } });
  const b = await prisma.authIdentity.create({ data: { tenantKey: TENANT_KEY, userId: "admin-b@real-service-proof.test", role: "admin", isActive: true } });
  return [a.userId, b.userId];
}

async function main() {
  const prisma = new PrismaClient();
  const { audit, planUsage } = makeStubs();

  // Minimal PrismaService look-alike: `.tenant()` just returns our one real client.
  const prismaService = { tenant: () => prisma };

  const svc = new WorkspaceUsersService(prismaService, audit, planUsage);

  try {
    const [userA, userB] = await resetTwoAdmins(prisma);

    // Force the exact overlap: both deactivations start, both do their count
    // before either commits its update, by staggering start slightly and
    // letting the real transaction's natural round-trip latency create the
    // overlap (this is the real code path, so we don't control timing as
    // precisely as the raw proof — run it multiple times to get a real
    // distribution rather than a single sample).
    const RUNS = 15;
    const outcomes = [];
    for (let i = 0; i < RUNS; i++) {
      await resetTwoAdmins(prisma);
      const results = await Promise.allSettled([
        svc.deactivateUser(TENANT_KEY, "actor@real-service-proof.test", "admin", userA),
        svc.deactivateUser(TENANT_KEY, "actor@real-service-proof.test", "admin", userB),
      ]);
      const succeeded = results.filter((r) => r.status === "fulfilled").length;
      const rows = await prisma.authIdentity.findMany({ where: { tenantKey: TENANT_KEY, role: "admin" } });
      const finalActive = rows.filter((r) => r.isActive).length;
      const errors = results.filter((r) => r.status === "rejected").map((r) => {
        const e = r.reason;
        return e?.response?.error ?? e?.code ?? e?.message ?? String(e);
      });
      outcomes.push({ run: i + 1, succeeded, finalActive, errors });
      console.log(`Run ${i + 1}: succeeded=${succeeded} finalActiveAdmins=${finalActive} errors=${JSON.stringify(errors)}`);
    }

    const anyZero = outcomes.some((o) => o.finalActive === 0);
    console.log(`\n=== SUMMARY (real WorkspaceUsersService.deactivateUser, real Postgres, ${RUNS} runs) ===`);
    console.log(JSON.stringify(outcomes, null, 2));
    if (anyZero) {
      console.log("\nBUG REPRODUCIBLE via real service code — last-admin guard did not hold");
      process.exitCode = 1;
    } else {
      console.log(`\nGuard held across all ${RUNS} runs via real service code`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("FATAL:", err);
  process.exit(1);
});
