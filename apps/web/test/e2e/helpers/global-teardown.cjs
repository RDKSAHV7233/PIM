/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const E2E_PRODUCT_PATTERNS = [
  "e2e-",
  "E2E Journey Product",
  "E2E ",
  "TEST-demo-",
  "mapping-publish-product-",
  "test-product-fix-",
];

module.exports = async function globalTeardown() {
  const apiURL = process.env.PLAYWRIGHT_API_URL || "http://127.0.0.1:4001/api/v1";

  const tokenCachePath = path.join(
    __dirname,
    "../../../../../.runlogs/storage-state/api-tokens.json",
  );
  let adminToken;
  try {
    const cache = JSON.parse(fs.readFileSync(tokenCachePath, "utf-8"));
    const workspace = process.env.PLAYWRIGHT_WORKSPACE || "default";
    adminToken = cache[`${apiURL}|${workspace}|admin`]?.accessToken;
  } catch {
    console.warn("[global-teardown] Could not read token cache — skipping product cleanup.");
    return;
  }
  if (!adminToken) {
    console.warn("[global-teardown] No admin token available — skipping product cleanup.");
    return;
  }

  let deleted = 0;
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

  if (deleted > 0) {
    console.log(`[global-teardown] Cleaned up ${deleted} E2E-created products.`);
  }
};
