#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

/**
 * SEC-DB-RLS-001 positive-result test: provisioning a tenant must leave it with its default pricing (market, currency, price
 * list).
 *
 * TenantDirectoryService seeds that data on a best-effort basis through the context-free direct client and only logs a warning
 * if it fails. Under an RLS-enforced runtime role the seed fails silently, so a test that merely checks "no error" passes while
 * every new tenant is left without pricing. This test asserts the non-empty outcome through the admin connection, which is what
 * the restricted-role lane needs in order to catch the failure.
 */
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { PrismaClient } = require("@prisma/client");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "main.js");
let restrictedLaneStage = "STARTUP";

function setDefaultEnv(name, value) {
  if (!process.env[name] || String(process.env[name]).trim().length === 0) {
    process.env[name] = value;
  }
}

function prepareEnv() {
  const local = "postgresql://postgres:postgres@localhost:5432/pim1?schema=public";
  const url = String(process.env.DATABASE_URL ?? "").trim();
  if (!url || /\bHOST:5432\b/.test(url)) {
    process.env.DATABASE_URL = local;
  }
  process.env.DATABASE_URL_POOLED = process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL;
  process.env.DATABASE_URL_DIRECT = process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL;
  setDefaultEnv("JWT_SECRET", "vexa-pim-local-dev-jwt-secret-minimum-length-32");
  setDefaultEnv("JWT_EXPIRY", "4h");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_V1", "vexa-pim-local-encryption-key-v1-minimum-32");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION", "1");
  setDefaultEnv("REDIS_URL", "redis://localhost:6379");
  setDefaultEnv("JWT_BLOCKLIST_REDIS_DISABLED", "true");
  setDefaultEnv("PIM_AUTH_REDIS_DISABLED", "true");
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "vexa-pim-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/vexa-pim-local");
  setDefaultEnv("APP_ENV", "development");
  setDefaultEnv("PIM_DEFAULT_ROLE", "admin");
  setDefaultEnv("FEATURE_REAL_SPAPI_VALIDATION", "false");
  setDefaultEnv("PIM_AUTH_PASSWORD", "vexa-pim-demo-password");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForHealth(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${baseUrl}/health`);
      if (response.ok) {
        return;
      }
    } catch {
      /* retry */
    }
    await sleep(400);
  }
  throw new Error(`API did not become healthy within ${timeoutMs}ms`);
}

async function main() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }
  const runId = Date.now().toString();
  const port = 5100 + Math.floor(Math.random() * 100);
  const baseUrl = `http://127.0.0.1:${port}/api/v1`;
  const platformToken = `prov-pricing-${runId}`;
  const tenantKey = `prov-pricing-tenant-${runId}`;
  const workspaceSlug = `pp-${runId}`.slice(0, 24);
  const userId = `prov-pricing-${runId}@example.com`;

  const api = spawn("node", [API_ENTRY], {
    cwd: REPO_ROOT,
    env: { ...process.env, PORT: String(port), AUTH_MODE: "db", PIM_PLATFORM_ADMIN_TOKEN: platformToken, PIM_ALLOW_LEGACY_HEADERS: "false", PIM_AUTH_IDENTITIES_JSON: "", PIM_AUTH_WORKSPACES_JSON: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const tail = [];
  const keep = (chunk) => {
    tail.push(String(chunk));
    if (tail.length > 80) {
      tail.shift();
    }
  };
  api.stdout.on("data", keep);
  api.stderr.on("data", keep);
  const admin = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });

  try {
    restrictedLaneStage = "API_HEALTH";
    await waitForHealth(baseUrl, 60_000);
    restrictedLaneStage = "TENANT_PROVISIONING";
    const response = await fetch(`${baseUrl}/platform/tenants`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-pim-platform-admin-token": platformToken },
      body: JSON.stringify({ tenantKey, workspaceSlug, displayName: `Provisioning pricing ${runId}`, initialAdminUserId: userId, initialAdminPassword: process.env.PIM_AUTH_PASSWORD }),
    });
    if (response.status !== 201) {
      throw new Error(`provisioning failed: expected 201, got ${response.status} ${await response.text()}`);
    }
    restrictedLaneStage = "PRICING_ASSERT";
    const [markets, currencies, priceLists] = await Promise.all([
      admin.market.count({ where: { tenantKey } }),
      admin.currency.count({ where: { tenantKey } }),
      admin.priceList.count({ where: { tenantKey } }),
    ]);
    if (markets < 1 || currencies < 1 || priceLists < 1) {
      const warned = tail.join("").includes("Default pricing seed failed");
      throw new Error(`a newly provisioned tenant has no default pricing: markets=${markets} currencies=${currencies} priceLists=${priceLists}; API logged the non-fatal seed warning: ${warned}`);
    }
    console.log(`tenant provisioning default pricing test passed (markets=${markets}, currencies=${currencies}, priceLists=${priceLists})`);
  } finally {
    api.kill("SIGKILL");
    await admin.$disconnect().catch(() => undefined);
  }
}

main().catch((error) => {
  console.error(`SAFE_RESTRICTED_LANE_STAGE=${restrictedLaneStage}`);
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});
