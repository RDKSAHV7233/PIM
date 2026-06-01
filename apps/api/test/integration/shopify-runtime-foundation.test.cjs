#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

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
  setDefaultEnv("PIM_AUTH_REDIS_DISABLED", "true");  // Set L: auth middleware Redis gate
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

function createShopifyAuthStub() {
  const calls = [];
  const graphqlCalls = [];
  let refreshCount = 0;

  return new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      const chunks = [];
      for await (const chunk of req) {
        chunks.push(Buffer.from(chunk));
      }
      const body = Buffer.concat(chunks).toString("utf8");

      if (req.method === "POST" && req.url === "/admin/oauth/access_token") {
        const params = new URLSearchParams(body);
        const grantType = params.get("grant_type") || "";
        const record = {
          grantType,
          subjectToken: params.get("subject_token") || null,
          subjectTokenType: params.get("subject_token_type") || null,
          requestedTokenType: params.get("requested_token_type") || null,
          expiring: params.get("expiring") || null,
          refreshToken: params.get("refresh_token") || null,
          clientId: params.get("client_id") || null,
          clientSecret: params.get("client_secret") || null,
        };
        calls.push(record);

        res.setHeader("Content-Type", "application/json");
        if (grantType === "urn:ietf:params:oauth:grant-type:token-exchange") {
          res.statusCode = 200;
          res.end(
            JSON.stringify({
              access_token: "shopify-access-token-1",
              expires_in: 3600,
              refresh_token: "shopify-refresh-token-1",
              refresh_token_expires_in: 7776000,
              scope: "read_products,write_products,read_publications,write_publications",
            }),
          );
          return;
        }

        if (grantType === "refresh_token") {
          refreshCount += 1;
          if (params.get("refresh_token") !== "shopify-refresh-token-1") {
            res.statusCode = 401;
            res.end(JSON.stringify({ error: "invalid_refresh_token" }));
            return;
          }
          res.statusCode = 200;
          res.end(
            JSON.stringify({
              access_token: `shopify-access-token-refresh-${refreshCount}`,
              expires_in: 3600,
              refresh_token: `shopify-refresh-token-refresh-${refreshCount}`,
              refresh_token_expires_in: 7776000,
              scope: "read_products,write_products,read_publications,write_publications",
            }),
          );
          return;
        }

        res.statusCode = 400;
        res.end(JSON.stringify({ error: "unsupported_grant_type" }));
        return;
      }

      if (req.method === "POST" && req.url === "/admin/api/2026-04/graphql.json") {
        const parsed = body ? JSON.parse(body) : {};
        const query = String(parsed.query || "");
        graphqlCalls.push({
          query,
          variables: parsed.variables || {},
        });
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        if (query.includes("shop {")) {
          res.end(
            JSON.stringify({
              data: {
                shop: {
                  id: "gid://shopify/Shop/9001",
                  name: "Demo Store",
                  myshopifyDomain: "demo-store.myshopify.com",
                },
              },
            }),
          );
          return;
        }
        res.end(JSON.stringify({ data: {} }));
        return;
      }

      res.statusCode = 404;
      res.end();
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to resolve Shopify auth stub address."));
        return;
      }
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`,
        calls,
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
  const tenantKey = `shopify-runtime-${runId}`;
  const installationId = `inst_shopify_${runId}`;
  const shopDomain = "demo-store.myshopify.com";
  const stub = await createShopifyAuthStub();

  process.env.PIM_SHOPIFY_CLIENT_ID = "shopify-client-id";
  process.env.PIM_SHOPIFY_CLIENT_SECRET = "shopify-client-secret";
  process.env.PIM_SHOPIFY_TOKEN_BASE_URL = stub.baseUrl;
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
      ) VALUES ($1, $2, 'cdef_shopify', 'primary', 'ACTIVE', '{}'::jsonb, $3, NOW(), NOW())
      ON CONFLICT (tenant_key, connector_id, account_alias)
      DO UPDATE SET updated_at = NOW()
      `,
      installationId,
      tenantKey,
      `user_${runId}`,
    );

    const ctx = {
      tenantId: tenantKey,
      installationId,
      connectorId: "cdef_shopify",
      getAccessToken: async () => "",
    };

    await connector.handleOAuthCallback(ctx, {
      shop: shopDomain,
      sessionToken: "shopify-session-token-1",
    });

    assert(stub.calls.length === 1, `Expected one token exchange call, got ${stub.calls.length}`);
    assert(stub.graphqlCalls.length === 1, `Expected one Shopify GraphQL identity call, got ${stub.graphqlCalls.length}`);
    assert(
      stub.calls[0].grantType === "urn:ietf:params:oauth:grant-type:token-exchange",
      `Expected token exchange grant, got ${stub.calls[0].grantType}`,
    );
    assert(stub.calls[0].subjectToken === "shopify-session-token-1", "Expected subject_token from session token.");
    assert(
      stub.calls[0].requestedTokenType === "urn:shopify:params:oauth:token-type:offline-access-token",
      "Expected offline access token request.",
    );
    assert(stub.calls[0].expiring === "1", "Expected expiring offline token request.");

    const credentialRows = await db.$queryRawUnsafe(
      `
      SELECT
        credential_type AS "credentialType",
        encrypted_value AS "encryptedValue",
        key_version AS "keyVersion",
        expires_at AS "expiresAt",
        scope
      FROM connector_credentials
      WHERE tenant_key = $1 AND installation_id = $2
      ORDER BY credential_type ASC
      `,
      tenantKey,
      installationId,
    );
    assert(Array.isArray(credentialRows) && credentialRows.length >= 5, "Expected stored Shopify credentials.");

    const accessRow = credentialRows.find((row) => row.credentialType === "access_token");
    const refreshRow = credentialRows.find((row) => row.credentialType === "refresh_token");
    const shopRow = credentialRows.find((row) => row.credentialType === "shop_domain");
    const shopIdRow = credentialRows.find((row) => row.credentialType === "shop_id");
    assert(accessRow, "Expected access_token row.");
    assert(refreshRow, "Expected refresh_token row.");
    assert(shopRow, "Expected shop_domain row.");
    assert(shopIdRow, "Expected shop_id row.");

    assert(
      encryption.decrypt(String(accessRow.encryptedValue), String(accessRow.keyVersion)) === "shopify-access-token-1",
      "Expected exchanged Shopify access token to persist.",
    );
    assert(
      encryption.decrypt(String(refreshRow.encryptedValue), String(refreshRow.keyVersion)) === "shopify-refresh-token-1",
      "Expected exchanged Shopify refresh token to persist.",
    );
    assert(
      encryption.decrypt(String(shopRow.encryptedValue), String(shopRow.keyVersion)) === shopDomain,
      "Expected Shopify shop domain to persist.",
    );
    assert(
      encryption.decrypt(String(shopIdRow.encryptedValue), String(shopIdRow.keyVersion)) === "gid://shopify/Shop/9001",
      "Expected Shopify shop id to persist.",
    );
    assert(
      String(accessRow.scope || "").includes("write_products"),
      `Expected stored Shopify scope, got ${accessRow.scope}`,
    );

    const installationRows = await db.$queryRawUnsafe(
      `
      SELECT metadata
      FROM connector_installations
      WHERE tenant_key = $1 AND id = $2
      LIMIT 1
      `,
      tenantKey,
      installationId,
    );
    const metadata = installationRows[0]?.metadata || {};
    assert(metadata.shopDomain === shopDomain, `Expected shopDomain metadata, got ${JSON.stringify(metadata)}`);
    assert(metadata.shopId === "gid://shopify/Shop/9001", `Expected shopId metadata, got ${JSON.stringify(metadata)}`);
    assert(metadata.shopName === "Demo Store", `Expected shopName metadata, got ${JSON.stringify(metadata)}`);
    assert(metadata.tokenMode === "expiring_offline", `Expected expiring_offline token mode, got ${metadata.tokenMode}`);
    assert(metadata.authMode === "managed_install_token_exchange", `Expected managed auth mode, got ${metadata.authMode}`);

    const firstValidated = await connector.validateCredentials(ctx);
    assert(firstValidated === true, "Expected validateCredentials to succeed with cached access token.");
    assert(stub.calls.length === 1, `Expected cached token reuse, got ${stub.calls.length} token calls.`);

    await db.$executeRawUnsafe(
      `
      UPDATE connector_credentials
      SET expires_at = NOW() - INTERVAL '2 minutes'
      WHERE tenant_key = $1
        AND installation_id = $2
        AND credential_type = 'access_token'
      `,
      tenantKey,
      installationId,
    );

    const secondValidated = await connector.validateCredentials(ctx);
    assert(secondValidated === true, "Expected validateCredentials to refresh expired Shopify token.");
    assert(stub.calls.length === 2, `Expected one refresh token call, got ${stub.calls.length} total token calls.`);
    assert(stub.calls[1].grantType === "refresh_token", `Expected refresh_token grant, got ${stub.calls[1].grantType}`);
    assert(stub.calls[1].refreshToken === "shopify-refresh-token-1", "Expected stored refresh token to be used.");

    const refreshedRows = await db.$queryRawUnsafe(
      `
      SELECT
        credential_type AS "credentialType",
        encrypted_value AS "encryptedValue",
        key_version AS "keyVersion"
      FROM connector_credentials
      WHERE tenant_key = $1 AND installation_id = $2
        AND credential_type IN ('access_token', 'refresh_token')
      ORDER BY credential_type ASC
      `,
      tenantKey,
      installationId,
    );
    const refreshedAccess = refreshedRows.find((row) => row.credentialType === "access_token");
    const refreshedRefresh = refreshedRows.find((row) => row.credentialType === "refresh_token");
    assert(
      encryption.decrypt(String(refreshedAccess.encryptedValue), String(refreshedAccess.keyVersion)) === "shopify-access-token-refresh-1",
      "Expected refreshed Shopify access token to persist.",
    );
    assert(
      encryption.decrypt(String(refreshedRefresh.encryptedValue), String(refreshedRefresh.keyVersion)) === "shopify-refresh-token-refresh-1",
      "Expected refreshed Shopify refresh token to persist.",
    );

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantKey,
          installationId,
          validated: [
            "shopify_managed_install_token_exchange_persists_credentials",
            "shopify_installation_metadata_records_shop_context",
            "shopify_cached_access_token_is_reused",
            "shopify_expiring_offline_token_refresh_rotates_both_tokens",
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
  console.error("Shopify runtime foundation test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
