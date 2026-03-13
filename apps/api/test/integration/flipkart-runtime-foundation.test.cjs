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
    const idx = line.indexOf("=");
    if (idx === -1) {
      continue;
    }
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^"|"$/g, "");
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
  setDefaultEnv("JWT_SECRET", "pim1-local-dev-jwt-secret-minimum-length-32");
  setDefaultEnv("JWT_EXPIRY", "4h");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_V1", "pim1-local-encryption-key-v1-minimum-32");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION", "1");
  setDefaultEnv("REDIS_URL", "redis://localhost:6379");
  setDefaultEnv("JWT_BLOCKLIST_REDIS_DISABLED", "true");
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "pim1-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/pim1-local");
  setDefaultEnv("APP_ENV", "development");
  setDefaultEnv("PIM_DEFAULT_ROLE", "admin");
  setDefaultEnv("FEATURE_REAL_SPAPI_VALIDATION", "false");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function createFlipkartOauthStub() {
  const calls = [];
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      if (req.method !== "POST" || req.url !== "/oauth-service/oauth/token") {
        res.statusCode = 404;
        res.end();
        return;
      }

      const chunks = [];
      req.on("data", (chunk) => chunks.push(chunk));
      req.on("end", () => {
        const raw = Buffer.concat(chunks).toString("utf8");
        const params = new URLSearchParams(raw);
        const grantType = params.get("grant_type") || "";
        calls.push({
          grantType,
          refreshToken: params.get("refresh_token") || null,
          code: params.get("code") || null,
          auth: String(req.headers.authorization || ""),
        });

        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json");
        if (grantType === "refresh_token") {
          res.end(
            JSON.stringify({
              access_token: "access-token-1",
              expires_in: 3600,
              token_type: "bearer",
            }),
          );
          return;
        }
        if (grantType === "authorization_code") {
          res.end(
            JSON.stringify({
              access_token: "access-token-2",
              refresh_token: "refresh-token-2",
              expires_in: 1800,
              refresh_token_expires_in: 86400,
              token_type: "bearer",
            }),
          );
          return;
        }
        res.statusCode = 400;
        res.end(JSON.stringify({ error: "unsupported_grant_type" }));
      });
    });

    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to resolve OAuth stub address."));
        return;
      }
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${address.port}`,
        calls,
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
  const tenantKey = `flipkart-runtime-${runId}`;
  const installationId = `inst_flipkart_${runId}`;
  process.env.PIM_FLIPKART_OAUTH_BASE_URL = "";

  const stub = await createFlipkartOauthStub();
  process.env.PIM_FLIPKART_OAUTH_BASE_URL = stub.baseUrl;

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
    const { FlipkartConnector } = require(path.join(
      REPO_ROOT,
      "apps",
      "api",
      "dist",
      "connectors",
      "flipkart",
      "flipkart.connector.js",
    ));

    prismaDirect = new PrismaDirectService();
    await prismaDirect.onModuleInit();
    const db = prismaDirect.getClient();
    const logger = new LoggerService();
    const encryption = new ConnectorCredentialEncryptionService(prismaDirect, logger);
    const connector = new FlipkartConnector(prismaDirect, logger);

    await db.$executeRawUnsafe(
      `
      INSERT INTO connector_installations (
        id, tenant_key, connector_id, account_alias, status, metadata, installed_by, created_at, updated_at
      ) VALUES ($1, $2, 'cdef_flipkart', 'primary', 'ACTIVE', '{}'::jsonb, $3, NOW(), NOW())
      ON CONFLICT (tenant_key, connector_id, account_alias)
      DO UPDATE SET updated_at = NOW()
      `,
      installationId,
      tenantKey,
      `user_${runId}`,
    );

    await encryption.storeCredential({
      tenantKey,
      installationId,
      credentialType: "client_id",
      plainValue: "flipkart-client-id",
    });
    await encryption.storeCredential({
      tenantKey,
      installationId,
      credentialType: "client_secret",
      plainValue: "flipkart-client-secret",
    });
    await encryption.storeCredential({
      tenantKey,
      installationId,
      credentialType: "refresh_token",
      plainValue: "refresh-token-1",
    });

    const ctx = {
      tenantId: tenantKey,
      installationId,
      connectorId: "cdef_flipkart",
      sellerId: "seller-1",
      getAccessToken: async () => "",
    };

    const firstValidated = await connector.validateCredentials(ctx);
    assert(firstValidated === true, "Expected validateCredentials to succeed with refresh token flow.");
    assert(stub.calls.length === 1, `Expected one token refresh call, got ${stub.calls.length}`);
    assert(stub.calls[0].grantType === "refresh_token", "Expected refresh_token grant on first validation.");

    const accessRows = await db.$queryRawUnsafe(
      `
      SELECT encrypted_value AS "encryptedValue", key_version AS "keyVersion", expires_at AS "expiresAt"
      FROM connector_credentials
      WHERE tenant_key = $1 AND installation_id = $2 AND credential_type = 'access_token'
      LIMIT 1
      `,
      tenantKey,
      installationId,
    );
    assert(Array.isArray(accessRows) && accessRows.length === 1, "Expected stored access_token credential row.");
    const accessRow = accessRows[0];
    const decryptedAccess = encryption.decrypt(String(accessRow.encryptedValue), String(accessRow.keyVersion));
    assert(decryptedAccess === "access-token-1", `Expected cached access token, got ${decryptedAccess}`);
    assert(accessRow.expiresAt instanceof Date || typeof accessRow.expiresAt === "string", "Expected expiresAt on access token row.");

    const secondValidated = await connector.validateCredentials(ctx);
    assert(secondValidated === true, "Expected validateCredentials cache path to succeed.");
    assert(stub.calls.length === 1, `Expected cached access token reuse, got ${stub.calls.length} token calls.`);

    const validation = await connector.validateProduct(ctx, {
      sku: "",
      title: "",
      description: "",
      brand: "Brand",
      hsnCode: "",
      gstRate: 18,
      mrp: 1000,
      sellingPrice: 1200,
      mainImageUrl: "http://cdn.example.com/p1.jpg",
      attributes: { color: "" },
      productType: "apparel",
    });
    assert(validation.isValid === false, "Expected incomplete product to fail local validation.");
    assert(validation.errors.some((issue) => issue.fieldPath === "sku"), "Expected sku error.");
    assert(validation.errors.some((issue) => issue.fieldPath === "attributes.size"), "Expected size error.");
    assert(validation.errors.some((issue) => issue.fieldPath === "mainImageUrl"), "Expected HTTPS image error.");
    assert(validation.warnings.some((issue) => issue.fieldPath === "sellingPrice"), "Expected sellingPrice warning.");
    assert(validation.source === "LOCAL_RULES", `Expected LOCAL_RULES source, got ${validation.source}`);

    const knownIssue = connector.normaliseError("CATEGORY_MISMATCH", "raw message");
    assert(
      knownIssue.sellerMessage === "Product category does not match Flipkart's category tree. Re-map the category.",
      `Unexpected known error mapping: ${knownIssue.sellerMessage}`,
    );
    const unknownIssue = connector.normaliseError("SOMETHING_NEW", "Provider raw detail");
    assert(unknownIssue.sellerMessage === "Provider raw detail", "Expected unknown error to preserve provider detail.");

    await connector.handleOAuthCallback(ctx, {
      code: "auth-code-1",
      redirectUri: "https://example.com/connectors/flipkart/callback",
    });
    assert(stub.calls.length === 2, `Expected auth-code exchange call, got ${stub.calls.length}`);
    assert(stub.calls[1].grantType === "authorization_code", "Expected authorization_code exchange.");

    const refreshRows = await db.$queryRawUnsafe(
      `
      SELECT encrypted_value AS "encryptedValue", key_version AS "keyVersion"
      FROM connector_credentials
      WHERE tenant_key = $1 AND installation_id = $2 AND credential_type = 'refresh_token'
      LIMIT 1
      `,
      tenantKey,
      installationId,
    );
    assert(Array.isArray(refreshRows) && refreshRows.length === 1, "Expected stored refresh_token row.");
    const decryptedRefresh = encryption.decrypt(
      String(refreshRows[0].encryptedValue),
      String(refreshRows[0].keyVersion),
    );
    assert(decryptedRefresh === "refresh-token-2", `Expected refreshed OAuth token, got ${decryptedRefresh}`);

    await db.$executeRawUnsafe(
      `DELETE FROM connector_installations WHERE id = $1 AND tenant_key = $2`,
      installationId,
      tenantKey,
    );

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantKey,
          installationId,
          validated: [
            "flipkart_refresh_token_exchange",
            "flipkart_cached_access_token_reuse",
            "flipkart_auth_code_exchange_persists_tokens",
            "flipkart_local_validation_contract",
            "flipkart_error_normalization_contract",
          ],
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } finally {
    if (prismaDirect) {
      try {
        await prismaDirect.onModuleDestroy();
      } catch {
        // ignore cleanup failures
      }
    }
    await new Promise((resolve) => stub.server.close(() => resolve()));
  }
}

run().catch((error) => {
  console.error("Flipkart runtime foundation integration test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
