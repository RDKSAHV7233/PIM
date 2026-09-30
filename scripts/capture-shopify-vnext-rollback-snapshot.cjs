#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require("node:fs");
const path = require("node:path");

const {
  buildRailwayExecutionEnv,
  readRailwayVariablesAcrossServiceTargets,
  resolveConfig,
} = require("./railway-deploy.cjs");

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = "true";
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function requireArg(args, name) {
  const value = String(args[name] ?? "").trim();
  if (!value) {
    throw new Error(`Missing required argument --${name}`);
  }
  return value;
}

function applyRailwayRuntimeVariables() {
  const hasCredentialKey = Object.keys(process.env).some((key) => key.startsWith("CREDENTIAL_ENCRYPTION_KEY_"));
  if (hasCredentialKey && (process.env.DATABASE_URL_DIRECT || process.env.DATABASE_URL)) {
    return;
  }

  const config = resolveConfig(process.env);
  const railwayEnv = buildRailwayExecutionEnv(process.env);
  const variables = readRailwayVariablesAcrossServiceTargets(
    config,
    railwayEnv,
    config.apiServiceTargets,
    "API runtime env vars",
  );

  for (const [key, value] of Object.entries(variables)) {
    if (
      key === "CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION" ||
      key.startsWith("CREDENTIAL_ENCRYPTION_KEY_") ||
      key === "DATABASE_URL_DIRECT" ||
      key === "DATABASE_URL" ||
      key === "DATABASE_URL_POOLED" ||
      key.startsWith("PIM_SHOPIFY_")
    ) {
      process.env[key] ||= String(value ?? "");
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const tenant = requireArg(args, "tenant");
  const connector = requireArg(args, "connector");
  const installation = requireArg(args, "installation");
  const product = requireArg(args, "product");
  const release = requireArg(args, "release");
  const shopifyProductGid = requireArg(args, "shopifyProductGid");
  const outputPath = requireArg(args, "output");
  const runUrl = String(args.runUrl ?? "").trim();
  const correlationId = `vnext_rollback_${release.slice(0, 12)}_${Date.now()}`;

  process.env.DATABASE_URL_DIRECT ||= process.env.STAGING_DATABASE_URL_DIRECT || "";
  process.env.DATABASE_URL ||= process.env.STAGING_DATABASE_URL || process.env.DATABASE_URL_DIRECT || "";
  applyRailwayRuntimeVariables();

  const { PrismaDirectService } = require("../apps/api/dist/prisma/prisma-direct.service.js");
  const { ShopifyConnector } = require("../apps/api/dist/connectors/shopify/shopify.connector.js");
  const { ShopifyApiClient } = require("../apps/api/dist/connectors/shopify/shopify-api-client.service.js");
  const { buildCompensatingWritePayload } = require("../apps/api/dist/connectors/shopify/shopify-vnext-mutation-adapter.js");

  const logger = {
    info(message, meta) {
      console.error(JSON.stringify({ level: "info", message, meta }));
    },
    warn(message, meta) {
      console.error(JSON.stringify({ level: "warn", message, meta }));
    },
    error(message, meta) {
      console.error(JSON.stringify({ level: "error", message, meta }));
    },
  };

  const prismaDirect = new PrismaDirectService();
  const apiClient = new ShopifyApiClient(logger);
  const shopifyConnector = new ShopifyConnector(prismaDirect, logger, apiClient);
  const ctx = {
    tenantId: tenant,
    installationId: installation,
    connectorId: connector,
    fetch: global.fetch,
    getAccessToken: async () => shopifyConnector.requireCredential(ctx, "access_token"),
  };

  try {
    const snapshot = await shopifyConnector.captureRollbackSnapshot(ctx, shopifyProductGid, { correlationId });
    const compensatingPayload = buildCompensatingWritePayload(snapshot, correlationId);
    const evidence = {
      releaseSha: release,
      runUrl,
      capturedAt: new Date().toISOString(),
      tuple: { tenant, connector, installation, product, release },
      shopifyProductGid,
      correlationId,
      snapshot,
      compensatingPayload,
    };
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`);
    console.log(`Wrote Shopify vNext rollback snapshot evidence to ${outputPath}`);
  } finally {
    await prismaDirect.onModuleDestroy();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : String(error));
  process.exit(1);
});
