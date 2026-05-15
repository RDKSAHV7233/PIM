#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Regression test: Shopify productSet payload shape (API 2025-01+)
 *
 * Verifies that publishProduct sends:
 *   1. identifier.handle (not customId)
 *   2. input.metafields includes pim_connector/sku
 *   3. input.variants is present with optionValues (required by Shopify since API 2024-10)
 *   4. productVariantsBulkUpdate is called after productSet with price + SKU
 */
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "main.js");

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || /^\s*#/.test(line)) continue;
    const index = line.indexOf("=");
    if (index === -1) continue;
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^"|"$/g, "");
    if (key && !process.env[key]) process.env[key] = value;
  }
}

function setDefaultEnv(name, value) {
  if (!process.env[name] || String(process.env[name]).trim().length === 0) {
    process.env[name] = value;
  }
}

function prepareEnv() {
  readEnvFile(path.join(REPO_ROOT, ".env"));
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    setDefaultEnv("DATABASE_URL_POOLED", databaseUrl);
    setDefaultEnv("DATABASE_URL_DIRECT", databaseUrl);
  }
  setDefaultEnv("JWT_SECRET", "vexa-pim-local-dev-jwt-secret-minimum-length-32");
  setDefaultEnv("JWT_EXPIRY", "4h");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_V1", "vexa-pim-local-encryption-key-v1-minimum-32");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION", "1");
  setDefaultEnv("REDIS_URL", "redis://localhost:6379");
  setDefaultEnv("JWT_BLOCKLIST_REDIS_DISABLED", "true");
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "vexa-pim-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/vexa-pim-local");
  setDefaultEnv("APP_ENV", "development");
  setDefaultEnv("PIM_DEFAULT_ROLE", "admin");
}

function assert(condition, message) {
  if (!condition) throw new Error(`ASSERTION FAILED: ${message}`);
}

function createShopifyStub() {
  const calls = [];

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      if (req.method !== "POST") {
        res.statusCode = 404;
        res.end();
        return;
      }

      const chunks = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks).toString("utf8");
      const parsed = body ? JSON.parse(body) : {};
      const query = String(parsed.query || "");
      const variables = parsed.variables || {};
      calls.push({ query, variables });

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");

      if (query.includes("publications(first: 50)")) {
        res.end(JSON.stringify({
          data: {
            publications: {
              nodes: [{ id: "gid://shopify/Publication/99", name: "Online Store", catalog: { __typename: "AppCatalog", id: "gid://shopify/AppCatalog/99", title: "Online Store", status: "ACTIVE" } }],
            },
          },
        }));
        return;
      }

      if (query.includes("mutation UpsertProduct")) {
        res.end(JSON.stringify({
          data: {
            productSet: {
              product: {
                id: "gid://shopify/Product/7777",
                handle: "payload-test-sku-payload-001",
                status: "ACTIVE",
                variants: { edges: [{ node: { id: "gid://shopify/ProductVariant/8888" } }] },
              },
              userErrors: [],
            },
          },
        }));
        return;
      }

      if (query.includes("mutation BulkUpdateVariant")) {
        res.end(JSON.stringify({
          data: {
            productVariantsBulkUpdate: {
              productVariants: [{ id: "gid://shopify/ProductVariant/8888", price: "299.00" }],
              userErrors: [],
            },
          },
        }));
        return;
      }

      if (query.includes("mutation PublishProduct")) {
        res.end(JSON.stringify({
          data: {
            publishablePublish: {
              publishable: { publishedOnPublication: true },
              userErrors: [],
            },
          },
        }));
        return;
      }

      res.end(JSON.stringify({ data: {} }));
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not bind stub server."));
        return;
      }
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}`, calls });
    });
  });
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const tenantKey = `shopify-payload-${runId}`;
  const installationId = `inst_pl_${runId}`;
  const stub = await createShopifyStub();

  process.env.PIM_SHOPIFY_CLIENT_ID = "shopify-client-id";
  process.env.PIM_SHOPIFY_CLIENT_SECRET = "shopify-client-secret";
  process.env.PIM_SHOPIFY_ADMIN_API_BASE_URL = stub.baseUrl;
  process.env.PIM_SHOPIFY_ADMIN_API_VERSION = "2026-04";

  let prismaDirect;
  try {
    const { PrismaDirectService } = require(path.join(REPO_ROOT, "apps", "api", "dist", "prisma", "prisma-direct.service.js"));
    const { LoggerService } = require(path.join(REPO_ROOT, "apps", "api", "dist", "common", "logging", "logger.service.js"));
    const { ConnectorCredentialEncryptionService } = require(path.join(REPO_ROOT, "apps", "api", "dist", "connector-installer", "credential-encryption.service.js"));
    const { ShopifyConnector } = require(path.join(REPO_ROOT, "apps", "api", "dist", "connectors", "shopify", "shopify.connector.js"));

    prismaDirect = new PrismaDirectService();
    await prismaDirect.onModuleInit();
    const db = prismaDirect.getClient();
    const logger = new LoggerService();
    const encryption = new ConnectorCredentialEncryptionService(prismaDirect, logger);
    const connector = new ShopifyConnector(prismaDirect, logger);

    await db.$executeRawUnsafe(
      `
      INSERT INTO connector_installations (id, tenant_key, connector_id, account_alias, status, metadata, installed_by, created_at, updated_at)
      VALUES ($1, $2, 'cdef_shopify', 'primary', 'ACTIVE', '{"publicationTargetIds":["gid://shopify/Publication/99"]}'::jsonb, $3, NOW(), NOW())
      ON CONFLICT (tenant_key, connector_id, account_alias) DO UPDATE SET metadata = EXCLUDED.metadata, updated_at = NOW()
      `,
      installationId, tenantKey, `user_${runId}`,
    );

    for (const [credentialType, plainValue] of [
      ["access_token", "test-access-token"],
      ["shop_domain", "payload-test.myshopify.com"],
      ["shop_id", "gid://shopify/Shop/1"],
    ]) {
      await encryption.storeCredential({ tenantKey, installationId, credentialType, plainValue });
    }

    const ctx = { tenantId: tenantKey, installationId, connectorId: "cdef_shopify", getAccessToken: async () => "" };

    const result = await connector.publishProduct(ctx, {
      sku: "PAYLOAD-001",
      title: "Payload Test Product",
      description: "Testing payload shape",
      brand: "TestBrand",
      hsnCode: "1234",
      gstRate: 18,
      mrp: 399,
      sellingPrice: 299,
      mainImageUrl: "https://example.com/img.jpg",
      attributes: {},
      productType: "Test",
    });

    assert(result.status === "SUCCESS", `Expected SUCCESS, got ${result.status}`);

    // ── Assertion 1: identifier uses handle, not customId ───────────────────
    const upsertCall = stub.calls.find((c) => c.query.includes("mutation UpsertProduct"));
    assert(upsertCall, "productSet mutation was not called");
    assert(
      typeof upsertCall.variables?.identifier?.handle === "string" &&
        upsertCall.variables.identifier.handle.length > 0,
      `identifier.handle must be a non-empty string — got ${JSON.stringify(upsertCall.variables?.identifier)}`,
    );
    assert(
      !upsertCall.variables?.identifier?.customId,
      `identifier.customId must NOT be present (deprecated) — got ${JSON.stringify(upsertCall.variables?.identifier)}`,
    );

    // ── Assertion 2: metafields include pim_connector/sku ────────────────────────
    const inputMetafields = upsertCall.variables?.input?.metafields ?? [];
    const skuMetafield = inputMetafields.find(
      (m) => m.namespace === "pim_connector" && m.key === "sku",
    );
    assert(
      skuMetafield && skuMetafield.value === "PAYLOAD-001",
      `input.metafields must contain {namespace:"pim_connector", key:"sku", value:"PAYLOAD-001"} — got ${JSON.stringify(inputMetafields)}`,
    );

    // ── Assertion 3: variants present with optionValues ─────────────────────
    // Shopify's ProductSet mutation requires optionValues on each variant since API 2024-10.
    // Single-variant products use [{ optionName: "Title", name: "Default Title" }].
    const inputVariants = upsertCall.variables?.input?.variants;
    assert(
      Array.isArray(inputVariants) && inputVariants.length > 0,
      `input.variants must be present in productSet with optionValues — got ${JSON.stringify(inputVariants)}`,
    );
    assert(
      Array.isArray(inputVariants[0]?.optionValues) && inputVariants[0].optionValues.length > 0,
      `input.variants[0].optionValues must be present — got ${JSON.stringify(inputVariants[0])}`,
    );

    // ── Assertion 4: productVariantsBulkUpdate called with price + SKU ──────
    const bulkUpdateCall = stub.calls.find((c) => c.query.includes("mutation BulkUpdateVariant"));
    assert(bulkUpdateCall, "productVariantsBulkUpdate mutation was not called after productSet");
    const variantInput = bulkUpdateCall.variables?.variants?.[0];
    assert(
      variantInput,
      "productVariantsBulkUpdate must include at least one variant",
    );
    assert(
      variantInput.price === "299.00",
      `variant price must be "299.00" — got ${variantInput?.price}`,
    );
    assert(
      variantInput.inventoryItem?.sku === "PAYLOAD-001",
      `variant inventoryItem.sku must be "PAYLOAD-001" — got ${variantInput?.inventoryItem?.sku}`,
    );
    assert(
      bulkUpdateCall.variables?.productId === "gid://shopify/Product/7777",
      `productVariantsBulkUpdate must use the productId from productSet response — got ${bulkUpdateCall.variables?.productId}`,
    );

    console.log(JSON.stringify({
      status: "ok",
      checkedAt: new Date().toISOString(),
      validated: [
        "productSet_uses_handle_identifier_not_customId",
        "productSet_input_metafields_includes_pim_connector_sku",
        "productSet_input_variants_present_with_optionValues",
        "productVariantsBulkUpdate_called_with_price_and_sku",
      ],
    }, null, 2));
  } finally {
    if (prismaDirect) await prismaDirect.onModuleDestroy();
    await new Promise((resolve) => stub.server.close(resolve));
  }
}

run().catch((error) => {
  console.error("shopify-product-set-payload test FAILED:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
