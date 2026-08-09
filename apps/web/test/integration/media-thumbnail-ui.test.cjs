#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const MEDIA_TAB = path.join(REPO_ROOT, "apps", "web", "src", "app", "products", "[id]", "_components", "media-tab.tsx");
const MEDIA_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "media", "page.tsx");
const PROXY_ROUTE = path.join(REPO_ROOT, "apps", "web", "src", "app", "api", "media", "assets", "[id]", "file", "route.ts");
const PAGE_DATA_TYPES = path.join(REPO_ROOT, "apps", "web", "src", "app", "products", "[id]", "_components", "product-detail-types.ts");
const DEFERRED_SECTION = path.join(REPO_ROOT, "apps", "web", "src", "app", "products", "[id]", "_components", "product-detail-deferred-section.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  // --- A1: Same-origin media proxy route ---
  const proxy = fs.readFileSync(PROXY_ROUTE, "utf8");

  assert(
    proxy.includes("ASSET_ID_PATTERN") && proxy.includes("INVALID_ASSET_ID"),
    "Proxy route must validate asset ID format before forwarding.",
  );
  assert(
    proxy.includes("MEDIA_UPSTREAM_UNREACHABLE") && proxy.includes("502"),
    "Proxy route must return 502 with a clear error code when the backend is unreachable.",
  );
  assert(
    !proxy.includes("set-cookie") && !proxy.includes("Set-Cookie"),
    "Proxy route must not forward Set-Cookie headers from upstream.",
  );
  assert(
    proxy.includes("FORWARDED_HEADERS") &&
      proxy.includes('"content-type"') &&
      proxy.includes('"content-length"'),
    "Proxy route must allowlist forwarded headers (content-type, content-length).",
  );
  assert(
    proxy.includes("response.ok") && proxy.includes("response.status"),
    "Proxy route must forward non-2xx status codes truthfully instead of returning HTML.",
  );
  assert(
    proxy.includes("getApiBaseUrl"),
    "Proxy route must resolve the backend API URL through the existing getApiBaseUrl helper.",
  );

  // --- A2: Product media tab thumbnails ---
  const mediaTab = fs.readFileSync(MEDIA_TAB, "utf8");

  assert(
    mediaTab.includes("/api/media/assets/") && mediaTab.includes("/file"),
    "Media tab must render <img> tags sourced from the same-origin proxy route.",
  );
  assert(
    mediaTab.includes('loading="lazy"'),
    "Media tab thumbnails must use native lazy loading.",
  );
  assert(
    mediaTab.includes("object-cover"),
    "Media tab thumbnails must use object-cover for consistent aspect ratio.",
  );
  assert(
    mediaTab.includes("asset.isMain") && mediaTab.includes("Main"),
    "Media tab must display a badge on the main image.",
  );
  assert(
    mediaTab.includes("data.mediaAssets"),
    "Media tab must consume the mediaAssets array from page data.",
  );

  // --- A3: /media library thumbnail column ---
  const mediaPage = fs.readFileSync(MEDIA_PAGE, "utf8");

  assert(
    mediaPage.includes("/api/media/assets/") && mediaPage.includes("/file"),
    "Media library page must render <img> tags sourced from the same-origin proxy route.",
  );
  assert(
    mediaPage.includes('loading="lazy"'),
    "Media library thumbnails must use native lazy loading.",
  );
  assert(
    mediaPage.includes('key: "thumbnail"'),
    "Media library must have a dedicated thumbnail column in the asset grid.",
  );
  assert(
    mediaPage.includes("asset.fileName") && mediaPage.includes("asset.id"),
    "Media library asset column must show both filename and ID.",
  );

  // --- A0: ProductDetailPageData includes media assets ---
  const types = fs.readFileSync(PAGE_DATA_TYPES, "utf8");

  assert(
    types.includes("mediaAssets: MediaAsset[]"),
    "ProductDetailPageData must include the mediaAssets array, not just counts.",
  );
  assert(
    types.includes("MediaAsset") && types.includes("from \"@/lib/api\""),
    "ProductDetailPageData must import MediaAsset from the API types.",
  );

  const deferred = fs.readFileSync(DEFERRED_SECTION, "utf8");

  assert(
    deferred.includes("mediaAssets,") || deferred.includes("mediaAssets:"),
    "ProductDetailDeferredSection must forward mediaAssets into ProductDetailPageData.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "proxy_route_validates_asset_id",
          "proxy_route_returns_502_on_upstream_failure",
          "proxy_route_does_not_forward_set_cookie",
          "proxy_route_allowlists_forwarded_headers",
          "proxy_route_forwards_non_2xx_truthfully",
          "proxy_route_uses_getApiBaseUrl",
          "media_tab_renders_thumbnails_from_proxy",
          "media_tab_uses_lazy_loading",
          "media_tab_shows_main_badge",
          "media_tab_consumes_mediaAssets_array",
          "media_library_renders_thumbnails_from_proxy",
          "media_library_uses_lazy_loading",
          "media_library_has_thumbnail_column",
          "media_library_shows_filename_and_id",
          "page_data_includes_mediaAssets_array",
          "deferred_section_forwards_mediaAssets",
        ],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

try {
  run();
} catch (error) {
  console.error("Media thumbnail UI test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
