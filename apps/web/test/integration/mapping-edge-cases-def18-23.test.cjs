#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Regression coverage for DEF-18 to DEF-23 from the 2026-09-30 extended QA run of the mapping wizard.
 *  - DEF-18: "Draft validated: Pass" was satisfied by any validated version, not the operator's newest draft.
 *  - DEF-19: lanes with no connector account gave no guidance and showed the raw slug "amazon-in".
 *  - DEF-20: a search with no matches showed the unfiltered list and no message.
 *  - DEF-21: a 500-character search crashed the page (the API rejects q > 255 characters).
 *  - DEF-22: stepper check marks (2.54:1), pending labels and the "Operator flow" label failed contrast.
 *  - DEF-23: Step 3 rendered every version twice, so a long history made a several-hundred-KB page.
 * The three lib helpers are executed as code (ts.transpileModule); components use source-contract assertions.
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

const v = (id, lifecycleState, createdAt, extra = {}) => ({ id, lifecycleState, createdAt, ...extra });

function run() {
  // ---- DEF-21: query clamp ----
  const { clampTaxonomyQuery, MAX_TAXONOMY_QUERY_LENGTH } = loadTsModule("lib", "mapping-taxonomy-query.ts");
  assert(MAX_TAXONOMY_QUERY_LENGTH === 255, "the clamp must match the API's @MaxLength(255) on q.");
  assert(clampTaxonomyQuery("a".repeat(500)).length === 255, "a 500-character query is cut to 255.");
  assert(clampTaxonomyQuery("  shirts  ") === "shirts", "whitespace is trimmed.");
  assert(clampTaxonomyQuery(undefined) === "" && clampTaxonomyQuery(null) === "", "missing input becomes an empty string.");
  assert(clampTaxonomyQuery("x".repeat(254) + "   y") === "x".repeat(254), "trailing whitespace exposed by the cut is trimmed too.");
  const mappings = read("lib", "channel-mappings.ts");
  assert(
    mappings.includes('from "@/lib/mapping-taxonomy-query"') && mappings.includes("taxonomyQ: clampTaxonomyQuery(query.taxonomyQ)"),
    "parseMappingWizardState must clamp taxonomyQ (DEF-21).",
  );
  const taxonomy = read("components", "channel", "taxonomy-search.tsx");
  assert(taxonomy.includes("maxLength={MAX_TAXONOMY_QUERY_LENGTH}"), "the filter input must stop at the API limit (DEF-21).");

  // ---- DEF-18: working-draft validation ----
  const { isWorkingDraftValidated } = loadTsModule("lib", "mapping-working-draft.ts");
  const pub = v("p", "published", "2026-07-01T00:00:00Z");
  assert(isWorkingDraftValidated([v("d", "draft", "2026-08-01T00:00:00Z"), pub]) === false, "a newer unvalidated draft is not validated even though a version is live.");
  assert(isWorkingDraftValidated([v("val", "validated", "2026-08-01T00:00:00Z"), pub]) === true, "a newer validated draft is validated.");
  assert(
    isWorkingDraftValidated([v("d3", "draft", "2026-08-03T00:00:00Z"), v("d2", "draft", "2026-08-02T00:00:00Z"), v("v1", "validated", "2026-08-01T00:00:00Z")]) === false,
    "an older validated version must not satisfy the check when the newest draft is unvalidated (the QA case).",
  );
  assert(isWorkingDraftValidated([pub]) === true, "with only a live version and no newer draft the mapping counts as validated.");
  assert(isWorkingDraftValidated([]) === false, "no versions means not validated.");
  assert(isWorkingDraftValidated([v("a", "archived", "2026-08-01T00:00:00Z", { archivedAt: "2026-08-02T00:00:00Z" })]) === false, "archived versions do not count.");
  const page = read("app", "channels", "mappings", "page.tsx");
  assert(page.includes("const draftValidated = isWorkingDraftValidated(versions)"), "the checklist must use isWorkingDraftValidated (DEF-18).");
  assert(!page.includes('version.lifecycleState === "validated" || version.lifecycleState === "published");\n    const readinessPassed'), "the any-version check must be gone (DEF-18).");

  // ---- DEF-23: version window ----
  const { selectVisibleVersions, DEFAULT_VERSION_WINDOW } = loadTsModule("lib", "mapping-version-window.ts");
  assert(DEFAULT_VERSION_WINDOW === 10, "default window is 10.");
  const many = Array.from({ length: 16 }, (_, i) => v(`v${i + 1}`, "draft", new Date(2026, 6, i + 1).toISOString()));
  many[1] = { ...many[1], lifecycleState: "published" }; // an old live version
  many[2] = { ...many[2], lifecycleState: "validated" }; // an old validated version
  const windowed = selectVisibleVersions(many, { showAll: false });
  const ids = new Set(windowed.visible.map((x) => x.id));
  assert(windowed.visible.length === 12 && windowed.hiddenCount === 4, `expected 10 newest + live + validated = 12 visible, got ${windowed.visible.length}.`);
  assert(ids.has("v2") && ids.has("v3"), "live and validated versions stay visible even when old.");
  assert(ids.has("v16") && !ids.has("v4"), "the newest are visible and older drafts are hidden.");
  assert(selectVisibleVersions(many, { showAll: true }).hiddenCount === 0, "show-all returns everything.");
  assert(selectVisibleVersions(many.slice(0, 5), { showAll: false }).visible.length === 5, "short histories are untouched.");
  const vm = read("components", "channel", "version-manager.tsx");
  assert(
    vm.includes('from "@/lib/mapping-version-window"') && vm.includes("selectVisibleVersions(versions,") && vm.includes("rows={visibleVersions}"),
    "the version manager must render the windowed list (DEF-23).",
  );
  assert(vm.includes("computeVersionOrdinals(versions)"), "ordinals must still be computed over the full history.");
  assert(vm.includes("allVersionsHref") && vm.includes("Show all"), "the list must offer a way to show every version (DEF-23).");
  assert(mappings.includes('["allVersions", state.showAllVersions ? "1" : ""]'), "the wizard route must carry the show-all flag.");
  assert(page.includes("allVersionsHref="), "the page must pass the show-all link.");

  // ---- DEF-20 / DEF-19: taxonomy card and no-account guidance ----
  assert(taxonomy.includes("No categories match"), "a search with no matches must say so (DEF-20).");
  assert(taxonomy.includes("taxonomyQ ? taxonomyMatches"), "with a filter set, only its matches may be listed (DEF-20).");
  assert(taxonomy.includes("No connector account is installed for") && taxonomy.includes("Connect an account"), "a lane with no account must explain and link to connect one (DEF-19).");
  assert(taxonomy.includes("channelLabel"), "the card must use the channel's display name, not the raw slug (DEF-19).");
  assert(page.includes("channelLabel={selectedChannelRecord?.displayName"), "the page must pass the channel display name (DEF-19).");

  // ---- DEF-22: contrast ----
  const stepper = read("components", "ui", "workflow-stepper.tsx");
  assert(stepper.includes('step.tone === "complete" && "bg-emerald-700 text-white"'), "completed step circles need a darker green for the white check mark (DEF-22).");
  assert(stepper.includes('step.tone === "pending" && "text-slate-500"'), "pending step labels must not be slate-400 (DEF-22).");
  assert(page.includes('text-xs font-semibold uppercase tracking-wide text-slate-600">Operator flow'), "the 'Operator flow' label needs slate-600 (DEF-22).");

  console.log(JSON.stringify({ status: "ok", validated: ["def21_clamp", "def18_working_draft", "def23_version_window", "def19_20_taxonomy_card", "def22_contrast"] }, null, 2));
}

try {
  run();
} catch (error) {
  console.error("Mapping edge-cases test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
