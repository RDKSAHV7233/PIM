#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const crypto = require("node:crypto");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_ENTRY = path.join(REPO_ROOT, "apps", "api", "dist", "main.js");

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  const lines = fs.readFileSync(filePath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    if (!line || /^\s*#/.test(line)) {
      continue;
    }
    const index = line.indexOf("=");
    if (index === -1) {
      continue;
    }
    const key = line.slice(0, index).trim();
    const value = line.slice(index + 1).trim().replace(/^"|"$/g, "");
    if (key && !process.env[key]) {
      process.env[key] = value;
    }
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
  if (!condition) {
    throw new Error(message);
  }
}

function createShopifyGraphqlStub() {
  const graphqlCalls = [];

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      if (req.method !== "POST" || req.url !== "/admin/api/2026-04/graphql.json") {
        res.statusCode = 404;
        res.end();
        return;
      }

      const chunks = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }
      const body = Buffer.concat(chunks).toString("utf8");
      const parsed = body ? JSON.parse(body) : {};
      const query = String(parsed.query || "");
      const variables = parsed.variables || {};
      graphqlCalls.push({ query, variables });

      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json");

      if (query.includes("publications(first: 50)")) {
        res.end(
          JSON.stringify({
            data: {
              publications: {
                nodes: [
                  {
                    id: "gid://shopify/Publication/1",
                    name: "Online Store",
                    catalog: {
                      __typename: "AppCatalog",
                      id: "gid://shopify/AppCatalog/1",
                      title: "Online Store",
                      status: "ACTIVE",
                    },
                  },
                  {
                    id: "gid://shopify/Publication/2",
                    name: "Point of Sale",
                    catalog: {
                      __typename: "AppCatalog",
                      id: "gid://shopify/AppCatalog/2",
                      title: "Point of Sale",
                      status: "ACTIVE",
                    },
                  },
                ],
              },
            },
          }),
        );
        return;
      }

      if (query.includes("mutation UpsertProduct")) {
        res.end(
          JSON.stringify({
            data: {
              productSet: {
                product: {
                  id: "gid://shopify/Product/4242",
                  handle: "demo-shirt-sku-001",
                  status: "ACTIVE",
                },
                userErrors: [],
              },
            },
          }),
        );
        return;
      }

      if (query.includes("mutation PublishProduct")) {
        res.end(
          JSON.stringify({
            data: {
              publishablePublish: {
                publishable: {
                  publishedOnPublication: true,
                },
                userErrors: [],
              },
            },
          }),
        );
        return;
      }

      if (query.includes("query GetProductStatus")) {
        res.end(
          JSON.stringify({
            data: {
              node: {
                id: "gid://shopify/Product/4242",
                status: "ACTIVE",
                resourcePublications: {
                  nodes: [
                    {
                      isPublished: true,
                      publication: {
                        id: "gid://shopify/Publication/1",
                      },
                    },
                  ],
                },
              },
            },
          }),
        );
        return;
      }

      res.end(JSON.stringify({ data: {} }));
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to resolve Shopify GraphQL stub address."));
        return;
      }
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`,
        graphqlCalls,
      });
    });
  });
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const tenantKey = `shopify-publish-${runId}`;
  const installationId = `inst_shopify_pub_${runId}`;
  const stub = await createShopifyGraphqlStub();

  process.env.PIM_SHOPIFY_CLIENT_ID = "shopify-client-id";
  process.env.PIM_SHOPIFY_CLIENT_SECRET = "shopify-client-secret";
  process.env.PIM_SHOPIFY_ADMIN_API_BASE_URL = stub.baseUrl;
  process.env.PIM_SHOPIFY_ADMIN_API_VERSION = "2026-04";

  let prismaDirect;
  try {
    const { PrismaDirectService } = require(path.join(
      REPO_ROOT,
      "apps",
      "api",
      "dist",
      "prisma",
      "prisma-direct.service.js",
    ));
    const { LoggerService } = require(path.join(
      REPO_ROOT,
      "apps",
      "api",
      "dist",
      "common",
      "logging",
      "logger.service.js",
    ));
    const { ConnectorCredentialEncryptionService } = require(path.join(
      REPO_ROOT,
      "apps",
      "api",
      "dist",
      "connector-installer",
      "credential-encryption.service.js",
    ));
    const { ShopifyConnector } = require(path.join(
      REPO_ROOT,
      "apps",
      "api",
      "dist",
      "connectors",
      "shopify",
      "shopify.connector.js",
    ));

    prismaDirect = new PrismaDirectService();
    await prismaDirect.onModuleInit();
    const db = prismaDirect.getClient();
    const logger = new LoggerService();
    const encryption = new ConnectorCredentialEncryptionService(prismaDirect, logger);
    const connector = new ShopifyConnector(prismaDirect, logger);

    await db.$executeRawUnsafe(
      `
      INSERT INTO connector_installations (
        id, tenant_key, connector_id, account_alias, status, metadata, installed_by, created_at, updated_at
      ) VALUES (
        $1, $2, 'cdef_shopify', 'primary', 'ACTIVE',
        '{"publicationTargetIds":["gid://shopify/Publication/1"]}'::jsonb,
        $3, NOW(), NOW()
      )
      ON CONFLICT (tenant_key, connector_id, account_alias)
      DO UPDATE SET metadata = EXCLUDED.metadata, updated_at = NOW()
      `,
      installationId,
      tenantKey,
      `user_${runId}`,
    );

    for (const [credentialType, plainValue] of [
      ["access_token", "shopify-access-token-live"],
      ["shop_domain", "demo-store.myshopify.com"],
      ["shop_id", "gid://shopify/Shop/9001"],
    ]) {
      await encryption.storeCredential({
        tenantKey,
        installationId,
        credentialType,
        plainValue,
      });
    }

    const ctx = {
      tenantId: tenantKey,
      installationId,
      connectorId: "cdef_shopify",
      getAccessToken: async () => "",
    };

    const publications = await connector.listPublications(ctx);
    assert(publications.length === 2, `Expected 2 publications, got ${publications.length}`);
    assert(publications[0].selected === true, "Expected first publication to be selected from metadata.");
    assert(publications[1].selected === false, "Expected second publication to be unselected.");

    const publishResult = await connector.publishProduct(ctx, {
      sku: "SKU-001",
      title: "Demo Shirt",
      description: "A demo Shopify sync product",
      brand: "Vexa",
      hsnCode: "6109",
      gstRate: 12,
      mrp: 999,
      sellingPrice: 799,
      mainImageUrl: "https://example.com/demo-shirt.jpg",
      attributes: {},
      productType: "Shirts",
    });
    assert(publishResult.status === "SUCCESS", `Expected SUCCESS publish status, got ${publishResult.status}`);
    assert(
      publishResult.externalRef === "gid://shopify/Product/4242",
      `Expected Shopify product gid, got ${publishResult.externalRef}`,
    );

    const syncResult = await connector.syncSubmissionStatus(ctx, publishResult.externalRef);
    assert(syncResult.status === "SUCCESS", `Expected SUCCESS sync status, got ${syncResult.status}`);

    const webhookPayload = Buffer.from(
      JSON.stringify({
        admin_graphql_api_id: "gid://shopify/Product/4242",
        status: "active",
        variants: [{ sku: "SKU-001" }],
      }),
      "utf8",
    );
    const signature = crypto
      .createHmac("sha256", process.env.PIM_SHOPIFY_CLIENT_SECRET)
      .update(webhookPayload)
      .digest("base64");

    const webhookEvent = await connector.parseWebhookEvent(webhookPayload, {
      "x-shopify-topic": "products/update",
      "x-shopify-webhook-id": `webhook-${runId}`,
      "x-shopify-hmac-sha256": signature,
    });
    assert(webhookEvent, "Expected valid Shopify webhook to parse.");
    assert(webhookEvent.status === "SUCCESS", `Expected SUCCESS webhook status, got ${webhookEvent.status}`);
    assert(webhookEvent.externalRef === "gid://shopify/Product/4242", "Expected webhook externalRef to resolve.");
    assert(webhookEvent.productSku === "SKU-001", `Expected webhook SKU, got ${webhookEvent.productSku}`);

    const invalidWebhook = await connector.parseWebhookEvent(webhookPayload, {
      "x-shopify-topic": "products/update",
      "x-shopify-webhook-id": `webhook-invalid-${runId}`,
      "x-shopify-hmac-sha256": "invalid-signature",
    });
    assert(invalidWebhook === null, "Expected invalid Shopify webhook signature to be rejected.");

    const upsertCall = stub.graphqlCalls.find((call) => call.query.includes("mutation UpsertProduct"));
    assert(upsertCall, "Expected Shopify productSet mutation call.");
    assert(
      typeof upsertCall.variables?.identifier?.handle === "string" && upsertCall.variables.identifier.handle.length > 0,
      `Expected Shopify handle identifier, got ${JSON.stringify(upsertCall.variables?.identifier)}`,
    );
    assert(
      !upsertCall.variables?.identifier?.customId,
      `Expected no customId in identifier (deprecated), got ${JSON.stringify(upsertCall.variables?.identifier)}`,
    );

    const publishCall = stub.graphqlCalls.find((call) => call.query.includes("mutation PublishProduct"));
    assert(publishCall, "Expected Shopify publishablePublish mutation call.");
    assert(
      publishCall.variables?.publicationId === "gid://shopify/Publication/1",
      `Expected selected publication target to be used, got ${JSON.stringify(publishCall.variables)}`,
    );

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantKey,
          installationId,
          validated: [
            "shopify_publication_discovery_reads_selected_targets",
            "shopify_publish_flow_requires_explicit_publication_targets",
            "shopify_publish_flow_uses_productset_and_publishablepublish",
            "shopify_status_sync_confirms_publication_state",
            "shopify_webhook_signature_and_parsing_work",
          ],
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } finally {
    if (prismaDirect) {
      await prismaDirect.onModuleDestroy();
    }
    await new Promise((resolve) => stub.server.close(resolve));
  }
}

run().catch((error) => {
  console.error("Shopify publication and webhook test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
