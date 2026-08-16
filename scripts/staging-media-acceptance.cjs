#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Staging media acceptance test — read + write paths.
 *
 * Read:  governed main-image resolution, media proxy route, API file endpoint.
 * Write: uploads a 1x1 PNG via the API and reads it back.
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
  // Retry on 502 (Railway cold-start) up to 5 times with backoff
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await api("POST", "/api/v1/auth/login", {
      body: { workspaceSlug: WORKSPACE, userId: USER, password: PASSWORD },
    });
    if (res.status === 200 || res.status === 201) {
      const token = res.json?.token ?? res.json?.accessToken;
      if (!token) throw new Error("Login succeeded but no token in response");
      return token;
    }
    if (res.status === 502 && attempt < 5) {
      console.log(`  … login attempt ${attempt}/5 got 502, retrying in ${attempt * 5}s`);
      await new Promise(r => setTimeout(r, attempt * 5000));
      continue;
    }
    throw new Error(`Login failed: ${res.status} ${res.text}`);
  }
}

async function run() {
  console.log("\n=== Staging Media Acceptance Test ===\n");

  // ── Health check (warm up Railway) ──
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      const res = await api("GET", "/api/v1/health");
      if (res.status === 200) {
        pass("[health] api_reachable", `env=${res.json?.env ?? "unknown"}`);
        break;
      }
    } catch {}
    if (attempt === 10) {
      fail("[health] api_reachable", "API did not respond after 10 attempts");
      process.exit(1);
    }
    console.log(`  … health probe ${attempt}/10 failed, retrying in 5s`);
    await new Promise(r => setTimeout(r, 5000));
  }

  // ── Auth ──
  let token;
  try {
    token = await login();
    pass("[auth] login", `workspace=${WORKSPACE}`);
  } catch (e) {
    fail("[auth] login", e.message);
    process.exit(1);
  }

  const auth = { Authorization: `Bearer ${token}` };

  // ── B1: Find products with media assets ──
  // Note: the products list endpoint (ListProductsQueryDto) has no includeMedia
  // param and never has — it only ever counts variants, not media assets. The
  // global ValidationPipe's forbidNonWhitelisted rejects unrecognized query
  // params with a 400, so passing includeMedia=true here always failed this
  // check. Dropped it; product_with_media below still can't find a real
  // mediaCount from this endpoint (the API doesn't expose one), so it will
  // keep skipping rather than running — that's a pre-existing gap in what this
  // endpoint can prove, not something this fix resolves. B1 governance itself
  // is still verified by list_media_assets/governed_main_exists below, which
  // query the media-assets endpoint directly.
  let products;
  try {
    const res = await api("GET", "/api/v1/products?limit=50", { headers: auth });
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
    // Test proxy route via web URL (sends session cookie for tenant context)
    try {
      const proxyUrl = `${WEB_URL}/api/media/assets/${testAsset.id}/file`;
      const res = await fetch(proxyUrl, {
        headers: { Cookie: `pim_access_token=${token}` },
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

  // ── Write path: upload a tiny test image via API ──
  let uploadedAssetId = null;
  try {
    // 1x1 red PNG (68 bytes)
    const TINY_PNG_BASE64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==";
    const uploadRes = await api("POST", "/api/v1/media/assets", {
      headers: auth,
      body: {
        fileName: `acceptance-test-${Date.now()}.png`,
        mimeType: "image/png",
        contentBase64: TINY_PNG_BASE64,
      },
    });
    if (uploadRes.status === 201 || uploadRes.status === 200) {
      uploadedAssetId = uploadRes.json?.id ?? uploadRes.json?.data?.id ?? null;
      pass("[write] upload_asset", `id=${uploadedAssetId} status=${uploadRes.status}`);
    } else {
      fail("[write] upload_asset", `status=${uploadRes.status} body=${uploadRes.text.slice(0, 200)}`);
    }
  } catch (e) {
    fail("[write] upload_asset", e.message);
  }

  // ── Write path: read back the uploaded asset bytes ──
  if (uploadedAssetId) {
    try {
      const readRes = await fetch(`${BASE}/api/v1/media/assets/${uploadedAssetId}/file`, {
        headers: auth,
        signal: AbortSignal.timeout(15000),
        redirect: "follow",
      });
      if (readRes.status === 200) {
        const ct = readRes.headers.get("content-type") ?? "unknown";
        const cl = readRes.headers.get("content-length") ?? "unknown";
        pass("[write] read_back_uploaded",
          `id=${uploadedAssetId} content-type=${ct} content-length=${cl}`);
      } else {
        fail("[write] read_back_uploaded", `status=${readRes.status} for asset ${uploadedAssetId}`);
      }
    } catch (e) {
      fail("[write] read_back_uploaded", e.message);
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
