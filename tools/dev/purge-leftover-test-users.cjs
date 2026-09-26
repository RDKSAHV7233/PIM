#!/usr/bin/env node
/* eslint-disable no-console */
// F-002 backlog cleanup (2026-09-26, corrected after a "required team" CTO
// review caught the first draft of this script badly undercounting).
//
// Root cause history — three separate scripts, all run on every push to
// `main` against the real production tenant (no separate staging
// environment exists), all originally deactivated their smoke-test users
// but never deleted them:
//   - scripts/staging-postdeploy-check.cjs's access-policy-{viewer,reviewer,
//     editor}-*@vexa-pim.local accounts — fixed in PR #872 (2026-09-18 23:19).
//   - The three scripts creating e2e-editor-*/ops-summary-viewer-*/
//     ops-errors-viewer-*@pim1.test accounts — fixed in PR #912/#914
//     (2026-09-21 13:01/13:39).
//
// A first draft of this script hardcoded a 49-account snapshot scraped from
// one page of the (paginated, ~50-rows-per-page) admin UI — it accidentally
// queried a second, unrelated table on the same page, only read page 1, and
// so completely missed the @vexa-pim.local family and most of the @pim1.test
// backlog too. Live investigation (paging through 250+ rows, cross-checked
// against each fix's exact merge timestamp) confirmed both leaks are
// genuinely closed going forward — the newest ghost row found across the
// whole roster predates its fix's merge by 13 minutes — so this is now
// confirmed to be a one-time historical cleanup, not an active bug. The true
// backlog is in the hundreds, not 49 — this script discovers it dynamically
// rather than trusting any hand-captured snapshot ever again.
//
// It purges an account only if BOTH:
//   1. isActive === false (purgeUser's own precondition — see
//      workspace-users.service.ts:746-751), and
//   2. its userId ends in @pim1.test or @vexa-pim.local — both IANA/mDNS-
//      reserved placeholder TLDs (RFC 2606 / RFC 6762) that no real tenant
//      would ever use for a real user's email, so this is a safe, broad
//      filter rather than a fragile enumeration of exact generator prefixes.
// Any OTHER inactive account (different domain) is left alone and reported
// separately for manual review — never silently purged.
//
// Retries with backoff on transient failures (network errors, 429, 5xx) —
// at hundreds of sequential calls instead of 49, a single dropped request
// is likely, and this tool should not abort the whole run over one.
//
// Usage (mirrors tools/dev/purge-test-data.cjs's npm-script convention —
// see package.json's data:purge:leftover-users:dry / data:purge:leftover-users):
//   API_BASE=<production API base URL> \
//   WORKSPACE_SLUG=<your workspace slug> \
//   ADMIN_USER_ID=<your admin userId> \
//   ADMIN_PASSWORD=<your admin password> \
//   node tools/dev/purge-leftover-test-users.cjs            # dry run (default)
//
//   ...same env...  node tools/dev/purge-leftover-test-users.cjs --execute
//
// Or set ADMIN_TOKEN (e.g. your browser session's pim_access_token cookie
// value) instead of WORKSPACE_SLUG/ADMIN_USER_ID/ADMIN_PASSWORD.

const SYNTHETIC_DOMAINS = ["@pim1.test", "@vexa-pim.local"];
const PAGE_LIMIT = 200;
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 500;

function parseArgs(argv) {
  return { execute: argv.slice(2).includes("--execute") };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
  return status === 429 || status >= 500;
}

// Retries on network-level failures (fetch throwing) and on 429/5xx
// responses; does NOT retry on 4xx (other than 429) — those are real
// rejections (bad auth, not-found, precondition-failed) that won't
// change on retry.
async function requestJson(url, { method = "GET", headers = {}, body } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    if (attempt > 0) {
      await sleep(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1));
    }
    try {
      const response = await fetch(url, {
        method,
        headers: body ? { "content-type": "application/json", ...headers } : headers,
        body: body ? JSON.stringify(body) : undefined,
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        // non-JSON body (e.g. empty 204) — leave payload null
      }
      if (isRetryableStatus(response.status) && attempt < MAX_RETRIES) {
        lastError = new Error(`retryable status ${response.status}`);
        continue;
      }
      return { status: response.status, payload };
    } catch (error) {
      lastError = error;
      if (attempt >= MAX_RETRIES) {
        throw error;
      }
    }
  }
  throw lastError;
}

async function getAdminToken(apiBase) {
  if (process.env.ADMIN_TOKEN) {
    return process.env.ADMIN_TOKEN.trim();
  }
  const workspaceSlug = process.env.WORKSPACE_SLUG;
  const userId = process.env.ADMIN_USER_ID;
  const password = process.env.ADMIN_PASSWORD;
  if (!workspaceSlug || !userId || !password) {
    throw new Error(
      "Set ADMIN_TOKEN, or all three of WORKSPACE_SLUG / ADMIN_USER_ID / ADMIN_PASSWORD.",
    );
  }
  const login = await requestJson(`${apiBase}/api/v1/auth/login`, {
    method: "POST",
    body: { workspaceSlug, userId, password, expiresInMinutes: 60 },
  });
  if (login.status !== 201) {
    throw new Error(`Admin login failed (status ${login.status}): ${JSON.stringify(login.payload)}`);
  }
  const token = String(login.payload?.accessToken ?? login.payload?.token ?? "").trim();
  if (!token) {
    throw new Error("Admin login response did not include an access token.");
  }
  return token;
}

// Walks the full, real roster via cursor pagination — never trusts a
// hardcoded snapshot. Returns every user, active or not; callers filter.
async function fetchAllUsers(apiBase, token) {
  const all = [];
  let cursor;
  for (let page = 0; page < 1000; page += 1) {
    const params = new URLSearchParams({ pagination: "cursor", limit: String(PAGE_LIMIT) });
    if (cursor) params.set("cursor", cursor);
    const res = await requestJson(`${apiBase}/api/v1/admin/workspace/users?${params.toString()}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (res.status !== 200) {
      throw new Error(`Failed to list users (status ${res.status}) on page ${page}: ${JSON.stringify(res.payload)}`);
    }
    const items = res.payload?.items ?? [];
    all.push(...items);
    cursor = res.payload?.nextCursor ?? null;
    if (!cursor) {
      return all;
    }
  }
  throw new Error("Exceeded 1000 pages while listing users — aborting rather than looping forever.");
}

function isSyntheticDomain(userId) {
  const lower = String(userId).toLowerCase();
  return SYNTHETIC_DOMAINS.some((domain) => lower.endsWith(domain));
}

async function purgeUser(apiBase, token, userId) {
  return requestJson(`${apiBase}/api/v1/admin/workspace/users/${encodeURIComponent(userId)}/purge`, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
}

async function main() {
  const { execute } = parseArgs(process.argv);
  const apiBase = String(process.env.API_BASE ?? "").replace(/\/+$/, "");
  if (!apiBase) {
    throw new Error("Set API_BASE to the production API base URL.");
  }

  const token = await getAdminToken(apiBase);
  console.log("Authenticated. Walking the full workspace-user roster...");

  const allUsers = await fetchAllUsers(apiBase, token);
  const inactive = allUsers.filter((u) => u.isActive === false);
  const purgeable = inactive.filter((u) => isSyntheticDomain(u.userId));
  const otherInactive = inactive.filter((u) => !isSyntheticDomain(u.userId));

  const byPrefix = {};
  for (const u of purgeable) {
    const prefix = String(u.userId).split(/-\d{10,}/)[0];
    byPrefix[prefix] = (byPrefix[prefix] || 0) + 1;
  }

  console.log(`\nTotal users: ${allUsers.length}`);
  console.log(`Inactive: ${inactive.length}`);
  console.log(`Purgeable (inactive + synthetic domain): ${purgeable.length}`);
  console.log("Breakdown by generator pattern:");
  for (const [prefix, count] of Object.entries(byPrefix).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${prefix}-*: ${count}`);
  }

  if (otherInactive.length > 0) {
    console.log(
      `\n${otherInactive.length} inactive account(s) do NOT match a known synthetic domain — ` +
        "left alone, review manually:",
    );
    for (const u of otherInactive) {
      console.log(`  - ${u.userId} (createdAt=${u.createdAt})`);
    }
  }

  if (!execute) {
    console.log("\nDry run only — no accounts were purged. Re-run with --execute to actually delete them.");
    return;
  }

  console.log(`\nPurging ${purgeable.length} accounts...`);
  let purged = 0;
  const failures = [];
  for (const u of purgeable) {
    try {
      const res = await purgeUser(apiBase, token, u.userId);
      if (res.status === 200) {
        purged += 1;
        console.log(`  purged: ${u.userId}`);
      } else {
        failures.push({ userId: u.userId, status: res.status, payload: res.payload });
        console.log(`  FAILED (${res.status}): ${u.userId}`);
      }
    } catch (error) {
      failures.push({ userId: u.userId, error: error instanceof Error ? error.message : String(error) });
      console.log(`  FAILED (network): ${u.userId}`);
    }
  }

  console.log(`\nDone. Purged ${purged}/${purgeable.length}.`);
  if (failures.length > 0) {
    console.log(`${failures.length} failures:`);
    for (const f of failures) console.log(`  - ${f.userId}: ${JSON.stringify(f.payload ?? f.error)}`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}

module.exports = { main, fetchAllUsers, isSyntheticDomain, purgeUser, getAdminToken, requestJson };
