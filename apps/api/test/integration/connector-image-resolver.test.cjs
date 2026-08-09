#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * B1 regression test: verifies resolveConnectorImageUrl uses the correct
 * Prisma JSON path for governed main-image lookup and preserves the
 * expected resolution precedence.
 *
 * CASES:
 *   1. governed main asset selected when attributes.mainImageUrl is empty
 *   2. fallback to any asset when no governed main exists
 *   3. explicit attributes.mainImageUrl overrides governed main asset
 *   4. metadata.isMain (wrong depth) must not match as governed main
 */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const RESOLVER_FILE = path.join(
  REPO_ROOT,
  "apps",
  "api",
  "src",
  "marketplace",
  "marketplace.service.ts",
);
const MEDIA_SERVICE_FILE = path.join(
  REPO_ROOT,
  "apps",
  "api",
  "src",
  "media",
  "media.service.ts",
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const resolver = fs.readFileSync(RESOLVER_FILE, "utf8");
  const mediaService = fs.readFileSync(MEDIA_SERVICE_FILE, "utf8");

  // ── Structural: JSON path matches storage schema ──────────────────────

  // CASE 4 prevention: the query must use the full nested path, not top-level
  assert(
    resolver.includes('path: ["governance", "isMain"], equals: true'),
    'resolveConnectorImageUrl must query metadata.governance.isMain, not metadata.isMain. ' +
      'The stored schema nests isMain under metadata.governance (see createAssetFromBuffer).',
  );
  assert(
    !resolver.includes('path: ["isMain"], equals: true'),
    'resolveConnectorImageUrl must NOT use path: ["isMain"] — that queries the wrong depth ' +
      "and would match a hypothetical top-level metadata.isMain instead of the governed flag.",
  );

  // Verify the storage side: isMain is stored under governance
  assert(
    mediaService.includes("governance: {") &&
      mediaService.includes("isMain: input.isMain"),
    "createAssetFromBuffer must store isMain under metadata.governance, " +
      "confirming the resolver path is correct.",
  );

  // ── Precedence: explicit override > governed main > any asset ─────────

  // CASE 3: explicit attributes.mainImageUrl checked first
  const resolverMethod = extractMethod(resolver, "resolveConnectorImageUrl");
  const attributeCheckIndex = resolverMethod.indexOf("firstNonEmptyString");
  const governedQueryIndex = resolverMethod.indexOf('path: ["governance", "isMain"]');
  const fallbackQueryIndex = resolverMethod.indexOf(
    "await this.prisma.tenant().mediaAsset.findFirst",
    governedQueryIndex > 0 ? governedQueryIndex + 1 : 0,
  );

  assert(
    attributeCheckIndex >= 0 && governedQueryIndex >= 0 && fallbackQueryIndex >= 0,
    "resolveConnectorImageUrl must contain all three resolution stages: " +
      "attribute check, governed main query, and fallback query.",
  );
  assert(
    attributeCheckIndex < governedQueryIndex,
    "CASE 3: explicit attributes.mainImageUrl must be checked BEFORE the governed " +
      "main-asset query, preserving the override precedence.",
  );
  assert(
    governedQueryIndex < fallbackQueryIndex,
    "CASE 1/2: governed main-asset query must run BEFORE the generic fallback, " +
      "so a governed main is preferred over an arbitrary recent asset.",
  );

  // CASE 1: governed main query selects by governance.isMain
  assert(
    resolverMethod.includes("mainAsset") &&
      resolverMethod.includes("mainAsset ??"),
    "CASE 1: resolver must name the governed query result 'mainAsset' and use " +
      "nullish coalescing to fall back only when no governed main exists (CASE 2).",
  );

  // ── URL resolution: classify for #483 observation ─────────────────────

  const usesMediaEndpoint = resolverMethod.includes("/media/assets/") &&
    resolverMethod.includes("/file");
  const usesR2PublicUrl = resolverMethod.includes("R2_PUBLIC_URL") &&
    resolverMethod.includes("storagePath");
  const usesLocalApiBase = resolverMethod.includes("PIM_API_BASE_URL") &&
    resolverMethod.includes("isLocalMode");

  assert(
    usesMediaEndpoint && usesLocalApiBase,
    "Local-mode URL resolution must use the backend-neutral /media/assets/:id/file endpoint.",
  );
  assert(
    usesR2PublicUrl,
    "R2-mode URL resolution uses R2_PUBLIC_URL + storagePath (storage-coupled — #483 dependency).",
  );

  // ── Attribute override requires https:// ──────────────────────────────

  assert(
    resolverMethod.includes('.startsWith("https://")'),
    "CASE 3: explicit attribute URL must start with https:// to be accepted as an override. " +
      "Non-https values fall through to MediaAsset resolution.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "CASE_1_governed_main_asset_selected_via_governance_isMain_path",
          "CASE_2_fallback_to_any_asset_when_no_governed_main",
          "CASE_3_explicit_mainImageUrl_overrides_governed_main",
          "CASE_4_top_level_isMain_path_rejected_prevents_wrong_depth_match",
          "precedence_order_attribute_then_governed_then_fallback",
          "local_mode_uses_backend_neutral_media_endpoint",
          "r2_mode_uses_storage_coupled_public_url_483_dependency",
          "attribute_override_requires_https",
        ],
        urlResolution: {
          localMode: "PIM_API_BASE_URL/media/assets/{id}/file (backend-neutral)",
          r2Mode: "R2_PUBLIC_URL/{storagePath} (storage-coupled, #483 dependency)",
        },
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

function extractMethod(source, methodName) {
  const startPattern = new RegExp(
    `(?:private|public|protected)?\\s+(?:async\\s+)?${methodName}\\s*\\(`,
  );
  const match = source.match(startPattern);
  if (!match) {
    return "";
  }
  const startIndex = match.index;
  let depth = 0;
  let inMethod = false;
  for (let i = startIndex; i < source.length; i++) {
    if (source[i] === "{") {
      depth++;
      inMethod = true;
    } else if (source[i] === "}") {
      depth--;
      if (inMethod && depth === 0) {
        return source.slice(startIndex, i + 1);
      }
    }
  }
  return source.slice(startIndex);
}

try {
  run();
} catch (error) {
  console.error("Connector image resolver test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
