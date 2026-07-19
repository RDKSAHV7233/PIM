/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const ALLOWED_ISOLATED_WORKSPACES = ["shopify-e2e"];

async function assertReachable(url, expectedStatus, context) {
  const response = await fetch(url, {
    method: "GET",
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status !== expectedStatus) {
    const body = await response.text();
    throw new Error(`${context} failed: expected ${expectedStatus}, got ${response.status}; body=${body.slice(0, 300)}`);
  }
}

function validateIsolatedTenantSafety(workspace, tenantKey) {
  if (workspace === "default" || tenantKey === "default") {
    throw new Error(
      "PLAYWRIGHT_E2E_ISOLATED_TENANT=1 must not target the default workspace/tenant. " +
        `Got workspace="${workspace}", tenantKey="${tenantKey}".`,
    );
  }
  if (workspace !== tenantKey) {
    throw new Error(
      "PLAYWRIGHT_E2E_ISOLATED_TENANT=1 requires PLAYWRIGHT_WORKSPACE and PLAYWRIGHT_TENANT_KEY to match. " +
        `Got workspace="${workspace}", tenantKey="${tenantKey}".`,
    );
  }
  if (!ALLOWED_ISOLATED_WORKSPACES.includes(workspace)) {
    throw new Error(
      `PLAYWRIGHT_E2E_ISOLATED_TENANT=1 workspace "${workspace}" is not in the allow-list ` +
        `[${ALLOWED_ISOLATED_WORKSPACES.join(", ")}]. ` +
        "Add it to ALLOWED_ISOLATED_WORKSPACES in global-setup.cjs to enable full-tenant cleanup.",
    );
  }
  if (process.env.PLAYWRIGHT_ALLOW_FULL_TENANT_PURGE !== "1") {
    throw new Error(
      "PLAYWRIGHT_E2E_ISOLATED_TENANT=1 requires PLAYWRIGHT_ALLOW_FULL_TENANT_PURGE=1 to confirm destructive cleanup.",
    );
  }
}

async function cleanupIsolatedTenantProducts(apiURL, adminToken) {
  let totalDeleted = 0;
  let totalPurged = 0;
  let passes = 0;
  const MAX_PASSES = 50;
  let lastBatchSize = 0;

  while (passes < MAX_PASSES) {
    passes++;
    let products;
    try {
      const listRes = await fetch(`${apiURL}/catalog/products?slim=true&limit=200`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        signal: AbortSignal.timeout(30_000),
      });
      if (!listRes.ok) {
        if (listRes.status === 404) break;
        console.warn(`[global-setup] Product list returned ${listRes.status} — stopping cleanup.`);
        break;
      }
      const data = await listRes.json();
      products = data?.items ?? data ?? [];
    } catch (err) {
      console.warn(`[global-setup] Product list failed: ${err.message} — stopping cleanup.`);
      break;
    }

    if (!Array.isArray(products) || products.length === 0) break;
    lastBatchSize = products.length;

    for (const product of products) {
      const productId = product.id;
      if (!productId) continue;
      try {
        const delRes = await fetch(`${apiURL}/catalog/products/${productId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${adminToken}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (delRes.ok || delRes.status === 204 || delRes.status === 404) {
          totalDeleted++;
        }
      } catch {}
      try {
        const purgeRes = await fetch(`${apiURL}/catalog/products/${productId}/purge`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${adminToken}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (purgeRes.ok || purgeRes.status === 204 || purgeRes.status === 404) {
          totalPurged++;
        }
      } catch {}
    }

    if (products.length < 200) break;
  }

  if (totalDeleted > 0 || totalPurged > 0) {
    console.log(
      `[global-setup] Pre-suite cleanup: deleted ${totalDeleted}, purged ${totalPurged} products in ${passes} pass(es).`,
    );
  }

  if (passes >= MAX_PASSES && lastBatchSize >= 200) {
    throw new Error(
      `[global-setup] Pre-suite cleanup incomplete: reached ${MAX_PASSES} passes ` +
        `(deleted ${totalDeleted}, purged ${totalPurged}) but products may remain. ` +
        "Investigate why this tenant accumulated more than 10,000 products.",
    );
  }
}

module.exports = async function globalSetup() {
  const baseURL = process.env.PLAYWRIGHT_BASE_URL || "http://127.0.0.1:3001";
  const apiURL = process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:4001/api/v1";
  const workspace = process.env.PLAYWRIGHT_WORKSPACE || "default";
  const tenantKey = process.env.PLAYWRIGHT_TENANT_KEY || workspace;
  const isIsolatedTenant = process.env.PLAYWRIGHT_E2E_ISOLATED_TENANT === "1";
  const runId = process.env.PLAYWRIGHT_RUN_ID || "";

  if (!workspace || workspace.trim().length === 0) {
    throw new Error("PLAYWRIGHT_WORKSPACE is required for Vexa PIM E2E.");
  }

  if (isIsolatedTenant) {
    validateIsolatedTenantSafety(workspace, tenantKey);
  }

  await assertReachable(`${baseURL}/login`, 200, "web login reachability");
  await assertReachable(`${apiURL}/health`, 200, "api health reachability");

  // ── Phase 9 pre-condition: public signup feature gate check ───────────────
  if (process.env.PLAYWRIGHT_SIGNUP_OUTBOX_DIR) {
    let signupDisabled = false;
    try {
      const signupCheckUrl = `${apiURL}/signup/check-availability?slug=playwright-preflight-probe`;
      const signupRes = await fetch(signupCheckUrl, {
        method: "GET",
        signal: AbortSignal.timeout(10_000),
      });
      if (signupRes.status !== 200) {
        signupDisabled = true;
      }
    } catch {
      signupDisabled = true;
    }
    if (signupDisabled) {
      process.env.PLAYWRIGHT_SIGNUP_DISABLED = "true";
      console.warn(
        "[global-setup] Public signup feature is disabled or unreachable. " +
          "Phase 9 specs will be skipped automatically. " +
          "To enable: set FEATURE_PUBLIC_SIGNUP_ENABLED=true and AUTH_MODE=db, then restart both servers.",
      );
    } else {
      process.env.PLAYWRIGHT_SIGNUP_DISABLED = "false";
      console.log("[global-setup] Public signup feature is reachable — Phase 9 specs will run.");
    }
  }

  // ── Pre-authenticate all roles and persist tokens to disk ─────────────────
  const STORAGE_STATE_DIR = path.join(__dirname, "../../../../../.runlogs/storage-state");
  const API_TOKEN_CACHE_FILE = path.join(STORAGE_STATE_DIR, "api-tokens.json");
  fs.mkdirSync(STORAGE_STATE_DIR, { recursive: true });

  const password = process.env.PLAYWRIGHT_PASSWORD || "vexa-pim-demo-password";
  const roleUsers = {
    admin:           process.env.PLAYWRIGHT_ADMIN_USER           || "admin@vexa-pim.local",
    editor:          process.env.PLAYWRIGHT_EDITOR_USER          || "editor@vexa-pim.local",
    publisher:       process.env.PLAYWRIGHT_PUBLISHER_USER       || "publisher@vexa-pim.local",
    approver:        process.env.PLAYWRIGHT_APPROVER_USER        || "approver@vexa-pim.local",
    channel_manager: process.env.PLAYWRIGHT_CHANNEL_MANAGER_USER || "channel_manager@vexa-pim.local",
    connector_admin: process.env.PLAYWRIGHT_CONNECTOR_ADMIN_USER || "connector_admin@vexa-pim.local",
    reviewer:        process.env.PLAYWRIGHT_REVIEWER_USER        || "reviewer@vexa-pim.local",
    viewer:          process.env.PLAYWRIGHT_VIEWER_USER          || "viewer@vexa-pim.local",
  };

  const tokenCache = {};
  for (const [role, userId] of Object.entries(roleUsers)) {
    try {
      const loginRes = await fetch(`${apiURL}/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceSlug: workspace, userId, password, expiresInMinutes: 240 }),
        signal: AbortSignal.timeout(15_000),
      });
      if (loginRes.ok) {
        const payload = await loginRes.json();
        const cacheKey = `${apiURL}|${workspace}|${role}`;
        tokenCache[cacheKey] = payload;
      } else {
        console.warn(`[global-setup] Pre-auth for role "${role}" (${userId}) returned ${loginRes.status} — tests needing this role will skip.`);
      }
    } catch (err) {
      console.warn(`[global-setup] Pre-auth for role "${role}" failed: ${err.message} — tests needing this role will skip.`);
    }
  }

  fs.writeFileSync(API_TOKEN_CACHE_FILE, JSON.stringify(tokenCache, null, 2));
  console.log(
    `[global-setup] Pre-authenticated ${Object.keys(tokenCache).length}/${Object.keys(roleUsers).length} roles; ` +
      `tokens cached at ${path.relative(process.cwd(), API_TOKEN_CACHE_FILE)}`,
  );

  const adminCacheKey = `${apiURL}|${workspace}|admin`;
  const adminToken = tokenCache[adminCacheKey]?.accessToken;

  // ── Isolated tenant setup: pre-suite product cleanup ──────────────────────
  // When running with a dedicated E2E workspace (PLAYWRIGHT_E2E_ISOLATED_TENANT=1),
  // remove leftover products from prior runs. This runs BEFORE the capacity check
  // so the check evaluates the clean tenant.
  //
  // The STARTER plan (auto-created for unknown tenants) provides 500 SKU headroom
  // which is sufficient for these suites. No plan-tier mutation is attempted —
  // the commercial mutation endpoint returns 403 in local/test environments and
  // the noise obscures real failures.
  if (isIsolatedTenant && adminToken) {
    console.log(
      `[global-setup] Isolated tenant "${workspace}" — cleaning leftover products.` +
        (runId ? ` run=${runId}` : ""),
    );
    await cleanupIsolatedTenantProducts(apiURL, adminToken);
  }

  // ── Preflight: SKU capacity check ──────────────────────────────────────────
  const SKU_HEADROOM_MIN = Number.parseInt(process.env.PLAYWRIGHT_SKU_HEADROOM_MIN || "50", 10);
  if (adminToken) {
    try {
      const usageRes = await fetch(`${apiURL}/billing/usage`, {
        headers: { Authorization: `Bearer ${adminToken}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (usageRes.ok) {
        const usage = await usageRes.json();
        const skuCurrent = usage?.skus?.current ?? 0;
        const skuLimit = usage?.skus?.limit ?? 0;
        const headroom = skuLimit - skuCurrent;
        console.log(
          `[global-setup] SKU preflight: ${skuCurrent}/${skuLimit} used (${headroom} headroom)`,
        );
        if (skuLimit > 0 && headroom < SKU_HEADROOM_MIN) {
          throw new Error(
            `SKU capacity insufficient: ${skuCurrent}/${skuLimit} products ` +
              `(${headroom} headroom < ${SKU_HEADROOM_MIN} minimum). ` +
              `Clean up test products before running the suite.`,
          );
        }
      } else {
        console.warn(`[global-setup] SKU preflight check returned ${usageRes.status} — skipping.`);
      }
    } catch (err) {
      if (err.message.includes("SKU capacity insufficient")) throw err;
      console.warn(`[global-setup] SKU preflight check failed: ${err.message} — skipping.`);
    }
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        suite: "playwright-e2e",
        baseURL,
        apiURL,
        workspace,
        isolatedTenant: isIsolatedTenant,
        runId: runId || undefined,
        signupEnabled: process.env.PLAYWRIGHT_SIGNUP_OUTBOX_DIR
          ? process.env.PLAYWRIGHT_SIGNUP_DISABLED !== "true"
          : "not-requested",
      },
      null,
      2,
    ),
  );
};
