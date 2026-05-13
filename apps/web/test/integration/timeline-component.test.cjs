#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const TIMELINE_COMPONENT = path.join(REPO_ROOT, "apps", "web", "src", "components", "ui", "timeline.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(TIMELINE_COMPONENT, "utf8");

  assert(
    source.includes("export interface TimelineItem {") &&
      source.includes('tone?: "neutral" | "success" | "warning" | "danger" | "info";'),
    "Timeline must expose a shared item contract with reusable tone support.",
  );
  assert(
    source.includes("export function Timeline({ items, className }: TimelineProps)") &&
      source.includes("<ol className={cn(\"space-y-3\", className)}>") &&
      source.includes("items.map((item, index) => {"),
    "Timeline must render an ordered shared event list with stable item iteration.",
  );
  assert(
    source.includes("const isLast = index === items.length - 1;") &&
      source.includes("!isLast ? <span className=\"mt-1 min-h-6 w-px flex-1 bg-slate-200\" aria-hidden=\"true\" /> : null"),
    "Timeline must visually connect events while omitting the trailing connector on the last item.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "timeline_component_exposes_shared_item_contract",
          "timeline_component_renders_ordered_event_list",
          "timeline_component_draws_connector_only_between_items",
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
  console.error("Timeline component test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
