#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Seed 100 products for Shopify bulk-publish testing.
 * Each product is created, given one variant, and approved.
 * Run against the local dev API on port 4000.
 */

const BASE_URL = process.env.API_BASE_URL ?? "http://localhost:4000/api/v1";
const USER_ID = process.env.SEED_USER_ID ?? "admin@pim1.local";
const WORKSPACE_SLUG = process.env.SEED_WORKSPACE_SLUG ?? "default";
const PASSWORD = process.env.SEED_PASSWORD ?? "vexa-pim-demo-password";
const PRODUCT_COUNT = Number(process.env.SEED_PRODUCT_COUNT ?? 100);

const PRODUCT_TYPES = ["T-Shirt", "Hoodie", "Polo", "Jacket", "Shorts", "Jeans", "Dress", "Kurta", "Track Pant", "Blazer"];
const BRANDS = ["UrbanThread", "NextWear", "StyleLab", "FabricForge", "WeaveCo", "DrapeCraft", "LoopMade", "ThreadLift"];
const IMAGE_URLS = [
  "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=600&q=80",
  "https://images.unsplash.com/photo-1556821840-3a63f15732ce?w=600&q=80",
  "https://images.unsplash.com/photo-1529374255404-311a2a4f1fd9?w=600&q=80",
  "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=600&q=80",
  "https://images.unsplash.com/photo-1512436991641-6745cdb1723f?w=600&q=80",
];

function pick(arr, i) {
  return arr[i % arr.length];
}

async function api(method, path, token, body) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
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

async function ensureCategory(token, name) {
  const existing = await api("GET", `/taxonomy/categories?limit=100`, token);
  const items = existing.data?.items ?? existing.data ?? [];
  const found = items.find((c) => c.name === name);
  if (found) {
    console.log(`  Using existing category: ${found.id} (${found.name})`);
    return found.id;
  }
  const res = await api("POST", "/taxonomy/categories", token, { name });
  if (res.status !== 201) throw new Error(`Create category failed: ${JSON.stringify(res.data)}`);
  console.log(`  Created category: ${res.data.id} (${res.data.name})`);
  return res.data.id;
}

async function createProduct(token, categoryId, index) {
  const productType = pick(PRODUCT_TYPES, index);
  const brand = pick(BRANDS, index);
  const mrp = 499 + (index % 10) * 100;
  const sellingPrice = Math.round(mrp * 0.8);
  const imageUrl = pick(IMAGE_URLS, index);
  const padded = String(index + 1).padStart(3, "0");

  const res = await api("POST", "/catalog/products", token, {
    title: `${brand} ${productType} ${padded}`,
    description: `Premium ${productType.toLowerCase()} by ${brand}. Ideal for everyday wear. Comfortable fit with quality fabric.`,
    brand,
    categoryId,
    status: "draft",
    attributes: {
      mainImageUrl: imageUrl,
      productType,
      color: pick(["Black", "White", "Navy", "Grey", "Red", "Blue", "Green", "Beige"], index),
      size: pick(["S", "M", "L", "XL", "XXL"], index),
    },
  });
  if (res.status !== 201) throw new Error(`Create product ${padded} failed: ${res.status} ${JSON.stringify(res.data)}`);

  const product = res.data;
  const skuCode = `SEED-${padded}-${Date.now() % 100000}`;

  const varRes = await api("POST", `/catalog/products/${product.id}/variants`, token, {
    skuCode,
    mrp,
    sellingPrice,
    inventoryQty: 50 + (index % 50),
    status: "draft",
    attributes: { size: pick(["S", "M", "L", "XL"], index), color: pick(["Black", "White", "Navy", "Grey"], index) },
  });
  if (varRes.status !== 201) {
    console.warn(`  Variant create failed for ${product.id}: ${varRes.status} ${JSON.stringify(varRes.data)}`);
  }

  // Advance to in_review then approved
  const reviewRes = await api("PATCH", `/catalog/products/${product.id}`, token, {
    expectedVersion: product.version,
    title: product.title,
    description: product.description,
    brand: product.brand,
    categoryId: product.categoryId,
    attributes: product.attributes,
    status: "in_review",
  });
  if (reviewRes.status !== 200) throw new Error(`in_review for ${product.id} failed: ${reviewRes.status} ${JSON.stringify(reviewRes.data)}`);

  const approveRes = await api("PATCH", `/catalog/products/${product.id}`, token, {
    expectedVersion: reviewRes.data.version,
    title: reviewRes.data.title,
    description: reviewRes.data.description,
    brand: reviewRes.data.brand,
    categoryId: reviewRes.data.categoryId,
    attributes: reviewRes.data.attributes,
    status: "approved",
  });
  if (approveRes.status !== 200) throw new Error(`approve for ${product.id} failed: ${approveRes.status} ${JSON.stringify(approveRes.data)}`);

  return { id: product.id, title: product.title, sku: skuCode, mrp, sellingPrice, imageUrl };
}

async function main() {
  console.log(`Seeding ${PRODUCT_COUNT} products against ${BASE_URL}`);
  console.log(`User: ${USER_ID} / workspace: ${WORKSPACE_SLUG}`);

  const token = await login();
  console.log("Authenticated OK");

  const categoryId = await ensureCategory(token, "Shopify Seed Products");

  const results = [];
  const errors = [];

  for (let i = 0; i < PRODUCT_COUNT; i++) {
    process.stdout.write(`  [${String(i + 1).padStart(3)}/${PRODUCT_COUNT}] `);
    try {
      const p = await createProduct(token, categoryId, i);
      results.push(p);
      console.log(`OK  ${p.id}  ${p.title}  SKU=${p.sku}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push({ index: i + 1, error: msg });
      console.log(`ERR  ${msg.slice(0, 120)}`);
    }
  }

  console.log("\n────────────────────────────────────────");
  console.log(`Created: ${results.length}  Errors: ${errors.length}`);
  if (errors.length > 0) {
    console.log("Errors:");
    for (const e of errors) console.log(`  [${e.index}] ${e.error}`);
  }
  console.log(`Category ID: ${results[0] ? categoryId : "N/A"}`);
  console.log("Seed complete. All products are status=approved, ready for Shopify publish.");

  return errors.length > 0 ? 1 : 0;
}

main().then((code) => process.exit(code)).catch((err) => {
  console.error("Seed failed:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
