#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Regression coverage for DEF-08, DEF-10, DEF-11 (duplicate ids), DEF-12, DEF-13 (mapping page) and DEF-14
 * from the 2026-09-29 live browser QA of the mapping wizard. The label helper is executed as code
 * (ts.transpileModule); the components are covered by source-contract assertions.
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
  // ---- DEF-08: readable label for a mapped attribute that has no attribute definition ----
  const { labelUndefinedSourceField } = loadTsModule("lib", "mapping-source-field-label.ts");
  assert(labelUndefinedSourceField("attributes.size") === "Size (Attribute)", "attributes.size must read 'Size (Attribute)'.");
  assert(labelUndefinedSourceField("attributes.fabric_type") === "Fabric Type (Attribute)", "underscores become spaces and words are capitalised.");
  assert(labelUndefinedSourceField("attributes.a.b") === "A B (Attribute)", "nested keys are split into words.");
  assert(labelUndefinedSourceField("title") === "title", "non-attribute keys are untouched.");
  assert(labelUndefinedSourceField("attributes.") === "attributes.", "an empty attribute name is left as-is.");
  const mappings = read("lib", "channel-mappings.ts");
  assert(mappings.includes("options.set(sourceField, labelUndefinedSourceField(sourceField))"), "buildSourceFieldOptions must label undefined attribute keys.");
  assert(!mappings.includes("options.set(sourceField, sourceField);"), "the raw key must no longer be used as the label (DEF-08).");

  // ---- DEF-10: staying is the primary action, leaving is the quiet destructive one ----
  const guard = read("components", "channel", "mapping-dirty-navigation-guard.tsx");
  assert(/variant="primary" onClick=\{stayInWizard\}/.test(guard), "'Stay on this step' must be the primary button.");
  assert(!guard.includes('variant="destructive"'), "'Leave without saving' must not be the dominant destructive button (DEF-10).");
  assert(guard.includes("beforeunload"), "the guard must keep its beforeunload protection.");

  // ---- DEF-12: each mapping select is named by its channel field ----
  const row = read("components", "channel", "mapping-field-row.tsx");
  assert(row.includes("aria-label={`PIM field for ${row.targetField}`}"), "every mapping select needs an accessible name that includes its channel field (DEF-12).");

  // ---- DEF-11 (ids) and DEF-14 (copy): version manager ----
  const vm = read("components", "channel", "version-manager.tsx");
  assert(vm.includes("render: (version, view) =>") && vm.includes("idSuffix={view}"), "the actions column must pass the DataGrid view so ids stay unique.");
  assert(vm.includes("archive-reason-${version.id}-${view}") && vm.includes("rollback-reason-${version.id}-${view}"), "archive/rollback reason ids must include the view.");
  assert(vm.includes("${label}-${versionId}-${idSuffix}"), "the step-up password id must include the view.");
  assert(!vm.includes("Mobile view keeps validate"), "developer copy must not be shown to users (DEF-14).");
  assert(vm.includes("categoryScopeLabel && version.categoryScope === categoryScopeLabel.id"), "the Scope column must show the category path instead of a raw id (DEF-14).");
  const page = read("app", "channels", "mappings", "page.tsx");
  assert(page.includes("categoryScopeLabel={selectedCategoryPath ?"), "the page must pass the category path to the version manager.");

  // ---- DEF-14: readiness chips and sentence ----
  const editor = read("components", "channel", "mapping-editor.tsx");
  assert(!editor.includes('? "ok" : "blocked"'), "raw lowercase 'ok'/'blocked' chip labels must be gone (DEF-14).");
  assert(
    editor.includes("{isBlocked\n            ? \"Publish remains blocked until") && editor.includes("are both clear.\"\n            : \"Mapping completeness and product data readiness are both clear.\"}"),
    "the 'Publish remains blocked' sentence must only show while something is blocked (DEF-14).",
  );

  // ---- DEF-13: summary tap targets on the mapping page ----
  assert(!page.includes('<summary className="cursor-pointer text-sm font-medium text-slate-900">'), "advanced-drawer summaries need vertical padding to reach a 24px target (DEF-13).");
  assert(editor.includes('<summary className="cursor-pointer py-1.5 text-sm font-medium text-slate-800">Blockers and warnings</summary>'), "the 'Blockers and warnings' summary needs vertical padding (DEF-13).");

  // ---- DEF-11 (aria-current, title) and DEF-13 (breadcrumb targets): shared shell pieces ----
  const sidebar = read("components", "nav", "app-sidebar.tsx");
  assert(sidebar.includes('aria-current={active ? "page" : undefined}'), "the active sidebar item must expose aria-current='page' (DEF-11).");
  assert(page.includes('export const metadata = { title: "Channel Mapping | Vexa PIM" }'), "the mapping page needs its own document title (DEF-11).");
  const header = read("components", "ui", "page-header.tsx");
  assert(header.includes("[&_a]:inline-block [&_a]:py-1"), "breadcrumb links need vertical padding to reach a 24px target (DEF-13).");

  console.log(JSON.stringify({ status: "ok", validated: ["def08_label", "def10_guard_emphasis", "def12_select_names", "def11_unique_ids", "def13_targets", "def14_copy", "def11_aria_current_title", "def13_breadcrumb"] }, null, 2));
}

try {
  run();
} catch (error) {
  console.error("Mapping a11y/copy polish test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
