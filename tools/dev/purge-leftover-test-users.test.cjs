#!/usr/bin/env node
/* eslint-disable no-console */
// Logic test for purge-leftover-test-users.cjs — mocks fetch() so it runs
// with no network access and no real credentials. Covers the properties
// that actually matter for a tool that deletes production data:
//   - it discovers the FULL roster via pagination, never trusting a single
//     page (this is exactly the bug a first draft of this tool had — see
//     the header comment in purge-leftover-test-users.cjs for the story);
//   - a real, legitimately-deactivated human account is NEVER purged, in
//     either dry-run or --execute mode;
//   - dry-run mode makes zero purge calls;
//   - --execute purges exactly the synthetic-domain accounts, nothing more
//     and nothing less;
//   - a transient failure (500, then success) is retried rather than
//     aborting the whole run or silently dropping the account.

const assert = require("node:assert");
const path = require("node:path");

const SCRIPT_PATH = path.join(__dirname, "purge-leftover-test-users.cjs");

const PAGE1 = [
  { userId: "admin@realcompany.com", isActive: true, createdAt: "2026-01-01" },
  { userId: "ops-errors-viewer-1789977359019-678e4a7d@pim1.test", isActive: false, createdAt: "2026-09-21" },
  { userId: "ops-errors-viewer-1789976091666-be227fa9@pim1.test", isActive: false, createdAt: "2026-09-20" },
];
const PAGE2 = [
  { userId: "access-policy-editor-1758012345678-aaaa1111@vexa-pim.local", isActive: false, createdAt: "2026-09-16" },
  { userId: "access-policy-reviewer-1758012345678-bbbb2222@vexa-pim.local", isActive: false, createdAt: "2026-09-16" },
  // A real, legitimately-deactivated human — must survive every run of this tool.
  { userId: "editor2@realcompany.com", isActive: false, createdAt: "2026-02-02" },
];
const PAGE3 = [
  { userId: "e2e-editor-1789885836984-9205@pim1.test", isActive: false, createdAt: "2026-09-19" },
  { userId: "viewer@realcompany.com", isActive: true, createdAt: "2026-03-03" },
];

function jsonResponse(status, payload) {
  return { status, json: async () => payload };
}

function installMockFetch({ failFirstPurgeOf } = {}) {
  const purgeAttempts = {};
  const purgeCalls = [];
  let loginCalls = 0;

  global.fetch = async (url, opts) => {
    const u = new URL(url);
    if (u.pathname === "/api/v1/auth/login") {
      loginCalls += 1;
      return jsonResponse(201, { accessToken: "fake-token" });
    }
    if (u.pathname === "/api/v1/admin/workspace/users" && (!opts?.method || opts.method === "GET")) {
      const cursor = u.searchParams.get("cursor");
      if (!cursor) return jsonResponse(200, { items: PAGE1, limit: 200, nextCursor: "c2" });
      if (cursor === "c2") return jsonResponse(200, { items: PAGE2, limit: 200, nextCursor: "c3" });
      if (cursor === "c3") return jsonResponse(200, { items: PAGE3, limit: 200, nextCursor: null });
      throw new Error(`unexpected cursor ${cursor}`);
    }
    if (opts?.method === "DELETE" && u.pathname.endsWith("/purge")) {
      const userId = decodeURIComponent(u.pathname.split("/").slice(-2)[0]);
      purgeAttempts[userId] = (purgeAttempts[userId] || 0) + 1;
      purgeCalls.push(userId);
      if (failFirstPurgeOf === userId && purgeAttempts[userId] === 1) {
        return jsonResponse(500, { error: "INTERNAL_ERROR" });
      }
      return jsonResponse(200, { ok: true });
    }
    throw new Error(`unexpected fetch: ${opts?.method || "GET"} ${url}`);
  };

  return { purgeCalls, getLoginCalls: () => loginCalls };
}

async function withCapturedLogs(fn) {
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(" "));
  try {
    await fn();
  } finally {
    console.log = originalLog;
  }
  return logs.join("\n");
}

async function testDryRun() {
  const { purgeCalls } = installMockFetch();
  process.env.API_BASE = "https://fake-api.example";
  process.env.ADMIN_TOKEN = "provided-directly";
  process.argv = ["node", "script"]; // no --execute

  delete require.cache[require.resolve(SCRIPT_PATH)];
  const { main } = require(SCRIPT_PATH);
  const output = await withCapturedLogs(main);

  assert.match(output, /Total users: 8/, "should discover all 8 users across 3 pages");
  assert.match(output, /Inactive: 6/, "should count all 6 inactive users");
  assert.match(output, /Purgeable \(inactive \+ synthetic domain\): 5/, "should count exactly 5 purgeable");
  assert.match(output, /editor2@realcompany\.com/, "the real deactivated human must be listed for manual review");
  assert.match(output, /Dry run only/, "must announce dry-run, not purge");
  assert.strictEqual(purgeCalls.length, 0, "dry run must make zero purge calls");
  console.log("testDryRun passed");
}

async function testExecutePurgesOnlySyntheticAccounts() {
  const { purgeCalls } = installMockFetch();
  process.env.API_BASE = "https://fake-api.example";
  process.env.ADMIN_TOKEN = "provided-directly";
  process.argv = ["node", "script", "--execute"];

  delete require.cache[require.resolve(SCRIPT_PATH)];
  const { main } = require(SCRIPT_PATH);
  const output = await withCapturedLogs(main);

  assert.match(output, /Purging 5 accounts/, "should attempt exactly 5 purges");
  assert.match(output, /Done\. Purged 5\/5/, "all 5 should succeed against the mock");
  assert.strictEqual(purgeCalls.length, 5, "exactly 5 real purge calls must fire");
  assert.ok(
    !purgeCalls.includes("editor2@realcompany.com"),
    "the real deactivated human must never be purged, even with --execute",
  );
  assert.ok(
    purgeCalls.every((id) => id.endsWith("@pim1.test") || id.endsWith("@vexa-pim.local")),
    "every purged account must be a synthetic-domain account",
  );
  console.log("testExecutePurgesOnlySyntheticAccounts passed");
}

async function testTransientFailureIsRetriedNotDropped() {
  const flakyUserId = "e2e-editor-1789885836984-9205@pim1.test";
  const { purgeCalls } = installMockFetch({ failFirstPurgeOf: flakyUserId });
  process.env.API_BASE = "https://fake-api.example";
  process.env.ADMIN_TOKEN = "provided-directly";
  process.argv = ["node", "script", "--execute"];

  delete require.cache[require.resolve(SCRIPT_PATH)];
  const { main } = require(SCRIPT_PATH);
  const output = await withCapturedLogs(main);

  assert.match(output, /Done\. Purged 5\/5/, "a transient 500 should be retried, not counted as a permanent failure");
  const flakyAttempts = purgeCalls.filter((id) => id === flakyUserId).length;
  assert.strictEqual(flakyAttempts, 2, "the flaky account should be attempted twice (fail once, then succeed)");
  console.log("testTransientFailureIsRetriedNotDropped passed");
}

// 2026-10-01: a live dry-run against production found 17 more leftover
// accounts on three domains the original two-domain list didn't cover —
// res05b-* prefixed, tied to the closed RES-05B k6 load-test effort. This
// locks in that the extended list actually catches them.
const RES05B_PAGE = [
  { userId: "res05b-admin-1787821844890-e587bcfa@pim1.local", isActive: false, createdAt: "2026-08-27" },
  { userId: "res05b-load-1787797378-1@load.local", isActive: false, createdAt: "2026-08-27" },
  { userId: "res05b-closer-super-1787765754@vexa.local", isActive: false, createdAt: "2026-08-26" },
  { userId: "admin@realcompany.com", isActive: true, createdAt: "2026-01-01" },
];

async function testRes05bDomainsAreCaught() {
  global.fetch = async (url, opts) => {
    const u = new URL(url);
    if (u.pathname === "/api/v1/auth/login") return jsonResponse(201, { accessToken: "fake-token" });
    if (u.pathname === "/api/v1/admin/workspace/users" && (!opts?.method || opts.method === "GET")) {
      return jsonResponse(200, { items: RES05B_PAGE, limit: 200, nextCursor: null });
    }
    throw new Error(`unexpected fetch in testRes05bDomainsAreCaught: ${opts?.method || "GET"} ${url}`);
  };
  process.env.API_BASE = "https://fake-api.example";
  process.env.ADMIN_TOKEN = "provided-directly";
  process.argv = ["node", "script"]; // dry run

  const SCRIPT_PATH = path.join(__dirname, "purge-leftover-test-users.cjs");
  delete require.cache[require.resolve(SCRIPT_PATH)];
  const { main } = require(SCRIPT_PATH);
  const output = await withCapturedLogs(main);

  assert.match(output, /Purgeable \(inactive \+ synthetic domain\): 3/, "all 3 res05b-* accounts should be purgeable");
  assert.ok(
    !/do NOT match a known synthetic domain/.test(output),
    "none of the res05b-* accounts should be left for manual review anymore",
  );
  console.log("testRes05bDomainsAreCaught passed");
}

async function run() {
  await testDryRun();
  await testExecutePurgesOnlySyntheticAccounts();
  await testTransientFailureIsRetriedNotDropped();
  await testRes05bDomainsAreCaught();
  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "discovers_full_roster_via_pagination_not_a_single_page",
          "dry_run_makes_zero_purge_calls",
          "execute_purges_only_synthetic_domain_accounts",
          "real_deactivated_human_never_purged_in_either_mode",
          "transient_failure_is_retried_not_silently_dropped",
          "res05b_domains_pim1_local_load_local_vexa_local_are_caught",
        ],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

run().catch((error) => {
  console.error("purge-leftover-test-users logic test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
