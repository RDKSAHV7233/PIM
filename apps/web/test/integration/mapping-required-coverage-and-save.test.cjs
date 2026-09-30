#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Regression coverage for DEF-15 and DEF-16 from the 2026-09-30 extended QA run of the mapping wizard.
 *  - DEF-15: on WooCommerce the wizard said "Required fields mapped: Blocked / 2 missing" although the mapping
 *    already covered them as source keys (title -> name, attributes.mainImageUrl -> images.0.src), while the
 *    Readiness card on the same page (the API's rule) said 0 missing. The wizard now uses the API's rule.
 *  - DEF-16: "Save draft version" was a plain button, so a real double-click created two drafts.
 * The coverage helper is executed as code (ts.transpileModule); the components are covered by source contracts.
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
  const { findRequiredCoverage, requiredCoverageBySource } = loadTsModule("lib", "mapping-required-coverage.ts");

  // WooCommerce's real default map (captured from production on 2026-09-30).
  const wooMap = {
    "attributes.mainImageUrl": "images.0.src",
    "attributes.productType": "categories.0.name",
    "attributes.sku": "sku",
    description: "description",
    title: "name",
  };
  const wooRequired = ["title", "attributes.mainImageUrl", "description"];
  const mappedTargetToSource = { description: "description" }; // the only direct target row the old wizard counted

  const covered = requiredCoverageBySource(wooRequired, wooMap, mappedTargetToSource);
  assert(covered.title && covered.title.source === "title" && covered.title.targets[0] === "name", "title is covered as a source key mapped to 'name'.");
  assert(covered["attributes.mainImageUrl"] && covered["attributes.mainImageUrl"].targets[0] === "images.0.src", "attributes.mainImageUrl is covered as a source key.");
  assert(!("description" in covered), "a field with a direct target mapping is not reported as merely covered.");

  assert(findRequiredCoverage("sku", { "attributes.sku": "sku" }).source === "attributes.sku", "a bare required 'sku' matches an attributes.sku source (API normalisation).");
  assert(findRequiredCoverage("attributes.color", { color: "colour" }).source === "color", "a required attributes.color matches a bare 'color' source.");
  assert(findRequiredCoverage("brand", { title: "name" }) === null, "a required field that is neither a source nor a target stays missing.");
  assert(findRequiredCoverage("title", { title: [] }) === null, "an empty target list does not count as covered.");
  assert(findRequiredCoverage("title", { title: ["a", "b", "a"] }).targets.length === 2, "targets are de-duplicated.");
  assert(findRequiredCoverage("", { title: "name" }) === null, "an empty required field is never covered.");
  assert(findRequiredCoverage("attributes.", { "": "x" }) === null, "a bare 'attributes.' prefix is not a field.");
  assert(Object.keys(requiredCoverageBySource(["brand"], wooMap, {})).length === 0, "no coverage is invented for a truly missing field.");

  // ---- wiring: the view model, page counts, editor rows and chip use the coverage ----
  const mappings = read("lib", "channel-mappings.ts");
  assert(
    mappings.includes('from "@/lib/mapping-required-coverage"') &&
      mappings.includes("requiredCoverageBySource(requiredTargetFields, currentFieldMap, mappedTargetToSource)") &&
      mappings.includes("requiredCoveredBySource,"),
    "buildMappingsViewModel must compute and return requiredCoveredBySource (DEF-15).",
  );
  const page = read("app", "channels", "mappings", "page.tsx");
  assert(
    page.includes("viewModel.requiredCoveredBySource[field]") && page.includes("coveredBySource: viewModel.requiredCoveredBySource"),
    "the Review checklist count and the editor must both use the coverage (DEF-15).",
  );
  const editor = read("components", "channel", "mapping-editor.tsx");
  assert(
    editor.includes("coveredBySource?: Record<string, { source: string; targets: string[] }>") &&
      editor.includes("row.required && !row.selectedSource && !row.coveredBy") &&
      editor.includes("row.required && (row.selectedSource || row.coveredBy)"),
    "the editor must not list covered required fields as missing (DEF-15).",
  );
  const fieldRow = read("components", "channel", "mapping-field-row.tsx");
  assert(fieldRow.includes("coveredBy?:") && fieldRow.includes('"Covered"'), "a covered row must show a 'Covered' status, not 'Missing' (DEF-15).");

  // ---- DEF-16: the save button cannot be submitted twice ----
  assert(
    /<PendingSubmitButton[^>]*idleLabel="Save draft version"[^>]*pendingLabel=/.test(editor.replace(/\n\s*/g, " ")),
    "'Save draft version' must be a PendingSubmitButton so a second click is ignored while the first is in flight (DEF-16).",
  );
  assert(!/<Button type="submit" className="w-fit">\s*Save draft version/.test(editor), "the plain 'Save draft version' Button must be gone (DEF-16).");
  assert(editor.includes('from "@/components/ui/pending-submit-button"'), "the editor must import PendingSubmitButton.");

  console.log(JSON.stringify({ status: "ok", validated: ["def15_required_coverage_helper", "def15_wiring", "def16_pending_save_button"] }, null, 2));
}

try {
  run();
} catch (error) {
  console.error("Mapping required-coverage / save test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
