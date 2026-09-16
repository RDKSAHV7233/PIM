#!/usr/bin/env node
/* eslint-disable no-console */
//
// Real-Redis-outage proof for #817's remaining P1-2 evidence gap
// ("Auth-revocation outage-behavior proof").
//
// docs/execution/AUTH_REVOCATION_DEGRADED_READ_ROUTE_INVENTORY_2026-09-05.md's
// "Remaining Runtime Proof" section lists exactly what this exercises. The
// existing jwt-auth.guard.spec.ts already covers this policy logic, but with
// a fully MOCKED JwtBlocklistService (`jest.fn().mockRejectedValue(...)`) —
// it has never observed the real `redis` npm client failing against a Redis
// process that is actually down. This script exercises the REAL
// JwtAuthGuard + REAL JwtBlocklistService (compiled from
// apps/api/src/auth/*, not reimplemented) against a real, isolated Redis
// container that gets genuinely stopped mid-run, plus the REAL AuthService
// refresh() path for the "refresh token during outage" checklist item.
//
// Isolation: points only at a throwaway Redis container on a non-standard
// port (16379) started/stopped by this script. Never touches the shared
// pim1-redis container or any real tenant. No Postgres/tenant data needed —
// AUTH_MODE is left unset (non-"db") so JwtAuthGuard.assertUserAccessActive
// short-circuits without a DB call, same as the existing guard spec's setup.
//
// Usage:
//   docker run -d --name p1-outage-proof-redis -p 16379:6379 redis:7
//   npm run build --workspace @pim1/api
//   node scripts/p1-auth-revocation-outage-proof.cjs
//   docker rm -f p1-outage-proof-redis
//
// Exits non-zero if any expected policy outcome does not match.

const path = require("node:path");
const crypto = require("node:crypto");
const { execSync } = require("node:child_process");

process.env.JWT_SECRET = process.env.JWT_SECRET || "p1-outage-proof-jwt-secret-min-32-chars";
process.env.REDIS_URL = "redis://localhost:16379";
delete process.env.AUTH_MODE;
delete process.env.JWT_BLOCKLIST_REDIS_DISABLED;

const REPO_ROOT = path.resolve(__dirname, "..");
const distRoot = path.join(REPO_ROOT, "apps", "api", "dist");

const { JwtAuthGuard } = require(path.join(distRoot, "auth", "jwt-auth.guard.js"));
const { JwtBlocklistService } = require(path.join(distRoot, "auth", "jwt-blocklist.service.js"));
const { AuthService } = require(path.join(distRoot, "auth", "auth.service.js"));
const { signPimJwt } = require(path.join(distRoot, "auth", "jwt.js"));
const { Reflector } = require("@nestjs/core");
const { ServiceUnavailableException } = require("@nestjs/common");

const ADMIN_BOUNDARY_ACCESS_KEY = "admin_boundary_access";
const READ_ACCESS_POLICY_KEY = "read_access_policy";
const AUTHENTICATED_READ_ROUTE_KEY = "authenticated_read_route";
const ROLES_KEY = "required_roles";
const STEP_UP_REQUIRED_KEY = "pim_step_up_required";

let pass = 0;
let fail = 0;
const failures = [];

function ok(label, condition, detail) {
  if (condition) {
    pass++;
    console.log(`  PASS  ${label}`);
  } else {
    fail++;
    failures.push(label);
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function makeContext(request) {
  return {
    getHandler: () => "handler",
    getClass: () => "class",
    switchToHttp: () => ({ getRequest: () => request }),
  };
}

function makeGuard(metadata, jwtBlocklistService) {
  const reflector = { getAllAndOverride: (key) => metadata[key] };
  const apiKeysService = { resolveApiKey: async () => null };
  const planUsageService = {
    getTenantPlanProfile: async (tenantKey) => ({ accessStatus: "active", tenantKey }),
  };
  const authPolicyService = {
    getEffectiveMfaPolicy: async () => ({ mfaRequired: false }),
  };
  return new JwtAuthGuard(reflector, jwtBlocklistService, apiKeysService, planUsageService, {}, authPolicyService);
}

function makeRequest(method, jti) {
  const token = signPimJwt({
    sub: "user1",
    tenantId: "tenant1",
    role: "viewer",
    jti,
    expiresInSeconds: 3600,
  });
  return {
    method,
    path: "/catalog/products",
    headers: { authorization: `Bearer ${token}` },
  };
}

function freshJti(label) {
  // Unique per call so JwtBlocklistService's 10s in-memory cache (keyed by
  // jti) can never short-circuit a real Redis round-trip across scenarios.
  return `${label}-${crypto.randomUUID()}`;
}

async function expectDeny(label, guard, request) {
  try {
    await guard.canActivate(makeContext(request));
    ok(label, false, "canActivate resolved instead of throwing");
  } catch (error) {
    const isSvcUnavailable = error instanceof ServiceUnavailableException;
    const body = isSvcUnavailable && typeof error.getResponse === "function" ? error.getResponse() : null;
    ok(
      label,
      isSvcUnavailable && body && body.error === "REVOCATION_AUTHORITY_UNAVAILABLE",
      `got ${error?.constructor?.name}: ${JSON.stringify(body ?? error?.message)}`,
    );
  }
}

async function expectAllow(label, guard, request) {
  try {
    const result = await guard.canActivate(makeContext(request));
    ok(label, result === true, `canActivate returned ${result}`);
  } catch (error) {
    ok(label, false, `threw instead of allowing: ${error?.constructor?.name}: ${error?.message}`);
  }
}

async function main() {
  const blocklist = new JwtBlocklistService();

  console.log("\n=== Phase 1: Redis UP (baseline sanity) ===");
  {
    const guard = makeGuard({}, blocklist);
    const request = makeRequest("GET", freshJti("baseline"));
    await expectAllow("baseline: unannotated GET with fresh token, Redis healthy", guard, request);
  }
  {
    const jti = freshJti("revoke-roundtrip");
    await blocklist.revoke(jti, 60);
    const revoked = await blocklist.isRevoked(jti);
    ok("baseline: revoke()+isRevoked() real Redis round-trip detects revocation", revoked === true);
  }

  console.log("\n=== Killing isolated Redis (p1-outage-proof-redis) ===");
  execSync("docker stop p1-outage-proof-redis", { stdio: "inherit" });
  // JwtBlocklistService's own connect-timeout (750ms) + retry backoff means
  // the first post-outage call pays the real connection-failure latency —
  // that's the real behavior being proven, not an artifact to wait out.

  console.log("\n=== Phase 2: Redis DOWN — JwtAuthGuard route-policy enforcement ===");

  await expectDeny(
    "mutating POST, no special metadata -> deny",
    makeGuard({}, blocklist),
    makeRequest("POST", freshJti("mutating")),
  );

  await expectDeny(
    "admin read route (self_service + admin role) -> deny",
    makeGuard(
      {
        [AUTHENTICATED_READ_ROUTE_KEY]: { classification: "self_service", responseHandling: "none" },
        [ROLES_KEY]: ["admin"],
      },
      blocklist,
    ),
    makeRequest("GET", freshJti("admin-read")),
  );

  await expectDeny(
    "step-up / security-sensitive read route -> deny",
    makeGuard(
      {
        [AUTHENTICATED_READ_ROUTE_KEY]: { classification: "self_service", responseHandling: "none" },
        [STEP_UP_REQUIRED_KEY]: { scope: "auth_config_high_risk", action: "update_auth_config" },
      },
      blocklist,
    ),
    makeRequest("GET", freshJti("step-up")),
  );

  await expectDeny(
    "admin-boundary read route -> deny",
    makeGuard(
      {
        [AUTHENTICATED_READ_ROUTE_KEY]: { classification: "self_service", responseHandling: "none" },
        [ADMIN_BOUNDARY_ACCESS_KEY]: { allowedRoles: ["system_admin"] },
      },
      blocklist,
    ),
    makeRequest("GET", freshJti("admin-boundary")),
  );

  await expectDeny(
    "unannotated / self_service-only read route -> deny (not on the approved list)",
    makeGuard(
      { [AUTHENTICATED_READ_ROUTE_KEY]: { classification: "self_service", responseHandling: "none" } },
      blocklist,
    ),
    makeRequest("GET", freshJti("self-service")),
  );

  await expectAllow(
    "taxonomy_safe_metadata read policy -> the ONE approved bounded degraded-read path",
    makeGuard(
      {
        [AUTHENTICATED_READ_ROUTE_KEY]: { classification: "scope_filtered", responseHandling: "none" },
        [READ_ACCESS_POLICY_KEY]: "taxonomy_safe_metadata",
      },
      blocklist,
    ),
    makeRequest("GET", freshJti("taxonomy-safe")),
  );

}

async function runRefreshProof() {
  console.log("\n=== Phase 2b: Redis DOWN — AuthService.refresh() fails closed ===");
  const blocklist = new JwtBlocklistService();
  // Real AuthService constructor calls this.queueService.process(...) twice
  // synchronously — needs a callable stub, not {}.
  const queueService = { process: () => {} };
  const authService = new AuthService(
    blocklist,
    {},
    {},
    {},
    {},
    queueService,
    {},
    {},
    {},
    {},
    {},
    {},
  );
  const refreshToken = signPimJwt({
    sub: "user1",
    tenantId: "tenant1",
    role: "viewer",
    tokenType: "refresh",
    jti: freshJti("refresh"),
    expiresInSeconds: 3600,
  });
  const result = await authService.refresh(refreshToken);
  ok(
    "AuthService.refresh() during Redis outage -> invalid_token (fail closed)",
    result && result.type === "invalid_token",
    `got ${JSON.stringify(result)}`,
  );
}

main()
  .then(runRefreshProof)
  .then(() => {
    console.log(`\n=== SUMMARY: ${pass} passed, ${fail} failed ===`);
    if (fail > 0) {
      console.log("Failed:", failures.join(", "));
    }
    // Explicit exit: abandoned redis-client objects from failed connection
    // attempts can leave background reconnect timers that would otherwise
    // keep the process alive; all assertions/output are already flushed by
    // this point, so a hard exit here is safe.
    process.exit(fail > 0 ? 1 : 0);
  })
  .catch((error) => {
    console.error("Proof script crashed:", error);
    process.exit(1);
  });
