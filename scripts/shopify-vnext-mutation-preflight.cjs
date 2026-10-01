#!/usr/bin/env node
/* eslint-disable no-console */

"use strict";

/**
 * Static-only configuration preflight for Shopify vNext controlled mutations.
 * Calls GET /marketplace/vnext-mutation-config-preflight and prints each check.
 * Exits 0 on READY, 1 on BLOCKED.
 *
 * Required env vars:
 *   PIM_API_URL        e.g. https://app.vexapim.com/api/v1
 *   PIM_API_TOKEN      admin JWT
 *   PREFLIGHT_TENANT_KEY
 *   PREFLIGHT_CONNECTOR_SLUG   (e.g. shopify)
 *   PREFLIGHT_INSTALLATION_ID
 *   PREFLIGHT_PRODUCT_ID
 */

const API_PREFIX = "/api/v1";

function readEnv(name, required = true) {
  const value = String(process.env[name] ?? "").trim();
  if (required && !value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

async function main() {
  const baseUrl = readEnv("PIM_API_URL").replace(/\/+$/, "").replace(/\/api\/v1$/, "");
  const token = readEnv("PIM_API_TOKEN");
  const tenantKey = readEnv("PREFLIGHT_TENANT_KEY");
  const connectorSlug = readEnv("PREFLIGHT_CONNECTOR_SLUG");
  const installationId = readEnv("PREFLIGHT_INSTALLATION_ID");
  const productId = readEnv("PREFLIGHT_PRODUCT_ID");

  const params = new URLSearchParams({ tenantKey, connectorSlug, installationId, productId });
  const url = `${baseUrl}${API_PREFIX}/marketplace/vnext-mutation-config-preflight?${params}`;

  const res = await fetch(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    console.error(`[preflight] HTTP ${res.status}: ${text}`);
    process.exit(1);
  }

  const data = await res.json();
  const checks = Array.isArray(data?.checks) ? data.checks : [];
  const result = data?.result ?? "BLOCKED";

  console.log("\n=== Shopify vNext Mutation Config Preflight ===\n");
  for (const check of checks) {
    const icon = check.result === "PASS" ? "✓" : "✗";
    const detail = check.detail ? `  (${check.detail})` : "";
    console.log(`  ${icon} ${check.name.padEnd(32)} ${check.result}${detail}`);
  }
  console.log(`\nRESULT: ${result}\n`);

  process.exit(result === "READY" ? 0 : 1);
}

main().catch((err) => {
  console.error("[preflight] Fatal:", err.message ?? err);
  process.exit(1);
});
