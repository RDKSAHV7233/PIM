#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const DEFERRED_SECTION = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "app",
  "products",
  "[id]",
  "_components",
  "product-detail-deferred-section.tsx",
);
const CHANNELS_TAB = path.join(
  REPO_ROOT,
  "apps",
  "web",
  "src",
  "app",
  "products",
  "[id]",
  "_components",
  "channels-tab.tsx",
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(DEFERRED_SECTION, "utf8");
  const channelsTab = fs.readFileSync(CHANNELS_TAB, "utf8");
  assert(
    source.includes("const publishableChannels = channels.filter"),
    "Product page must derive publishable channels from installed connector capabilities.",
  );
  assert(
    channelsTab.includes("{data.publishableChannels.map((channel) => ("),
    "Export-job channel selector must render only publishable channels.",
  );
  assert(
    channelsTab.includes("No installed connector with publish capability is available for this tenant."),
    "UI must show a non-actionable message when no publish-capable connector exists.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "ui_hides_non_publish_channel_actions",
          "ui_renders_publish_capability_empty_state",
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
  console.error("Marketplace capability UI gating test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
