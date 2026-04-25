#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const WEB_CHANNELS = path.join(REPO_ROOT, "apps", "web", "src", "lib", "marketplace-channels.ts");
const API_CHANNELS = path.join(REPO_ROOT, "apps", "api", "src", "marketplace", "marketplace-channels.ts");
const MARKETPLACE_SERVICE = path.join(REPO_ROOT, "apps", "api", "src", "marketplace", "marketplace.service.ts");
const CONNECTOR_MAPPING_SERVICE = path.join(REPO_ROOT, "apps", "api", "src", "marketplace", "connector-mapping.service.ts");
const SERVER_SESSION = path.join(REPO_ROOT, "apps", "web", "src", "lib", "server-session.ts");
const CATALOG_CONTROLLER = path.join(REPO_ROOT, "apps", "api", "src", "catalog", "catalog.controller.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function read(file) {
  return fs.readFileSync(file, "utf8");
}

function run() {
  const webChannels = read(WEB_CHANNELS);
  const apiChannels = read(API_CHANNELS);
  const marketplaceService = read(MARKETPLACE_SERVICE);
  const connectorMappingService = read(CONNECTOR_MAPPING_SERVICE);
  const serverSession = read(SERVER_SESSION);
  const catalogController = read(CATALOG_CONTROLLER);

  assert(webChannels.includes('"shopify"'), "web channel constants must include Shopify");
  assert(apiChannels.includes('"shopify"'), "API channel constants must include Shopify");
  assert(webChannels.includes('shopify: "shopify"'), "web channel-to-connector map must include Shopify");
  assert(apiChannels.includes('shopify: "shopify"'), "API channel-to-connector map must include Shopify");
  assert(marketplaceService.includes("displayName: \"Shopify\""), "marketplace channel packs must include Shopify");
  assert(connectorMappingService.includes("shopify: {"), "connector mapping defaults must include Shopify");
  assert(serverSession.includes("parseUnverifiedToken"), "web session role resolver must handle deployments without local JWT verification");
  assert(
    catalogController.includes('@Roles("admin", "editor")') &&
      catalogController.includes('@Post("products")') &&
      catalogController.includes('@Delete("products/:id")'),
    "catalog write endpoints must be protected by backend roles",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "shopify_available_in_web_mapping_channels",
          "shopify_available_in_api_mapping_channels",
          "shopify_system_mapping_pack_present",
          "shopify_connector_mapping_defaults_present",
          "role_ui_fallback_present_for_web_runtime_without_jwt_secret",
          "catalog_write_endpoints_have_backend_role_guards",
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
  console.error("Shopify channel surface test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
