#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Regression coverage for DEF-03, DEF-04 and DEF-06 (2026-09-29 live browser QA of the mapping wizard):
 *  - DEF-03: the publish category rendered as a raw cuid when it was not in the capped search results.
 *  - DEF-04: every publish-category option said "Required attributes: None" while Step 1 said 7 fields were required.
 *  - DEF-06: two versions were labelled "Live" for one scope with nothing showing they belong to different
 *    connector-account scopes, and the "active" one was chosen by date instead of resolver precedence.
 * The two lib helpers are executed as code (ts.transpileModule, same pattern as mapping-version-label.test.cjs);
 * the components are checked with source-contract assertions that they actually use them.
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

function version(id, overrides = {}) {
  return { id, lifecycleState: "published", installationId: null, publishedAt: null, updatedAt: "2026-07-01T00:00:00Z", ...overrides };
}

function run() {
  // ---- DEF-06: scope label + active-version selection ----
  const scope = loadTsModule("lib", "mapping-version-scope.ts");
  assert(scope.presentInstallationScope("inst-1") === "This connector account only", "account-scoped version must say so.");
  assert(scope.presentInstallationScope(null) === "All connector accounts", "slug-scoped version must say it applies to all accounts.");
  assert(scope.presentInstallationScope(undefined) === "All connector accounts", "missing installationId means all accounts.");

  assert(scope.pickActiveVersion([], "inst-1") === null, "no versions means no active version.");
  assert(scope.pickActiveVersion([version("d", { lifecycleState: "draft" })], "inst-1") === null, "drafts are never active.");

  const allAccountsNewer = version("all-newer", { installationId: null, publishedAt: "2026-07-27T00:00:00Z" });
  const accountOlder = version("acct-older", { installationId: "inst-1", publishedAt: "2026-07-13T00:00:00Z" });
  assert(
    scope.pickActiveVersion([allAccountsNewer, accountOlder], "inst-1").id === "acct-older",
    "the account-scoped version wins at resolution, so it must be the active one even when the all-accounts version is newer (the old code chose by date).",
  );
  assert(
    scope.pickActiveVersion([accountOlder, allAccountsNewer], undefined).id === "all-newer",
    "with no account selected the all-accounts version is preferred over another account's.",
  );
  const otherAccount = version("other", { installationId: "inst-2", publishedAt: "2026-08-01T00:00:00Z" });
  assert(
    scope.pickActiveVersion([otherAccount, allAccountsNewer], "inst-1").id === "all-newer",
    "another account's version must never outrank all-accounts for the selected account.",
  );
  const sameScopeOld = version("old", { installationId: "inst-1", publishedAt: "2026-07-01T00:00:00Z" });
  const sameScopeNew = version("new", { installationId: "inst-1", publishedAt: "2026-07-20T00:00:00Z" });
  assert(scope.pickActiveVersion([sameScopeOld, sameScopeNew], "inst-1").id === "new", "within one scope the newest published version wins.");
  assert(scope.pickActiveVersion([version("nopub", { updatedAt: "2026-09-01T00:00:00Z" }), version("older", { updatedAt: "2026-01-01T00:00:00Z" })]).id === "nopub", "publishedAt falls back to updatedAt.");

  const versionManager = read("components", "channel", "version-manager.tsx");
  assert(
    versionManager.includes('from "@/lib/mapping-version-scope"') &&
      versionManager.includes("pickActiveVersion(versions, installationId)") &&
      versionManager.includes("presentInstallationScope(version.installationId)"),
    "VersionManagerCard must show each version's account scope and pick the active version via pickActiveVersion.",
  );
  assert(
    !versionManager.includes("const activeVersion = publishedVersions[0]"),
    "The active version must not be chosen by date alone (DEF-06).",
  );
  assert(
    !versionManager.includes("describePublishedVersion(activeVersion)") && versionManager.includes("versionOrdinals.get(activeVersion.id)"),
    "The active-version card must use the same 'Version N' label as the table, not a raw id prefix.",
  );

  // ---- DEF-03: readable label for a selected publish category missing from the search results ----
  const cat = loadTsModule("lib", "mapping-publish-category.ts");
  const categories = [
    { id: "cat-tshirt", path: "Apparel / T-Shirt" },
    { id: "cat-other", path: "Other" },
  ];
  const opt = cat.buildSelectedPublishCategoryOption("cat-tshirt", [{ id: "cat-other" }], [], categories);
  assert(opt && opt.id === "cat-tshirt" && opt.path === "Apparel / T-Shirt" && opt.requiredAttributes.length === 0, "a selected category missing from the results must get a labelled fallback option.");
  assert(cat.buildSelectedPublishCategoryOption("cat-tshirt", [{ id: "cat-tshirt" }], [], categories) === null, "no fallback when the category is already in the matches.");
  assert(cat.buildSelectedPublishCategoryOption("cat-tshirt", [], [{ id: "cat-tshirt" }], categories) === null, "no fallback when the category is already in the unmapped list.");
  assert(cat.buildSelectedPublishCategoryOption("", [], [], categories) === null, "no selection means no fallback.");
  assert(cat.buildSelectedPublishCategoryOption("unknown-id", [], [], categories) === null, "an id that is not a known category has no label to offer.");

  const page = read("app", "channels", "mappings", "page.tsx");
  assert(
    page.includes('from "@/lib/mapping-publish-category"') &&
      page.includes("buildSelectedPublishCategoryOption(") &&
      page.includes("selectedPublishCategoryFallback?.path"),
    "The mappings page must fall back to the category tree's path before printing a raw id.",
  );
  assert(
    page.includes("selectedPublishCategoryFallback ? [selectedPublishCategoryFallback, ...taxonomyMatches] : taxonomyMatches"),
    "The Step 2 publish-category dropdown must receive the labelled fallback option.",
  );

  // ---- DEF-04: no "Required attributes: None" when nothing is known ----
  const taxonomy = read("components", "channel", "taxonomy-search.tsx");
  assert(!taxonomy.includes('|| "None"'), 'Publish-category cards must not print "Required attributes: None" (DEF-04).');
  assert(
    taxonomy.includes("item.requiredAttributes.length > 0") && taxonomy.includes("Required attributes: {item.requiredAttributes.join"),
    "The required-attributes line must render only when the category lists some.",
  );

  console.log(JSON.stringify({ status: "ok", validated: ["def06_scope_label_and_active_version", "def03_publish_category_label_fallback", "def04_no_required_none_line"] }, null, 2));
}

try {
  run();
} catch (error) {
  console.error("Mapping scope/label clarity test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
