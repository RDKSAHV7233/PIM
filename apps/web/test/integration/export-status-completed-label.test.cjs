#!/usr/bin/env node
/* eslint-disable no-console */
// BUG-SHP-005: MarketplaceExportJob "completed" was displayed as "Ready to
// submit" (translateExportStatus) with a neutral/gray tone (lifecycleStatusTone),
// even though the header on the same page renders the raw "completed" status.
// A finished, successful export therefore looked unfinished. This test locks
// both the label and the tone for "completed", and proves the shared
// lifecycleStatusTone helper's pre-existing variant-status vocabulary
// (RecordStatus: draft/in_review/approved/rejected/active/archived) is untouched.
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const ERRORS_FILE = path.join(REPO_ROOT, "apps", "web", "src", "lib", "errors.ts");
const SHARED_FILE = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "app",
  "products",
  "[id]",
  "_components",
  "product-detail-shared.tsx",
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function extractFunctionBody(source, functionSignature, fileLabel) {
  const startIndex = source.indexOf(functionSignature);
  assert(startIndex !== -1, `${fileLabel}: could not locate "${functionSignature}"`);
  const braceStart = source.indexOf("{", startIndex);
  assert(braceStart !== -1, `${fileLabel}: could not locate opening brace for "${functionSignature}"`);
  let depth = 0;
  for (let i = braceStart; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        return source.slice(braceStart, i + 1);
      }
    }
  }
  throw new Error(`${fileLabel}: unterminated function body for "${functionSignature}"`);
}

function run() {
  const errorsSource = fs.readFileSync(ERRORS_FILE, "utf8");
  const exportStatusBody = extractFunctionBody(
    errorsSource,
    "export function translateExportStatus",
    "errors.ts",
  );

  // Label fix: "completed" must read as finished, not as a pre-submission state.
  assert(
    /completed:\s*"Export complete"/.test(exportStatusBody),
    'translateExportStatus must map completed -> "Export complete".',
  );
  assert(
    !/completed:\s*"Ready to submit"/.test(exportStatusBody),
    "translateExportStatus must not regress to the pre-fix \"Ready to submit\" label for completed.",
  );
  // The other four export-status labels are untouched by this fix.
  assert(
    /queued:\s*"Queued for export"/.test(exportStatusBody),
    "translateExportStatus: queued label must be unchanged.",
  );
  assert(
    /failed:\s*"Export failed"/.test(exportStatusBody),
    "translateExportStatus: failed label must be unchanged.",
  );

  const sharedSource = fs.readFileSync(SHARED_FILE, "utf8");
  const toneBody = extractFunctionBody(
    sharedSource,
    "export function lifecycleStatusTone",
    "product-detail-shared.tsx",
  );

  // Tone fix: a completed export must render with the success (green) tone,
  // matching the same value the header already renders as "completed".
  const successBranch = toneBody.match(/if \(([^)]*)\)\s*\{\s*return "success";/);
  assert(successBranch, "lifecycleStatusTone: could not locate the success-tone branch.");
  assert(
    /normalized === "completed"/.test(successBranch[1]),
    'lifecycleStatusTone success branch must include normalized === "completed".',
  );

  // Regression guard: the pre-existing RecordStatus/variant vocabulary this
  // helper also serves (draft/in_review/approved/rejected/active/archived,
  // via variants-tab.tsx) must be unaffected by adding the completed branch.
  assert(
    /normalized === "active"/.test(successBranch[1]),
    'lifecycleStatusTone: variant vocabulary regression - "active" must still map to success.',
  );
  const dangerBranch = toneBody.match(/if \(([^)]*)\)\s*\{\s*return "danger";/);
  assert(dangerBranch, "lifecycleStatusTone: could not locate the danger-tone branch.");
  assert(
    /normalized === "failed"/.test(dangerBranch[1]) &&
      /normalized === "dead_letter"/.test(dangerBranch[1]) &&
      /normalized === "rejected"/.test(dangerBranch[1]),
    "lifecycleStatusTone: variant/export vocabulary regression in the danger branch.",
  );
  const warningBranch = toneBody.match(/if \(([^)]*)\)\s*\{\s*return "warning";/);
  assert(warningBranch, "lifecycleStatusTone: could not locate the warning-tone branch.");
  assert(
    /normalized === "retrying"/.test(warningBranch[1]) &&
      /normalized === "queued"/.test(warningBranch[1]) &&
      /normalized === "in_review"/.test(warningBranch[1]) &&
      /normalized === "skipped"/.test(warningBranch[1]),
    "lifecycleStatusTone: variant/export vocabulary regression in the warning branch.",
  );
  assert(
    /if \(normalized === "draft"\)\s*\{\s*return "info";/.test(toneBody),
    'lifecycleStatusTone: variant vocabulary regression - "draft" must still map to info.',
  );

  // RecordStatus (variant.status) never emits "completed" - confirmed against
  // packages/db/prisma/schema.prisma (draft/in_review/approved/rejected/active/archived).
  // The new branch is inert for variants-tab.tsx's caller; this asserts that
  // contract, not just the code shape, so a future RecordStatus rename would
  // fail this test rather than silently drifting.
  const schemaSource = fs.readFileSync(
    path.join(REPO_ROOT, "packages", "db", "prisma", "schema.prisma"),
    "utf8",
  );
  const recordStatusMatch = schemaSource.match(/enum RecordStatus \{([^}]*)\}/);
  assert(recordStatusMatch, "packages/db/prisma/schema.prisma: could not locate enum RecordStatus.");
  assert(
    !/\bcompleted\b/.test(recordStatusMatch[1]),
    'RecordStatus must not contain "completed" - lifecycleStatusTone\'s new branch would no longer be provably inert for variant.status.',
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "translate_export_status_completed_is_export_complete",
          "translate_export_status_completed_no_longer_ready_to_submit",
          "lifecycle_status_tone_completed_is_success",
          "lifecycle_status_tone_variant_vocabulary_unaffected",
          "record_status_enum_has_no_completed_value",
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
  console.error("BUG-SHP-005 export-status completed label/tone regression test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
