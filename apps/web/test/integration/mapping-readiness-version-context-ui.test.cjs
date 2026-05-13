#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const EDITOR_FILE = path.join(REPO_ROOT, "apps", "web", "src", "components", "channel", "mapping-editor.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(EDITOR_FILE, "utf8");

  assert(
    source.includes("Evaluated mapping versions") &&
      source.includes("Readiness is evaluating the currently published mapping version set, not the unsaved draft.") &&
      source.includes("preflight.matchedVersionIds.join"),
    "Publish readiness card must name the exact published mapping versions being evaluated instead of leaving draft-vs-live scope ambiguous.",
  );
  assert(
    source.includes("No published mapping version is active for this scope yet.") &&
      source.includes("system or tenant default path"),
    "Publish readiness card must explain when readiness is falling back because no published mapping version exists for the scope.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "publish_readiness_names_evaluated_mapping_versions",
          "publish_readiness_explains_no_published_version_fallback",
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
  console.error("Mapping readiness version context UI test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
