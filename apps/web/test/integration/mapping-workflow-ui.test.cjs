#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PAGE_FILE = path.join(REPO_ROOT, "apps", "web", "src", "app", "channels", "mappings", "page.tsx");
const EDITOR_FILE = path.join(REPO_ROOT, "apps", "web", "src", "components", "channel", "mapping-editor.tsx");
const VERSION_FILE = path.join(REPO_ROOT, "apps", "web", "src", "components", "channel", "version-manager.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const pageSource = fs.readFileSync(PAGE_FILE, "utf8");
  const editorSource = fs.readFileSync(EDITOR_FILE, "utf8");
  const versionSource = fs.readFileSync(VERSION_FILE, "utf8");

  assert(
    pageSource.includes("MappingDirtyNavigationGuard") &&
      pageSource.includes("ScopeSummaryCard") &&
      pageSource.includes("PublishChecklistCard"),
    "Mappings page must compose the wizard shell, current-scope summary, review checklist, and dirty-state protection.",
  );
  assert(
    pageSource.includes("Channel Mapping") &&
      pageSource.includes("Choose Channel & Category") &&
      pageSource.includes("Map Required Fields") &&
      pageSource.includes("Review, Validate & Publish") &&
      pageSource.includes("Operator flow") &&
      pageSource.includes("parseMappingWizardState") &&
      pageSource.includes("resolveRequestedWizardStep") &&
      pageSource.includes("buildMappingRoute") &&
      pageSource.includes("installations={matchingInstallations}") &&
      pageSource.includes("selectedProductId ? Promise.resolve([]) : getProducts") &&
      pageSource.includes("sampleProduct: previewProduct") &&
      pageSource.includes("mode: sampleProductMode") &&
      pageSource.includes("connectorHealthHref={connectorHealthHref}") &&
      pageSource.includes("payloadPreviewHref={payloadPreviewHref}") &&
      pageSource.includes("continueToMapHref") &&
      pageSource.includes("TaxonomyAlignmentCard") &&
      pageSource.includes("AdvancedDrawer"),
    "Mappings page must render the step-based wizard shell, taxonomy-driven scope step, and advanced drawer around the 3-step progression.",
  );
  assert(
    editorSource.includes('id="mapping-draft"') &&
      editorSource.includes("Required fields still missing") &&
      editorSource.includes("Sample product value") &&
      editorSource.includes("Sample source values come from the selected product:") &&
      editorSource.includes("Show mapped required fields") &&
      editorSource.includes("Show optional fields") &&
      editorSource.includes('data-mapping-dirty-form="true"') &&
      editorSource.includes("Open review step"),
    "Mapping editor must default to a required-first layout with sample-value preview, dirty-state tracking, and an explicit forward path into review while scope changes stay in the current-scope summary.",
  );
  assert(
    versionSource.includes('id="mapping-history"') &&
      versionSource.includes("Step 3: Validate and publish") &&
      versionSource.includes("After you save a draft, validate it here."),
    "Version manager must be anchored as the validation-and-publish step in the workflow.",
  );
  assert(
    editorSource.includes('id="mapping-readiness"') &&
      editorSource.includes("Blocked-state recovery") &&
      editorSource.includes("Open connector health") &&
      editorSource.includes("Open payload preview") &&
      editorSource.includes("Use this section after the draft is validated."),
    "Publish readiness must be anchored as the third step with explicit sequencing guidance and blocked-state recovery links.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "mappings_page_uses_wizard_shell",
          "mapping_scope_step_uses_taxonomy_and_publish_category_selection",
          "mapping_editor_defaults_to_required_first_layout_with_dirty_state",
          "mapping_readiness_exposes_blocked_state_recovery",
          "version_history_and_readiness_are_explicit_review_step_surfaces",
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
  console.error("Mapping workflow UI test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
