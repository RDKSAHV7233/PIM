#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Queue all approved "Shopify Seed Products" for Shopify channel export.
 * Simulates the "Queue channel export" button click in the web app for each product.
 */

const BASE_URL = process.env.API_BASE_URL ?? "http://localhost:4000/api/v1";
const USER_ID = process.env.SEED_USER_ID ?? "admin@pim1.local";
const WORKSPACE_SLUG = process.env.SEED_WORKSPACE_SLUG ?? "default";
const PASSWORD = process.env.SEED_PASSWORD ?? "vexa-pim-demo-password";
const CHANNEL = "shopify";
const CONCURRENCY = 5;

async function api(method, path, token, body) {
  const headers = { "Accept": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const opts = { method, headers, signal: AbortSignal.timeout(20_000) };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}${path}`, opts);
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, data: json };
}

async function login() {
  const res = await api("POST", "/auth/login", null, {
    userId: USER_ID,
    workspaceSlug: WORKSPACE_SLUG,
    password: PASSWORD,
    expiresInMinutes: 120,
  });
  if (res.status !== 201 || !res.data?.accessToken) {
    throw new Error(`Login failed: ${res.status} ${JSON.stringify(res.data)}`);
  }
  return res.data.accessToken;
}

async function getAllApprovedSeedProducts(token) {
  const all = [];
  let cursor = null;
  let page = 1;

  while (true) {
    const url = `/catalog/products?status=approved&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const res = await api("GET", url, token);
    if (res.status !== 200) throw new Error(`List products failed: ${res.status} ${JSON.stringify(res.data)}`);

    const items = Array.isArray(res.data) ? res.data : (res.data?.items ?? []);
    // Filter to seed products by title pattern
    const seedItems = items.filter(p => /SEED-\d{3}-/.test(p.title) || p.title?.match(/^(UrbanThread|NextWear|StyleLab|FabricForge|WeaveCo|DrapeCraft|LoopMade|ThreadLift)\s/));
    for (const p of seedItems) all.push(p);

    const nextCursor = res.data?.nextCursor ?? res.data?.cursor ?? null;
    const hasMore = items.length === 50 && nextCursor && nextCursor !== cursor;
    if (!hasMore) break;
    cursor = nextCursor;
    page++;
    if (page > 10) break; // safety
  }
  return all;
}

async function queueExport(token, productId) {
  const res = await api("POST", `/marketplace/products/${productId}/export-jobs`, token, {
    channel: CHANNEL,
    maxRetries: 3,
    fallbackAcknowledged: true,
  });
  return res;
}

async function processBatch(items, fn, concurrency) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

async function main() {
  console.log(`Bulk-publishing to Shopify via ${BASE_URL}`);
  const token = await login();
  console.log("Authenticated OK");

  const products = await getAllApprovedSeedProducts(token);
  console.log(`Found ${products.length} approved seed products`);

  if (products.length === 0) {
    console.log("No seed products found — run seed-100-shopify-products.cjs first");
    return 1;
  }

  let queued = 0;
  let skipped = 0;
  let failed = 0;

  await processBatch(products, async (product) => {
    process.stdout.write(`  Queuing ${product.id} (${product.title?.slice(0, 30)})... `);
    try {
      const res = await queueExport(token, product.id);
      if (res.status === 201) {
        queued++;
        console.log(`OK  jobId=${res.data?.id}`);
      } else if (res.status === 400 && String(res.data?.error ?? res.data?.message ?? "").includes("already")) {
        skipped++;
        console.log(`SKIP (already queued)`);
      } else {
        failed++;
        console.log(`FAIL ${res.status} ${JSON.stringify(res.data).slice(0, 120)}`);
      }
    } catch (err) {
      failed++;
      console.log(`ERR ${err instanceof Error ? err.message : String(err)}`);
    }
  }, CONCURRENCY);

  console.log("\n────────────────────────────────────────");
  console.log(`Queued: ${queued}  Skipped: ${skipped}  Failed: ${failed}`);
  console.log(`Visit http://localhost:3000/channels/submissions to monitor progress.`);
  return failed > 0 ? 1 : 0;
}

main().then(code => process.exit(code)).catch(err => {
  console.error("Bulk publish failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
