#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");

const ROUTE_LOADING_FILES = [
  "apps/web/src/app/operations/imports/loading.tsx",
  "apps/web/src/app/operations/jobs/loading.tsx",
  "apps/web/src/app/quality/issues/loading.tsx",
  "apps/web/src/app/quality/approvals/loading.tsx",
  "apps/web/src/app/channels/mappings/loading.tsx",
  "apps/web/src/app/channels/submissions/loading.tsx",
  "apps/web/src/app/connectors/loading.tsx",
  "apps/web/src/app/admin/users/loading.tsx",
  "apps/web/src/app/admin/api-keys/loading.tsx",
  "apps/web/src/app/admin/webhooks/loading.tsx",
  "apps/web/src/app/admin/audit/loading.tsx",
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  for (const relativePath of ROUTE_LOADING_FILES) {
    const fullPath = path.join(REPO_ROOT, relativePath);
    assert(fs.existsSync(fullPath), `Missing route loading state: ${relativePath}`);
    const source = fs.readFileSync(fullPath, "utf8");
    assert(
      source.includes('from "@/components/ui/skeleton"'),
      `${relativePath} must use the shared skeleton primitives.`,
    );
    assert(
      source.includes("SkeletonHeader") || source.includes("SkeletonTable") || source.includes("SkeletonBlock"),
      `${relativePath} must render shared skeleton primitives instead of a local loading pattern.`,
    );
    assert(
      !source.includes("animate-pulse"),
      `${relativePath} must not introduce a second loading system with inline animate-pulse markup.`,
    );
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: ROUTE_LOADING_FILES.map((file) => file.replace("apps/web/src/app/", "").replace("/loading.tsx", "")),
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
  console.error("Route loading states test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
