#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Regression coverage for DEF-05, DEF-17 and DEF-24 from the 2026-09-30 extended QA run of the mapping wizard.
 *  - DEF-24: the audit page counted read-only readiness/preflight POSTs as "Mutation events". The recorded
 *    trail is unchanged; only the page's classification is.
 *  - DEF-17: "Publish remains blocked" said "publish" where it means publishing products to the channel, next
 *    to a mapping "Publish" button that was enabled.
 *  - DEF-05: about 65 "E2E Test Category" rows showed in the publish-category lists although the source picker
 *    already hides test data.
 */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const SRC = path.join(REPO_ROOT, "apps", "web", "src");
const read = (...parts) => fs.readFileSync(path.join(SRC, ...parts), "utf8");

function loadTsModule(...parts) {
  const ts = require("typescript");
  const Module = require("node:module");
  const file = path.join(SRC, ...parts);
  const { outputText } = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    fileName: path.basename(file),
  });
  const mod = new Module(file, module);
  mod.filename = file;
  mod._compile(outputText, file);
  return mod.exports;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function run() {
  // ---- DEF-24 ----
  const { isEvaluationEvent, isMutationEvent } = loadTsModule("lib", "audit-event-kind.ts");
  const ev = (action, resource) => ({ action, resource });
  assert(isEvaluationEvent(ev("POST", "/api/v1/marketplace/connectors/shopify/publish-readiness")), "publish-readiness is an evaluation.");
  assert(isEvaluationEvent(ev("POST", "/api/v1/marketplace/connectors/woocommerce/mappings/preflight")), "mappings/preflight is an evaluation.");
  assert(isEvaluationEvent(ev("POST", "/marketplace/connectors/flipkart/publish-readiness/")), "the /api/v1 prefix is optional and a trailing slash is tolerated.");
  assert(!isMutationEvent(ev("POST", "/api/v1/marketplace/connectors/shopify/publish-readiness")), "an evaluation is not a mutation.");
  assert(isMutationEvent(ev("POST", "/api/v1/marketplace/connectors/woocommerce/mappings/versions")), "creating a mapping version is a mutation.");
  assert(isMutationEvent(ev("POST", "/api/v1/marketplace/connectors/shopify/mappings/versions/abc/publish")), "publishing a mapping version is a mutation even though it ends in /publish.");
  assert(isMutationEvent(ev("PATCH", "/api/v1/products/1")) && isMutationEvent(ev("DELETE", "/api/v1/products/1")), "PATCH and DELETE stay mutations.");
  assert(!isMutationEvent(ev("consent.recorded", "consent")) && !isMutationEvent(ev("GET", "/x")), "non-mutating actions are not mutations.");
  assert(!isEvaluationEvent(ev("PATCH", "/api/v1/marketplace/connectors/shopify/publish-readiness")), "only POST evaluations are recognised.");
  const audit = read("app", "admin", "audit", "page.tsx");
  assert(
    audit.includes('from "@/lib/audit-event-kind"') &&
      audit.includes("events.items.filter(isMutationEvent)") &&
      audit.includes("events.items.filter(isEvaluationEvent)") &&
      audit.includes("`Evaluations ${evaluationEvents}`"),
    "the audit page must count mutations without evaluations and show evaluations separately (DEF-24).",
  );
  assert(!audit.includes('event.action === "POST" || event.action === "PATCH"'), "the raw verb count must be gone (DEF-24).");

  // ---- DEF-17 ----
  const editor = read("components", "channel", "mapping-editor.tsx");
  assert(editor.includes("Publishing products to this channel stays blocked until mapping completeness and product data readiness are both clear."), "the readiness card must say what is blocked (DEF-17).");
  assert(!editor.includes("Publish remains blocked"), "the ambiguous sentence must be gone (DEF-17).");
  const bar = read("components", "channel", "mapping-blocker-bar.tsx");
  assert(bar.includes("blocking product publishing") && !bar.includes("blocking publish\n"), "the blocker bar must say what it blocks (DEF-17).");

  // ---- DEF-05 ----
  const page = read("app", "channels", "mappings", "page.tsx");
  assert(
    page.includes("const taxonomyMatches = filterTestData(taxonomyMatchesRaw, true)") &&
      page.includes("const unmappedCategories = filterTestData(unmappedCategoriesRaw, true)"),
    "the publish-category lists must hide test data like the source picker does (DEF-05).",
  );

  console.log(JSON.stringify({ status: "ok", validated: ["def24_audit_classification", "def17_wording", "def05_publish_list_test_data"] }, null, 2));
}

try {
  run();
} catch (error) {
  console.error("Mapping follow-ups test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
