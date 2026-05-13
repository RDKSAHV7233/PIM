#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Fix 100 seed products: add hsnCode + gstRate so they pass compliance
 * and become publishable to Shopify.
 * Workflow per product: approved → draft → patch(hsnCode,gstRate) → in_review → approved
 */

const BASE_URL = process.env.API_BASE_URL ?? "http://localhost:4000/api/v1";
const USER_ID = process.env.SEED_USER_ID ?? "admin@pim1.local";
const WORKSPACE_SLUG = process.env.SEED_WORKSPACE_SLUG ?? "default";
const PASSWORD = process.env.SEED_PASSWORD ?? "vexa-pim-demo-password";
const CONCURRENCY = 3;

const HSN_CODE = "6109"; // HSN for T-shirts / apparel
const GST_RATE = 12;    // 12% GST for apparel

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

async function getAllSeedProducts(token) {
  const all = [];
  let cursor = null;
  let page = 1;

  while (true) {
    const url = `/catalog/products?status=approved&limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const res = await api("GET", url, token);
    if (res.status !== 200) throw new Error(`List failed: ${res.status}`);

    const items = Array.isArray(res.data) ? res.data : (res.data?.items ?? []);
    const seedItems = items.filter(p =>
      /SEED-\d{3}-/.test(p.title) ||
      p.title?.match(/^(UrbanThread|NextWear|StyleLab|FabricForge|WeaveCo|DrapeCraft|LoopMade|ThreadLift)\s/)
    );
    for (const p of seedItems) all.push(p);

    const nextCursor = res.data?.nextCursor ?? res.data?.cursor ?? null;
    const hasMore = items.length === 50 && nextCursor && nextCursor !== cursor;
    if (!hasMore) break;
    cursor = nextCursor;
    page++;
    if (page > 10) break;
  }
  return all;
}

async function fixProduct(token, product) {
  const id = product.id;

  // Step 1: revert to draft
  const draftRes = await api("PATCH", `/catalog/products/${id}`, token, {
    expectedVersion: product.version,
    title: product.title,
    description: product.description,
    brand: product.brand,
    categoryId: product.categoryId,
    attributes: product.attributes,
    status: "draft",
  });
  if (draftRes.status !== 200) {
    return { ok: false, error: `draft failed: ${draftRes.status} ${JSON.stringify(draftRes.data).slice(0,100)}` };
  }

  // Step 2: patch with hsnCode + gstRate
  const patchRes = await api("PATCH", `/catalog/products/${id}`, token, {
    expectedVersion: draftRes.data.version,
    title: draftRes.data.title,
    description: draftRes.data.description,
    brand: draftRes.data.brand,
    categoryId: draftRes.data.categoryId,
    attributes: draftRes.data.attributes,
    hsnCode: HSN_CODE,
    gstRate: GST_RATE,
    status: "draft",
  });
  if (patchRes.status !== 200) {
    return { ok: false, error: `patch failed: ${patchRes.status} ${JSON.stringify(patchRes.data).slice(0,100)}` };
  }

  // Step 3: in_review
  const reviewRes = await api("PATCH", `/catalog/products/${id}`, token, {
    expectedVersion: patchRes.data.version,
    title: patchRes.data.title,
    description: patchRes.data.description,
    brand: patchRes.data.brand,
    categoryId: patchRes.data.categoryId,
    attributes: patchRes.data.attributes,
    hsnCode: patchRes.data.hsnCode,
    gstRate: patchRes.data.gstRate,
    status: "in_review",
  });
  if (reviewRes.status !== 200) {
    return { ok: false, error: `in_review failed: ${reviewRes.status} ${JSON.stringify(reviewRes.data).slice(0,100)}` };
  }

  // Step 4: approve
  const approveRes = await api("PATCH", `/catalog/products/${id}`, token, {
    expectedVersion: reviewRes.data.version,
    title: reviewRes.data.title,
    description: reviewRes.data.description,
    brand: reviewRes.data.brand,
    categoryId: reviewRes.data.categoryId,
    attributes: reviewRes.data.attributes,
    hsnCode: reviewRes.data.hsnCode,
    gstRate: reviewRes.data.gstRate,
    status: "approved",
  });
  if (approveRes.status !== 200) {
    return { ok: false, error: `approve failed: ${approveRes.status} ${JSON.stringify(approveRes.data).slice(0,100)}` };
  }

  const issueCount = approveRes.data?.validationIssues?.length ?? "?";
  return { ok: true, issueCount };
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
  console.log(`Fixing seed products: add hsnCode=${HSN_CODE} gstRate=${GST_RATE}`);
  const token = await login();
  console.log("Authenticated OK");

  const products = await getAllSeedProducts(token);
  console.log(`Found ${products.length} approved seed products`);

  if (products.length === 0) {
    console.log("No seed products found");
    return 1;
  }

  let fixed = 0;
  let failed = 0;

  await processBatch(products, async (p) => {
    process.stdout.write(`  Fixing ${p.id} (${p.title?.slice(0, 35)})... `);
    const result = await fixProduct(token, p);
    if (result.ok) {
      fixed++;
      console.log(`OK  issues=${result.issueCount}`);
    } else {
      failed++;
      console.log(`FAIL  ${result.error}`);
    }
  }, CONCURRENCY);

  console.log("\n────────────────────────────────────────");
  console.log(`Fixed: ${fixed}  Failed: ${failed}`);
  return failed > 0 ? 1 : 0;
}

main().then(code => process.exit(code)).catch(err => {
  console.error("Fix failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
