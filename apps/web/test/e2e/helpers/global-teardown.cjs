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
const MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

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
  let cachedWorkspace;
  try {
    const cache = JSON.parse(fs.readFileSync(tokenCachePath, "utf-8"));
    const cacheKey = `${apiURL}|${EXPECTED_E2E_WORKSPACE}|admin`;
    adminToken = cache[cacheKey]?.accessToken;
    cachedWorkspace = EXPECTED_E2E_WORKSPACE;
  } catch {
    console.warn("[global-teardown] Could not read token cache — skipping product cleanup.");
    return;
  }
  if (!adminToken) {
    console.warn("[global-teardown] No admin token available — skipping product cleanup (fail closed).");
    return;
  }

  console.log(`[global-teardown] Cleanup scoped to workspace "${cachedWorkspace}".`);

  let deleted = 0;
  let candidates = 0;
  let skippedAge = 0;
  const cutoff = new Date(Date.now() - MAX_AGE_MS);

  try {
    const listRes = await fetch(
      `${apiURL}/catalog/products?slim=true&limit=200`,
      {
        headers: { Authorization: `Bearer ${adminToken}` },
        signal: AbortSignal.timeout(30_000),
      },
    );
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
      } catch {
        // best-effort
      }
    }
  } catch (err) {
    console.warn(`[global-teardown] Product cleanup error: ${err.message}`);
  }

  console.log(
    `[global-teardown] Candidates: ${candidates}, deleted: ${deleted}, skipped (age > 24h): ${skippedAge}.`,
  );
};
