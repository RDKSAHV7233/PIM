#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const HOME_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "page.tsx");
const LAYOUT_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "layout.tsx");
const INTERNAL_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "internal", "developer", "page.tsx");
const AI_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "ai", "page.tsx");
const ONDC_PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "ondc", "page.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const homeSource = fs.readFileSync(HOME_PAGE, "utf8");
  const layoutSource = fs.readFileSync(LAYOUT_PAGE, "utf8");
  const internalSource = fs.readFileSync(INTERNAL_PAGE, "utf8");
  const aiSource = fs.readFileSync(AI_PAGE, "utf8");
  const ondcSource = fs.readFileSync(ONDC_PAGE, "utf8");

  assert(
    !homeSource.includes('developer: "/internal/developer"'),
    "Root tab redirects must not expose internal developer routing.",
  );
  assert(
    layoutSource.includes("<AppSidebar showInternal={false} />"),
    "Seller-facing app navigation must hide internal lab routes by default.",
  );
  assert(
    internalSource.includes("notFound();") && internalSource.includes('actorRole !== "admin"'),
    "Developer page must be hard-gated away from seller-facing access.",
  );
  assert(
    aiSource.includes("notFound();") && aiSource.includes('process.env.APP_ENV === "production"'),
    "AI page must be hidden from production and non-admin access.",
  );
  assert(
    ondcSource.includes("notFound();") &&
      ondcSource.includes('process.env.APP_ENV === "production"') &&
      ondcSource.includes("FEATURE_ONDC_ENABLED"),
    "ONDC page must be hidden from seller-facing access unless explicitly enabled internally.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "internal_routes_removed_from_seller_entrypoints",
          "internal_pages_gated_to_admin_nonprod",
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
  console.error("Internal surface gating test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
