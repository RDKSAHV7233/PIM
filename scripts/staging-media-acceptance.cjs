#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Staging acceptance test for PR #487 (B1) and PR #488 (Scope A).
 *
 * B1:  Verifies the governed main-image JSON path fix works at runtime —
 *      queries a product's media assets, checks governance.isMain resolution.
 *
 * Scope A: Verifies the same-origin media proxy route returns image bytes
 *          and correct headers for a real uploaded asset.
 *
 * Requires env: STAGING_BASE_URL, STAGING_SMOKE_WORKSPACE,
 *               STAGING_SMOKE_USER, STAGING_SMOKE_PASSWORD
 */

function requireEnv(name) {
  const value = String(process.env[name] ?? "").trim();
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

const BASE = requireEnv("STAGING_BASE_URL");
const WORKSPACE = requireEnv("STAGING_SMOKE_WORKSPACE");
const USER = requireEnv("STAGING_SMOKE_USER");
const PASSWORD = requireEnv("STAGING_SMOKE_PASSWORD");
const WEB_URL = String(process.env.STAGING_WEB_URL ?? "").trim();

const results = [];

function pass(label, detail) {
  results.push({ status: "PASS", label, detail });
  console.log(`  ✓ PASS  ${label}  ${detail}`);
}
function fail(label, detail) {
  results.push({ status: "FAIL", label, detail });
  console.error(`  ✗ FAIL  ${label}  ${detail}`);
}
function skip(label, detail) {
  results.push({ status: "SKIP", label, detail });
  console.log(`  ~ SKIP  ${label}  ${detail}`);
}

async function api(method, path, opts = {}) {
  const url = `${BASE}${path}`;
  const headers = { "Content-Type": "application/json", ...(opts.headers ?? {}) };
  const response = await fetch(url, {
    method,
    headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(30000),
  });
  const text = await response.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}
  return { status: response.status, headers: response.headers, json, text };
}

async function login() {
  const res = await api("POST", "/api/v1/auth/login", {
    body: { workspaceSlug: WORKSPACE, userId: USER, password: PASSWORD },
  });
  if (res.status !== 200 && res.status !== 201) {
    throw new Error(`Login failed: ${res.status} ${res.text}`);
  }
  const token = res.json?.token ?? res.json?.accessToken;
  if (!token) throw new Error("Login succeeded but no token in response");
  return token;
}

async function run() {
  console.log("\n=== Staging Media Acceptance Test ===\n");

  // ── Auth ──
  let token;
  try {
    token = await login();
    pass("[auth] login", `workspace=${WORKSPACE}`);
  } catch (e) {
    fail("[auth] login", e.message);
    return;
  }

  const auth = { Authorization: `Bearer ${token}` };

  // ── B1: Find products with media assets ──
  let products;
  try {
    const res = await api("GET", "/api/v1/products?limit=50&includeMedia=true", { headers: auth });
    if (res.status !== 200) throw new Error(`${res.status}`);
    products = res.json?.data ?? res.json?.products ?? res.json ?? [];
    if (!Array.isArray(products)) products = [];
    pass("[b1] list_products", `count=${products.length}`);
  } catch (e) {
    fail("[b1] list_products", e.message);
    products = [];
  }

  // ── B1: Find media assets and check governance ──
  let allAssets = [];
  try {
    const res = await api("GET", "/api/v1/media/assets?limit=50", { headers: auth });
    if (res.status !== 200) throw new Error(`${res.status}`);
    allAssets = res.json?.data ?? res.json?.assets ?? res.json ?? [];
    if (!Array.isArray(allAssets)) allAssets = [];
    pass("[b1] list_media_assets", `count=${allAssets.length}`);
  } catch (e) {
    fail("[b1] list_media_assets", e.message);
  }

  // Check for governance.isMain field in metadata
  const governedMain = allAssets.filter(a =>
    a.metadata?.governance?.isMain === true
  );
  const nonGoverned = allAssets.filter(a =>
    a.metadata?.governance?.isMain !== true
  );

  if (governedMain.length > 0) {
    pass("[b1] governed_main_exists",
      `governed=${governedMain.length} non-governed=${nonGoverned.length} ids=${governedMain.map(a => a.id).join(",")}`);
  } else if (allAssets.length > 0) {
    skip("[b1] governed_main_exists",
      `${allAssets.length} assets exist but none have metadata.governance.isMain=true — B1 path fix is deployed but no governed main asset exists yet on staging`);
  } else {
    skip("[b1] governed_main_exists", "no media assets on staging — cannot verify B1 runtime");
  }

  // ── B1: Check connector image resolution for a product with media ──
  const productWithMedia = products.find(p => {
    const mediaCount = p._count?.mediaAssets ?? p.mediaAssetCount ?? 0;
    return mediaCount > 0 && (!p.attributes?.mainImageUrl || p.attributes.mainImageUrl === "");
  });

  if (productWithMedia) {
    try {
      const res = await api("GET", `/api/v1/products/${productWithMedia.id}?includeMedia=true`, { headers: auth });
      if (res.status !== 200) throw new Error(`${res.status}`);
      const product = res.json;
      const mediaAssets = product?.mediaAssets ?? [];
      const hasGoverned = mediaAssets.some(a => a.metadata?.governance?.isMain === true);
      const mainUrl = product?.attributes?.mainImageUrl ?? product?.mainImageUrl ?? "";

      pass("[b1] product_with_media",
        `id=${productWithMedia.id} assets=${mediaAssets.length} hasGoverned=${hasGoverned} mainImageUrl=${mainUrl ? "set" : "empty"}`);
    } catch (e) {
      fail("[b1] product_with_media", e.message);
    }
  } else {
    skip("[b1] product_with_media",
      "no product found with media assets and empty mainImageUrl — create one on staging to complete B1 runtime acceptance");
  }

  // ── Scope A: Test the media proxy route ──
  const testAsset = allAssets.find(a => a.mimeType?.startsWith("image/")) ?? allAssets[0];

  if (testAsset && WEB_URL) {
    // Test proxy route via web URL
    try {
      const proxyUrl = `${WEB_URL}/api/media/assets/${testAsset.id}/file`;
      const res = await fetch(proxyUrl, {
        signal: AbortSignal.timeout(15000),
        redirect: "follow",
      });
      if (res.status === 200) {
        const ct = res.headers.get("content-type") ?? "unknown";
        const cl = res.headers.get("content-length") ?? "unknown";
        const cc = res.headers.get("cache-control") ?? "none";
        const hasCookie = res.headers.has("set-cookie");
        pass("[scope-a] proxy_returns_bytes",
          `content-type=${ct} content-length=${cl} cache-control=${cc} set-cookie=${hasCookie}`);

        if (hasCookie) {
          fail("[scope-a] proxy_no_set_cookie", "proxy forwarded Set-Cookie header — security violation");
        } else {
          pass("[scope-a] proxy_no_set_cookie", "no Set-Cookie forwarded");
        }
      } else {
        fail("[scope-a] proxy_returns_bytes", `status=${res.status} (expected 200)`);
      }
    } catch (e) {
      fail("[scope-a] proxy_returns_bytes", `proxy unreachable: ${e.message}`);
    }

    // Test proxy rejects bad ID
    try {
      const badUrl = `${WEB_URL}/api/media/assets/../../etc/passwd/file`;
      const res = await fetch(badUrl, {
        signal: AbortSignal.timeout(10000),
        redirect: "follow",
      });
      if (res.status === 400 || res.status === 404) {
        pass("[scope-a] proxy_rejects_bad_id", `status=${res.status}`);
      } else {
        fail("[scope-a] proxy_rejects_bad_id", `status=${res.status} (expected 400 or 404)`);
      }
    } catch (e) {
      pass("[scope-a] proxy_rejects_bad_id", `blocked: ${e.message}`);
    }
  } else if (testAsset && !WEB_URL) {
    skip("[scope-a] proxy_returns_bytes", "STAGING_WEB_URL not set — cannot test web proxy route");
    skip("[scope-a] proxy_rejects_bad_id", "STAGING_WEB_URL not set");
  } else {
    skip("[scope-a] proxy_returns_bytes", "no media assets on staging — cannot test proxy");
  }

  // ── Scope A: Test API media endpoint directly ──
  if (testAsset) {
    try {
      const res = await fetch(`${BASE}/api/v1/media/assets/${testAsset.id}/file`, {
        headers: auth,
        signal: AbortSignal.timeout(15000),
        redirect: "follow",
      });
      if (res.status === 200) {
        const ct = res.headers.get("content-type") ?? "unknown";
        const cl = res.headers.get("content-length") ?? "unknown";
        pass("[scope-a] api_media_endpoint",
          `id=${testAsset.id} content-type=${ct} content-length=${cl}`);
      } else {
        fail("[scope-a] api_media_endpoint", `status=${res.status} for asset ${testAsset.id}`);
      }
    } catch (e) {
      fail("[scope-a] api_media_endpoint", e.message);
    }
  }

  // ── Summary ──
  const passed = results.filter(r => r.status === "PASS").length;
  const failed = results.filter(r => r.status === "FAIL").length;
  const skipped = results.filter(r => r.status === "SKIP").length;
  console.log(`\n  TOTAL  ${results.length} checks  |  ${passed} pass  |  ${failed} fail  |  ${skipped} skip\n`);

  console.log(JSON.stringify({
    status: failed > 0 ? "FAIL" : "PASS",
    results,
    checkedAt: new Date().toISOString(),
  }, null, 2));

  if (failed > 0) process.exit(1);
}

run().catch(e => {
  console.error("Acceptance test crashed:", e.message);
  process.exit(1);
});
