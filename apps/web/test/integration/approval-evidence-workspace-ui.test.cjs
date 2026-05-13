#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const DRAWER_COMPONENT = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "app",
  "quality",
  "approvals",
  "approval-evidence-drawer.tsx",
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(DRAWER_COMPONENT, "utf8");

  assert(
    source.includes('import { AppDrawer } from "@/components/ui/app-drawer";') &&
      source.includes('import { Timeline, type TimelineItem } from "@/components/ui/timeline";') &&
      source.includes('import { EmptyState } from "@/components/ui/empty-state";'),
    "Approval evidence workspace must reuse shared drawer, timeline, and empty-state primitives.",
  );
  assert(
    source.includes('title="Approval Evidence"') &&
      source.includes("Review field-level changes for") &&
      source.includes("Close approval evidence for"),
    "Approval evidence workspace must expose a stable drawer title and close label for reviewers.",
  );
  assert(
    source.includes("Changed fields summary") &&
      source.includes('<span className="font-medium">Before:</span>') &&
      source.includes('<span className="font-medium">After:</span>'),
    "Approval evidence workspace must render before/after field values for changed fields.",
  );
  assert(
    source.includes("No revision evidence recorded yet") &&
      source.includes("Open the product workflow to confirm what changed before approving."),
    "Approval evidence workspace must render a useful empty state when revision history is missing.",
  );
  assert(
    source.includes("Decision note:") &&
      source.includes("Reviewer activity:") &&
      source.includes("Recorded at:"),
    "Approval evidence workspace must surface actor identity, timestamp, and decision note context.",
  );
  assert(
    source.includes("Approve only when blockers are clear.") &&
      source.includes("Use the reviewer note in the queue to capture why the product is returning to the editor.") &&
      source.includes("Open product quality") &&
      source.includes("Open product detail"),
    "Approval evidence workspace must keep blocker guidance and product-context links close to the reviewer.",
  );
  assert(
    source.includes('aria-label={`Review approval evidence for ${productTitle}`}') &&
      source.includes("Review evidence"),
    "Approval evidence workspace must expose a dedicated trigger button per product row.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "approval_evidence_workspace_reuses_shared_primitives",
          "approval_evidence_workspace_exposes_stable_drawer_copy",
          "approval_evidence_workspace_renders_changed_fields",
          "approval_evidence_workspace_handles_empty_revision_history",
          "approval_evidence_workspace_surfaces_actor_timestamp_and_notes",
          "approval_evidence_workspace_keeps_context_links_and_blocker_guidance",
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
  console.error("Approval evidence workspace UI test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
