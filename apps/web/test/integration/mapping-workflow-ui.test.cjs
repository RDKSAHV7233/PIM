#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PAGE_FILE = path.join(REPO_ROOT, "apps", "web", "src", "app", "channels", "mappings", "page.tsx");
const WORKFLOW_FILE = path.join(REPO_ROOT, "apps", "web", "src", "components", "channel", "mapping-workflow.tsx");
const EDITOR_FILE = path.join(REPO_ROOT, "apps", "web", "src", "components", "channel", "mapping-editor.tsx");
const VERSION_FILE = path.join(REPO_ROOT, "apps", "web", "src", "components", "channel", "version-manager.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const pageSource = fs.readFileSync(PAGE_FILE, "utf8");
  const workflowSource = fs.readFileSync(WORKFLOW_FILE, "utf8");
  const editorSource = fs.readFileSync(EDITOR_FILE, "utf8");
  const versionSource = fs.readFileSync(VERSION_FILE, "utf8");

  assert(
    pageSource.includes("MappingWorkflowHeader") &&
      pageSource.includes("MappingContextSummaryCard"),
    "Mappings page must compose the workflow header and context summary cards.",
  );
  assert(
    pageSource.includes("Mapping Workbench") &&
      pageSource.includes("Choose scope") &&
      pageSource.includes("Build the draft") &&
      pageSource.includes("Validate and publish") &&
      pageSource.includes("Operator flow") &&
      workflowSource.includes("Build a publish-ready") &&
      workflowSource.includes("Choose scope") &&
      workflowSource.includes("Build draft") &&
      workflowSource.includes("Validate and publish"),
    "Mappings workflow header must show the publish task context and 3-step progression.",
  );
  assert(
    editorSource.includes('id="mapping-draft"') &&
      editorSource.includes("Required fields still missing") &&
      editorSource.includes("Show mapped required fields") &&
      editorSource.includes("Show optional fields"),
    "Mapping editor must default to a required-first layout with mapped and optional sections collapsed.",
  );
  assert(
    versionSource.includes('id="mapping-history"') &&
      versionSource.includes("Step 3: Validate and publish") &&
      versionSource.includes("After you save a draft, validate it here."),
    "Version manager must be anchored as the validation-and-publish step in the workflow.",
  );
  assert(
    editorSource.includes('id="mapping-readiness"') &&
      editorSource.includes("Use this section after the draft is validated."),
    "Publish readiness must be anchored as the third step with explicit sequencing guidance.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "mappings_page_uses_task_first_workflow_shell",
          "mapping_editor_defaults_to_required_first_layout",
          "version_history_and_readiness_are_explicit_workflow_steps",
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
