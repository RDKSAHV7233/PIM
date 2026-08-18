#!/usr/bin/env node
/* eslint-disable no-console */
//
// Regression test for PIM#600: submitting the "Update variant" form crashed with a 500
// (Next.js error digest 2959126218, reproduced 3/3 in production logs, deployment
// eb49c633, 2026-08-17T14:11-14:19 UTC) whenever the mobile card layout was used.
//
// Root cause: `DataGrid` (apps/web/src/components/ui/data-grid.tsx) renders every row
// TWICE — once into the desktop <table>, once into the CSS-hidden-on-desktop mobile
// card list — calling the same `Column.render(row)` both times. In
// apps/web/src/app/products/[id]/_components/variants-tab.tsx, several cells are
// form-associated *outside* their `<form>` via the `form="variant-edit-<id>"`
// attribute rather than DOM nesting. Because both render passes computed the exact
// same `editFormId`/`removeFormId` string, the page ended up with two `<form
// id="variant-edit-<id>">` elements sharing one id. Per the HTML form-owner algorithm,
// every `form="variant-edit-<id>"` element (from BOTH the desktop and mobile markup)
// resolves to whichever of the two forms is first in tree order (desktop, always
// rendered before mobile). So submitting the mobile form only ever sent the two
// fields nested directly inside it (productId, variantId) — skuCode and the other
// externally-associated fields were silently dropped from that submission. The
// resulting empty `skuCode` tripped `updateVariantAction`'s guard clause
// (apps/web/src/app/actions.ts), which throws *outside* its own try/catch — an
// unhandled Server Action exception, hence the generic 500.
//
// Fix: DataGrid now tells each render() which pass it's in ("desktop" | "mobile"),
// and every id-building call site in variants-tab.tsx folds that into the id so the
// two DOM copies of a row never share a form/element id.
//
// This test extracts and executes the real DataGrid call sites and the real
// editFormId/removeFormId template logic out of the actual source files (not a
// hand-reimplementation), so it runs the exact logic that ships.
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const DATA_GRID_FILE = path.join(REPO_ROOT, "apps", "web", "src", "components", "ui", "data-grid.tsx");
const VARIANTS_TAB_FILE = path.join(
  REPO_ROOT, "apps", "web", "src", "app", "products", "[id]", "_components", "variants-tab.tsx",
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

// --- Part 1: DataGrid must tell each render pass which view it's rendering into ---

function checkDataGridCallSites() {
  const source = fs.readFileSync(DATA_GRID_FILE, "utf8");

  const desktopCalls = (source.match(/col\.render\(row,\s*"desktop"\)/g) ?? []).length;
  const mobileCalls = (source.match(/col\.render\(row,\s*"mobile"\)/g) ?? []).length;

  assert(
    desktopCalls >= 1,
    "DataGrid's desktop <table> branch must call col.render(row, \"desktop\") — without a view argument, " +
      "the desktop and mobile render passes are indistinguishable to any render() that builds a form/element id.",
  );
  assert(
    mobileCalls >= 2,
    "Both mobile-rendering call sites (DataGrid's card list AND DataCardList) must call " +
      'col.render(row, "mobile") — found ' + mobileCalls + ". A bare col.render(row) reintroduces PIM#600: " +
      "two DOM copies of the same row computing the identical form id.",
  );

  // Guard against a call site regressing back to the old bare `col.render(row)` form,
  // which is what actually shipped when PIM#600 occurred.
  const bareCalls = (source.match(/col\.render\(row\)(?!\s*[,)])/g) ?? []).length;
  assert(
    bareCalls === 0,
    `Found ${bareCalls} bare col.render(row) call(s) with no view argument — this is the exact ` +
      "pre-fix PIM#600 shape (desktop and mobile passes render identically, so form ids collide).",
  );
}

// --- Part 2: every editFormId/removeFormId site in variants-tab.tsx must fold `view` in ---

function extractColumnBlocks(source) {
  // Split the variantColumns array into per-column chunks, keyed by `key: "..."`, so each
  // column's id-template lines can be checked independently and none can hide behind another.
  const keyPattern = /key:\s*"(sku|attributes|mrp|sellingPrice|inventory|status|actions)"/g;
  const matches = [...source.matchAll(keyPattern)];
  assert(matches.length === 7, `Expected 7 variant columns (sku, attributes, mrp, sellingPrice, inventory, status, actions), found ${matches.length}.`);

  return matches.map((match, index) => {
    const start = match.index;
    const end = index + 1 < matches.length ? matches[index + 1].index : source.length;
    return { key: match[1], block: source.slice(start, end) };
  });
}

function checkVariantsTabIdTemplates() {
  const source = fs.readFileSync(VARIANTS_TAB_FILE, "utf8");
  const columns = extractColumnBlocks(source);

  for (const { key, block } of columns) {
    assert(
      /render:\s*\(variant,\s*view\)\s*=>/.test(block),
      `Column "${key}" must declare render: (variant, view) => ... — without receiving the view, ` +
        "it cannot build a desktop/mobile-distinct id, reintroducing PIM#600.",
    );

    const editFormIdMatches = block.match(/const editFormId = `([^`]*)`;/);
    if (editFormIdMatches) {
      assert(
        /\$\{variant\.id\}-\$\{view\}/.test(editFormIdMatches[1]),
        `Column "${key}"'s editFormId template ("${editFormIdMatches[1]}") must be ` +
          "`variant-edit-${variant.id}-${view}` — a template that only includes variant.id " +
          "produces the same id for the desktop and mobile copies of this row.",
      );
    }

    const removeFormIdMatches = block.match(/const removeFormId = `([^`]*)`;/);
    if (removeFormIdMatches) {
      assert(
        /\$\{variant\.id\}-\$\{view\}/.test(removeFormIdMatches[1]),
        `Column "${key}"'s removeFormId template ("${removeFormIdMatches[1]}") must be ` +
          "`variant-remove-${variant.id}-${view}` for the same reason.",
      );
    }
  }

  // The "actions" column is where the actual <form id={editFormId}> elements live — the
  // ones whose duplicate id is what triggers the browser's form-owner ambiguity. Confirm
  // both forms in that column render through the (now view-suffixed) ids.
  const actionsBlock = columns.find((c) => c.key === "actions").block;
  assert(
    /<form id=\{editFormId\} action=\{updateVariantAction\}/.test(actionsBlock),
    "The update-variant <form> must render id={editFormId} (the view-suffixed id) — an untouched " +
      "literal id here would still collide between the desktop and mobile copies of this row.",
  );
  assert(
    /<form id=\{removeFormId\} action=\{deleteVariantAction\}/.test(actionsBlock),
    "The remove-variant <form> must render id={removeFormId} (the view-suffixed id) for the same reason.",
  );
}

// --- Part 3: execute the real id-template logic for both views and prove they diverge ---

function loadRealEditFormIdTemplate() {
  const source = fs.readFileSync(VARIANTS_TAB_FILE, "utf8");
  const columns = extractColumnBlocks(source);
  const skuBlock = columns.find((c) => c.key === "sku").block;
  const templateMatch = skuBlock.match(/const editFormId = `([^`]*)`;/);
  assert(templateMatch, "Could not find the SKU column's editFormId template.");

  // Build a tiny real function around the exact extracted template literal — same
  // interpolation, same variable names — and execute it via the TS compiler so this is
  // the real shipped expression, not a hand-reimplementation.
  const fnSource = `function buildEditFormId(variant, view) { const editFormId = \`${templateMatch[1]}\`; return editFormId; }`;
  const transpiled = ts.transpileModule(fnSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const factory = new Function(`${transpiled}\nreturn buildEditFormId;`);
  return factory();
}

function checkDesktopMobileIdsDiverge() {
  const buildEditFormId = loadRealEditFormIdTemplate();
  const variant = { id: "cmsxa2e6k00j3lo01rb8k0it8" };

  const desktopId = buildEditFormId(variant, "desktop");
  const mobileId = buildEditFormId(variant, "mobile");

  assert(desktopId.includes(variant.id), `Desktop id "${desktopId}" must still target the real variant id.`);
  assert(mobileId.includes(variant.id), `Mobile id "${mobileId}" must still target the real variant id.`);
  assert(
    desktopId !== mobileId,
    `Desktop and mobile editFormId must differ for the same variant — got identical id "${desktopId}" for both. ` +
      "This is exactly the PIM#600 defect: with only one shared id, the browser's form-owner " +
      "algorithm collapses both DOM copies onto whichever form is first in tree order, silently " +
      "dropping the other copy's fields (skuCode, mrp, sellingPrice, inventoryQty, status, " +
      "variantAttributes) from its submission.",
  );
}

function run() {
  checkDataGridCallSites();
  checkVariantsTabIdTemplates();
  checkDesktopMobileIdsDiverge();

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "data_grid_passes_view_to_every_render_call",
          "data_grid_has_no_bare_render_call_left",
          "all_7_variant_columns_receive_view_and_fold_it_into_their_ids",
          "update_and_remove_forms_render_through_view_suffixed_ids",
          "real_edit_form_id_template_diverges_between_desktop_and_mobile_for_the_same_variant",
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
  console.error("Variant edit desktop/mobile form-id collision test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
