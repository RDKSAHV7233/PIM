#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * PIM#585 regression test: "Main Image URL" content field doesn't satisfy channel
 * media-readiness, with no indication it won't.
 *
 * Root cause (traced, not assumed):
 *   - apps/web's product detail "media readiness" gate (side rail "Channel Readiness"
 *     chip, Overview tab "Media blockers" count, page.tsx "Media readiness" summary
 *     card, and the top-of-page blocker CTAs) was based ENTIRELY on
 *     `imageAssetCount === 0` (a count of Media Library MediaAsset rows). It had zero
 *     awareness of the Content tab's `attributes.mainImageUrl` field.
 *   - But `attributes.mainImageUrl` is NOT decorative: apps/api's
 *     connector-mapping.service.ts DEFAULT_FIELD_MAPPINGS maps
 *     "attributes.mainImageUrl" -> "images.0.src" as the default image source for
 *     BOTH Shopify and WooCommerce (the two channels named in the issue title), and
 *     marketplace.service.ts's resolveConnectorImageUrl gives an explicit
 *     `attributes.mainImageUrl` value PRIORITY over any Media Library asset when
 *     building the real export payload (see connector-image-resolver.test.cjs
 *     CASE 3). So a product with a valid mainImageUrl and zero Media Library assets
 *     will genuinely export successfully with that image — yet the UI told the
 *     operator "Blocked" / "No image assets are linked to this product" and pointed
 *     them at the Media tab, with no indication the field they just filled in and
 *     saved was already doing something.
 *
 * Fix direction chosen: (a) reconcile — the two ARE meant to represent the same
 * concept (the channel's primary image) and the disconnect was accidental, not by
 * design. `hasUsableMainImageUrl` (apps/web/.../product-detail-shared.tsx) now
 * mirrors resolveConnectorImageUrl's own bar (must be a permanent https:// URL,
 * matching Shopify's own requirement) and is threaded into every place that
 * previously gated on `imageAssetCount === 0` alone. It downgrades those gates from
 * "Blocked" to a "Warnings"-level message (never a silent full "Ready") because a
 * bare URL still carries none of the Media Library's alt-text / per-channel
 * eligibility governance — see the inline copy added to the Content tab field and
 * the Media tab's fallback-in-use banner.
 *
 * This test:
 *   1. Extracts `hasUsableMainImageUrl` verbatim from product-detail-shared.tsx,
 *      transpiles it with the real TypeScript compiler (not a hand re-implementation
 *      or a regex match), and actually EXECUTES it against representative inputs —
 *      exercising the real decision logic, not just asserting a string is present.
 *   2. Structurally verifies every consumer (page.tsx, product-detail-side-rail.tsx,
 *      overview-tab.tsx, product-detail-deferred-section.tsx, content-tab.tsx,
 *      media-tab.tsx) actually wires that boolean into its media-blocking gate,
 *      since fully rendering these Next.js Server Components requires a live app
 *      (see README verification notes for the live-server check performed
 *      separately).
 */
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const SHARED_FILE = path.join(
  REPO_ROOT, "apps", "web", "src", "app", "products", "[id]", "_components", "product-detail-shared.tsx",
);
const SIDE_RAIL_FILE = path.join(
  REPO_ROOT, "apps", "web", "src", "app", "products", "[id]", "_components", "product-detail-side-rail.tsx",
);
const OVERVIEW_TAB_FILE = path.join(
  REPO_ROOT, "apps", "web", "src", "app", "products", "[id]", "_components", "overview-tab.tsx",
);
const DEFERRED_SECTION_FILE = path.join(
  REPO_ROOT, "apps", "web", "src", "app", "products", "[id]", "_components", "product-detail-deferred-section.tsx",
);
const CONTENT_TAB_FILE = path.join(
  REPO_ROOT, "apps", "web", "src", "app", "products", "[id]", "_components", "content-tab.tsx",
);
const MEDIA_TAB_FILE = path.join(
  REPO_ROOT, "apps", "web", "src", "app", "products", "[id]", "_components", "media-tab.tsx",
);
const PRODUCT_PAGE_FILE = path.join(REPO_ROOT, "apps", "web", "src", "app", "products", "[id]", "page.tsx");
const TYPES_FILE = path.join(
  REPO_ROOT, "apps", "web", "src", "app", "products", "[id]", "_components", "product-detail-types.ts",
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function extractFunction(source, fnName) {
  const startPattern = new RegExp(`export function ${fnName}\\s*\\(`);
  const match = source.match(startPattern);
  assert(match, `Could not locate export function ${fnName} in source.`);
  const startIndex = match.index;
  let depth = 0;
  let inBody = false;
  for (let i = startIndex; i < source.length; i++) {
    if (source[i] === "{") {
      depth++;
      inBody = true;
    } else if (source[i] === "}") {
      depth--;
      if (inBody && depth === 0) {
        return source.slice(startIndex, i + 1);
      }
    }
  }
  throw new Error(`Could not find closing brace for ${fnName}.`);
}

/**
 * Loads the real `hasUsableMainImageUrl` implementation out of the actual source
 * file (not a reimplementation) by transpiling just that function through the
 * TypeScript compiler and evaluating it, so the test exercises the exact logic
 * that ships.
 */
function loadRealHasUsableMainImageUrl() {
  const source = fs.readFileSync(SHARED_FILE, "utf8");
  const fnSource = extractFunction(source, "hasUsableMainImageUrl");
  const transpiled = ts.transpileModule(fnSource.replace(/^export /, ""), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const factory = new Function(`${transpiled}\nreturn hasUsableMainImageUrl;`);
  return factory();
}

function run() {
  // ── Part 1: execute the real predicate against representative inputs ──────
  const hasUsableMainImageUrl = loadRealHasUsableMainImageUrl();

  const cases = [
    { attrs: { mainImageUrl: "https://cdn.example.com/shoe.jpg" }, expected: true, label: "valid mainImageUrl https URL" },
    { attrs: { mainImageUrl: "  https://cdn.example.com/shoe.jpg  " }, expected: true, label: "https URL with whitespace" },
    { attrs: { mainImageUrl: "", primaryImageUrl: "https://cdn.example.com/primary.jpg" }, expected: true, label: "valid primaryImageUrl fallback" },
    { attrs: { mainImageUrl: "", primaryImageUrl: "", imageUrl: "https://cdn.example.com/image-url.jpg" }, expected: true, label: "valid imageUrl fallback" },
    { attrs: { mainImageUrl: "", primaryImageUrl: "", imageUrl: "", image_url: "https://cdn.example.com/image_url.jpg" }, expected: true, label: "valid image_url fallback" },
    {
      attrs: { mainImageUrl: "http://cdn.example.com/not-https.jpg", primaryImageUrl: "https://cdn.example.com/primary.jpg" },
      expected: false,
      label: "first non-empty field must be https and cannot be rescued by a later field",
    },
    { attrs: { mainImageUrl: "http://cdn.example.com/shoe.jpg" }, expected: false, label: "insecure http URL (Shopify requires https)" },
    { attrs: { mainImageUrl: "" }, expected: false, label: "empty string" },
    { attrs: { mainImageUrl: "   " }, expected: false, label: "whitespace-only string" },
    { attrs: {}, expected: false, label: "attribute missing entirely" },
    { attrs: { mainImageUrl: null }, expected: false, label: "null value" },
    { attrs: { mainImageUrl: "ftp://example.com/shoe.jpg" }, expected: false, label: "non-http(s) scheme" },
    { attrs: { mainImageUrl: "not-a-url-at-all" }, expected: false, label: "garbage string" },
  ];

  for (const { attrs, expected, label } of cases) {
    const actual = hasUsableMainImageUrl(attrs);
    assert(
      actual === expected,
      `hasUsableMainImageUrl(${JSON.stringify(attrs)}) [${label}] expected ${expected}, got ${actual}`,
    );
  }

  // The exact scenario from the bug report: operator fills in Main Image URL,
  // saves, has never touched the Media Library. This must now read as "usable",
  // where before the fix nothing in the web app ever inspected this attribute for
  // readiness purposes at all.
  assert(
    hasUsableMainImageUrl({ mainImageUrl: "https://cdn.example.com/reported-bug-repro.jpg" }) === true,
    "Regression: the exact reported scenario (mainImageUrl set, no Media Library assets) must be recognized as usable.",
  );
  assert(
    hasUsableMainImageUrl({ mainImageUrl: "", primaryImageUrl: "https://cdn.example.com/pim-778.jpg" }) === true,
    "Regression PIM#778: primaryImageUrl must be recognized as usable when mainImageUrl is empty.",
  );

  // ── Part 2: verify every previously-blind consumer is now wired to it ─────
  const sharedSource = fs.readFileSync(SHARED_FILE, "utf8");
  assert(
    sharedSource.includes("export function hasUsableMainImageUrl") &&
      sharedSource.includes("productAttributes?.mainImageUrl") &&
      sharedSource.includes("productAttributes?.primaryImageUrl") &&
      sharedSource.includes("productAttributes?.imageUrl") &&
      sharedSource.includes("productAttributes?.image_url"),
    "product-detail-shared.tsx must export hasUsableMainImageUrl and mirror the backend's four image-attribute fallbacks.",
  );

  const typesSource = fs.readFileSync(TYPES_FILE, "utf8");
  assert(
    typesSource.includes("hasMainImageUrl: boolean"),
    "ProductDetailPageData must carry a hasMainImageUrl flag so every tab/side-rail consumer can see it.",
  );

  const deferredSource = fs.readFileSync(DEFERRED_SECTION_FILE, "utf8");
  assert(
    deferredSource.includes("hasUsableMainImageUrl") && deferredSource.includes("hasMainImageUrl:"),
    "product-detail-deferred-section.tsx must compute hasMainImageUrl via hasUsableMainImageUrl and put it on pageData.",
  );

  const sideRailSource = fs.readFileSync(SIDE_RAIL_FILE, "utf8");
  assert(
    /mediaBlocked\s*=\s*data\.imageAssetCount === 0 && !data\.hasMainImageUrl/.test(sideRailSource),
    "product-detail-side-rail.tsx's mediaBlocked (drives the 'Channel Readiness: Blocked' chip) must no longer " +
      "ignore a usable Main Image URL.",
  );

  const overviewSource = fs.readFileSync(OVERVIEW_TAB_FILE, "utf8");
  assert(
    /mediaBlockerCount\s*=\s*data\.imageAssetCount === 0 && !data\.hasMainImageUrl/.test(overviewSource),
    "overview-tab.tsx's mediaBlockerCount must no longer ignore a usable Main Image URL.",
  );

  const pageSource = fs.readFileSync(PRODUCT_PAGE_FILE, "utf8");
  assert(
    pageSource.includes("hasUsableMainImageUrl") && pageSource.includes("const hasMainImageUrl ="),
    "page.tsx must compute hasMainImageUrl for the 'Media readiness' summary card and top blocker CTAs.",
  );
  assert(
    /if \(hasMainImageUrl\) \{[\s\S]{0,300}?label: "Warnings"/.test(pageSource),
    "page.tsx's mediaReadiness must downgrade the 0-media-assets case to a 'Warnings' (not silent 'Ready', not " +
      "still 'Blocked') when a usable Main Image URL is present.",
  );
  assert(
    pageSource.includes("imageAssetCount === 0 && !hasMainImageUrl"),
    "page.tsx's topBlockers 'Add product media' CTA must not fire when a usable Main Image URL already covers it.",
  );

  const contentTabSource = fs.readFileSync(CONTENT_TAB_FILE, "utf8");
  assert(
    contentTabSource.includes('data-hint="main-image-url-scope"') &&
      /alt text|per-channel eligibility/.test(contentTabSource),
    "content-tab.tsx must show inline copy on the Main Image URL field explaining its real scope (fallback image, " +
      "no alt text/eligibility governance) — this is the core of PIM#585: the field gave no indication of what " +
      "saving it would and wouldn't do.",
  );

  const mediaTabSource = fs.readFileSync(MEDIA_TAB_FILE, "utf8");
  assert(
    mediaTabSource.includes("data.hasMainImageUrl") && mediaTabSource.includes("Main Image URL"),
    "media-tab.tsx must surface a note when a Main Image URL fallback is in use but no Media Library assets exist, " +
      "so an operator browsing the Media tab isn't left wondering why the blocker cleared.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "hasUsableMainImageUrl_executed_against_backend_field_precedence_cases_via_real_typescript_transpile",
          "hasUsableMainImageUrl_recognizes_primaryImageUrl_imageUrl_and_image_url_fallbacks_PIM778",
          "reported_bug_scenario_mainImageUrl_set_zero_media_assets_now_recognized_usable",
          "side_rail_channel_readiness_chip_no_longer_ignores_mainImageUrl",
          "overview_tab_media_blocker_count_no_longer_ignores_mainImageUrl",
          "page_media_readiness_card_downgrades_to_warnings_not_blocked_or_silent_ready",
          "page_top_blocker_cta_no_longer_ignores_mainImageUrl",
          "content_tab_field_now_has_inline_scope_disclosure_copy",
          "media_tab_surfaces_fallback_in_use_banner",
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
  console.error("Product media-readiness Main Image URL test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
