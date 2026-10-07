#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

/**
 * SEC-DB-RLS-001 D1 (web side): thumbnails forward the signed token the API's public media file route requires.
 *
 * Runtime part: the real `mediaFileUrl` / `MEDIA_FILE_TOKEN_PATTERN` from apps/web/src/lib/media-file-url.ts are transpiled and run.
 * Source part: both thumbnail components use that helper (never the bare path), and the proxy route forwards only a well-formed token.
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

function loadHelper() {
  const source = read("apps/web/src/lib/media-file-url.ts");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const module = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function("module", "exports", js)(module, module.exports);
  return module.exports;
}

const { mediaFileUrl, MEDIA_FILE_TOKEN_PATTERN } = loadHelper();

// ---- the URL helper --------------------------------------------------------------------------------------------------------------------
assert.equal(mediaFileUrl({ id: "asset-1" }), "/api/media/assets/asset-1/file", "no token field: the plain path, exactly as before");
assert.equal(mediaFileUrl({ id: "asset-1", fileToken: null }), "/api/media/assets/asset-1/file", "a null token (key not configured) is the plain path");
assert.equal(mediaFileUrl({ id: "asset-1", fileToken: "" }), "/api/media/assets/asset-1/file");
assert.equal(mediaFileUrl({ id: "asset-1", fileToken: "   " }), "/api/media/assets/asset-1/file");

const token = "v1.eyJ0IjoidGVuYW50LWIiLCJhIjoiYXNzZXQtMSJ9.c2lnbmF0dXJlLWJ5dGVz";
assert.equal(mediaFileUrl({ id: "asset-1", fileToken: token }), `/api/media/assets/asset-1/file?t=${token}`, "a token is appended as ?t=");
assert.equal(mediaFileUrl({ id: "a b/c", fileToken: token }), `/api/media/assets/a%20b%2Fc/file?t=${token}`, "the id is still encoded");
assert.equal(mediaFileUrl({ id: "asset-1", fileToken: "bad token with spaces & symbols?" }), "/api/media/assets/asset-1/file", "a malformed token is never put into a URL");
assert.equal(mediaFileUrl({ id: "asset-1", fileToken: "x".repeat(2049) }), "/api/media/assets/asset-1/file", "an over-long token is dropped");

// ---- the token pattern accepts exactly what the API mints ------------------------------------------------------------------------------
assert.ok(MEDIA_FILE_TOKEN_PATTERN.test(token));
for (const bad of ["", "has space", "semi;colon", "new\nline", "q?x=1", "a/b", "<script>"]) {
  assert.ok(!MEDIA_FILE_TOKEN_PATTERN.test(bad), `must reject ${JSON.stringify(bad)}`);
}

// ---- both thumbnail components use the helper, never the bare path --------------------------------------------------------------
for (const rel of ["apps/web/src/app/media/page.tsx", "apps/web/src/app/products/[id]/_components/media-tab.tsx"]) {
  const source = read(rel);
  assert.ok(source.includes('import { mediaFileUrl } from "@/lib/media-file-url";'), `${rel} imports mediaFileUrl`);
  assert.ok(source.includes("src={mediaFileUrl(asset)}"), `${rel} builds the thumbnail URL with mediaFileUrl`);
  assert.ok(!source.includes("/api/media/assets/${encodeURIComponent(asset.id)}/file`}"), `${rel} must not build the bare file path itself`);
}

// ---- the asset type carries the token ------------------------------------------------------------------------------------------------
assert.match(read("apps/web/src/lib/api/core.ts"), /fileToken\?: string \| null;/, "MediaAsset declares the optional fileToken");

// ---- the proxy route forwards a validated token only -----------------------------------------------------------------------------------
const route = read("apps/web/src/app/api/media/assets/[id]/file/route.ts");
assert.ok(route.includes('import { MEDIA_FILE_TOKEN_PATTERN } from "@/lib/media-file-url";'), "the route imports the shared token pattern");
assert.ok(route.includes('request.nextUrl.searchParams.get("t")'), "the route reads the token from the query");
assert.ok(route.includes("MEDIA_FILE_TOKEN_PATTERN.test(rawToken)"), "the route validates the token before forwarding it");
assert.ok(/\$\{token \? `\?t=\$\{encodeURIComponent\(token\)\}` : ""\}/.test(route), "the route appends the validated token to the upstream URL, or nothing");
assert.ok(!/searchParams\.get\("t"\)[^;]*upstream/.test(route), "the raw query value is never put straight into the upstream URL");

console.log("media-file-token-forwarding tests passed.");
