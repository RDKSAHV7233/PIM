#!/usr/bin/env node
/* eslint-disable no-console */
// INC-92-S1 (DEF-PC-023): live test of INC-84-S3 on 2026-10-03 showed that a file the API rejects as "not a real
// image" (HTML bytes declared image/png) ended on a bare "500 Internal Server Error" page, because the upload
// server action rethrew the API's 400. It must redirect back with the upload message instead.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const Module = require("node:module");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), "utf8");

function loadHelper() {
  const ts = require("typescript");
  const file = path.join(REPO_ROOT, "apps/web/src/lib/media-upload-errors.ts");
  const { outputText } = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: "media-upload-errors.ts",
  });
  const mod = new Module(file, module);
  mod.filename = file;
  mod._compile(outputText, file);
  return mod.exports;
}

const { isMediaTypeRejection } = loadHelper();
const rejection = { status: 400, body: { error: "VALIDATION_FAILED", message: "x", fields: [{ field: "mimeType", constraints: ["not an image"] }] } };

assert.equal(isMediaTypeRejection(rejection), true, "the API's mimeType rejection is recognised");
assert.equal(isMediaTypeRejection({ ...rejection, status: 500 }), false, "only 400");
assert.equal(isMediaTypeRejection({ status: 400, body: { error: "VALIDATION_FAILED", fields: [{ field: "fileName" }] } }), false, "other validation failures are not hidden");
assert.equal(isMediaTypeRejection({ status: 400, body: { error: "OTHER", fields: [{ field: "mimeType" }] } }), false, "wrong error code");
assert.equal(isMediaTypeRejection({ status: 402, body: { error: "PLAN_LIMIT_EXCEEDED" } }), false, "plan limits keep their own handling");
assert.equal(isMediaTypeRejection({ status: 400, body: "text" }), false);
assert.equal(isMediaTypeRejection(new Error("boom")), false);
assert.equal(isMediaTypeRejection(null), false);

const actions = read("apps/web/src/app/actions.ts");
const uploadFn = actions.slice(actions.indexOf("export async function uploadMediaAssetAction"), actions.indexOf("export async function updateMediaGovernanceAction"));
assert.ok(uploadFn.includes("isMediaTypeRejection(error)"), "uploadMediaAssetAction must use the helper");
assert.ok(uploadFn.includes('uploadError: "invalid-file-content"'), "and redirect with uploadError=invalid-file-content");
assert.ok(
  uploadFn.indexOf("handleSessionExpired(error, returnTo)") < uploadFn.indexOf("isMediaTypeRejection(error)") &&
    uploadFn.indexOf("withPlanLimitQuery(") < uploadFn.indexOf("isMediaTypeRejection(error)") &&
    uploadFn.indexOf("isMediaTypeRejection(error)") < uploadFn.indexOf("throw error;"),
  "session-expired and plan-limit handling stay first; unknown errors are still rethrown",
);
assert.ok(read("apps/web/src/app/media/page.tsx").includes('uploadError === "invalid-file-content"'), "the media page must render the message");

console.log("media-upload-rejection-message.test.cjs: PASS");
