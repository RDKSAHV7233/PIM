#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "settings", "pricing", "page.tsx");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function read(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function run() {
  const page = read(PAGE);

  assert(
    page.includes("await getServerSession()") &&
      page.includes("getMarkets") &&
      page.includes("getCurrencies") &&
      page.includes("getPriceLists") &&
      page.includes('redirect(buildLoginRedirect("/settings/pricing"'),
    "Pricing settings page must derive shared server auth context, load all three pricing dimensions, and redirect expired sessions.",
  );

  assert(
    page.includes("canEdit") &&
      (page.includes('"admin"') || page.includes("admin")) &&
      (page.includes('"editor"') || page.includes("editor")),
    "Pricing settings page must gate write actions to admin and editor roles via a canEdit flag.",
  );

  assert(
    page.includes("Pricing settings unavailable") &&
      page.includes("Markets, currencies, and price list data could not be loaded"),
    "Pricing settings page must show an explicit unavailable state on non-auth backend failures instead of throwing a 500.",
  );

  assert(
    page.includes("PricingSettingsContent") &&
      page.includes("initialMarkets") &&
      page.includes("initialCurrencies") &&
      page.includes("initialPriceLists"),
    "Pricing settings page must pass all three preloaded dimensions to PricingSettingsContent.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "settings_pricing_route_uses_shared_server_auth_context",
          "settings_pricing_route_gates_writes_to_admin_and_editor",
          "settings_pricing_route_renders_unavailable_state_on_backend_failure",
          "settings_pricing_route_passes_all_pricing_dimensions_to_content",
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
  console.error("Settings pricing route contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
