/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const E2E_PRODUCT_PATTERNS = [
  "e2e-",
  "E2E Journey Product",
  "TEST-demo-",
  "mapping-publish-product-",
  "test-product-fix-",
];

const EXPECTED_E2E_WORKSPACE = process.env.PLAYWRIGHT_WORKSPACE || "default";
const IS_ISOLATED_TENANT = process.env.PLAYWRIGHT_E2E_ISOLATED_TENANT === "1";
const ALLOW_FULL_PURGE = process.env.PLAYWRIGHT_ALLOW_FULL_TENANT_PURGE === "1";
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours
const ALLOWED_ISOLATED_WORKSPACES = ["shopify-e2e"];

async function cleanupIsolatedTenant(apiURL, adminToken) {
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
        console.warn(`[global-teardown] Product list returned ${listRes.status} — stopping cleanup.`);
        break;
      }
      const data = await listRes.json();
      products = data?.items ?? data ?? [];
    } catch (err) {
      console.warn(`[global-teardown] Product list failed: ${err.message} — stopping cleanup.`);
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

  if (passes >= MAX_PASSES && lastBatchSize >= 200) {
    console.error(
      `[global-teardown] Cleanup incomplete: reached ${MAX_PASSES} passes ` +
        `(deleted ${totalDeleted}, purged ${totalPurged}) but products may remain. ` +
        "Investigate why this tenant accumulated more than 10,000 products.",
    );
  } else {
    console.log(
      `[global-teardown] Isolated tenant cleanup complete: deleted ${totalDeleted}, purged ${totalPurged} products in ${passes} pass(es).`,
    );
  }
}

async function cleanupSharedTenant(apiURL, adminToken) {
  let deleted = 0;
  let candidates = 0;
  let skippedAge = 0;
  const cutoff = new Date(Date.now() - MAX_AGE_MS);

  try {
    const listRes = await fetch(`${apiURL}/catalog/products?slim=true&limit=200`, {
      headers: { Authorization: `Bearer ${adminToken}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!listRes.ok) {
      console.warn(`[global-teardown] Product list returned ${listRes.status} — skipping cleanup.`);
      return;
    }
    const data = await listRes.json();
    const products = data?.items ?? data ?? [];
    for (const product of products) {
      const title = product.title ?? "";
      const isE2E = E2E_PRODUCT_PATTERNS.some((p) => title.startsWith(p));
      if (!isE2E) continue;
      candidates++;

      const createdAt = product.createdAt ? new Date(product.createdAt) : null;
      if (createdAt && createdAt < cutoff) {
        skippedAge++;
        continue;
      }

      try {
        const delRes = await fetch(`${apiURL}/catalog/products/${product.id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${adminToken}` },
          signal: AbortSignal.timeout(10_000),
        });
        if (delRes.ok || delRes.status === 204 || delRes.status === 404) {
          deleted++;
        }
      } catch {}
    }
  } catch (err) {
    console.warn(`[global-teardown] Product cleanup error: ${err.message}`);
  }

  console.log(
    `[global-teardown] Candidates: ${candidates}, deleted: ${deleted}, skipped (age > 24h): ${skippedAge}.`,
  );
}

module.exports = async function globalTeardown() {
  const apiURL = process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:4001/api/v1";

  if (!EXPECTED_E2E_WORKSPACE || EXPECTED_E2E_WORKSPACE.trim().length === 0) {
    console.warn("[global-teardown] No PLAYWRIGHT_WORKSPACE configured — refusing cleanup (fail closed).");
    return;
  }

  const tokenCachePath = path.join(
    __dirname,
    "../../../../../.runlogs/storage-state/api-tokens.json",
  );
  let adminToken;
  try {
    const cache = JSON.parse(fs.readFileSync(tokenCachePath, "utf-8"));
    const cacheKey = `${apiURL}|${EXPECTED_E2E_WORKSPACE}|admin`;
    adminToken = cache[cacheKey]?.accessToken;
  } catch {
    console.warn("[global-teardown] Could not read token cache — skipping product cleanup.");
    return;
  }
  if (!adminToken) {
    console.warn("[global-teardown] No admin token available — skipping product cleanup (fail closed).");
    return;
  }

  if (IS_ISOLATED_TENANT) {
    if (!ALLOW_FULL_PURGE) {
      console.warn(
        "[global-teardown] PLAYWRIGHT_E2E_ISOLATED_TENANT=1 but PLAYWRIGHT_ALLOW_FULL_TENANT_PURGE=1 is not set. " +
          "Skipping destructive cleanup to prevent accidental data loss.",
      );
      return;
    }
    if (!ALLOWED_ISOLATED_WORKSPACES.includes(EXPECTED_E2E_WORKSPACE)) {
      console.warn(
        `[global-teardown] Workspace "${EXPECTED_E2E_WORKSPACE}" is not in the allow-list for full-tenant cleanup. Skipping.`,
      );
      return;
    }
    console.log(
      `[global-teardown] Cleanup scoped to isolated workspace "${EXPECTED_E2E_WORKSPACE}" — full purge.`,
    );
    await cleanupIsolatedTenant(apiURL, adminToken);
  } else {
    console.log(
      `[global-teardown] Cleanup scoped to workspace "${EXPECTED_E2E_WORKSPACE}" — pattern-matched only.`,
    );
    await cleanupSharedTenant(apiURL, adminToken);
  }
};
