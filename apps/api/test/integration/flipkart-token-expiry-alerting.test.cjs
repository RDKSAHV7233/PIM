#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

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
  setDefaultEnv("JWT_SECRET", "vexa-pim-local-dev-jwt-secret-minimum-length-32");
  setDefaultEnv("JWT_EXPIRY", "4h");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_V1", "vexa-pim-local-encryption-key-v1-minimum-32");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION", "1");
  setDefaultEnv("REDIS_URL", "redis://localhost:6379");
  setDefaultEnv("JWT_BLOCKLIST_REDIS_DISABLED", "true");
  setDefaultEnv("PIM_AUTH_REDIS_DISABLED", "true");  // Set L: auth middleware Redis gate
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function readRefreshRow(db, tenantKey, installationId) {
  const rows = await db.$queryRawUnsafe(
    `
    SELECT failure_reason AS "failureReason", status, expires_at AS "expiresAt"
    FROM connector_credentials
    WHERE tenant_key = $1
      AND installation_id = $2
      AND credential_type = 'refresh_token'
    LIMIT 1
    `,
    tenantKey,
    installationId,
  );
  return rows[0] ?? null;
}

async function setRefreshExpiry(db, tenantKey, installationId, expiresAt) {
  await db.$executeRawUnsafe(
    `
    UPDATE connector_credentials
    SET
      expires_at = $3,
      failure_reason = NULL,
      updated_at = NOW()
    WHERE tenant_key = $1
      AND installation_id = $2
      AND credential_type = 'refresh_token'
    `,
    tenantKey,
    installationId,
    expiresAt,
  );
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(`API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const tenantKey = `flipkart-token-expiry-${runId}`;
  const installationId = `inst_flipkart_token_expiry_${runId}`;

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

    const loggerCalls = {
      info: [],
      warn: [],
      error: [],
    };
    const logger = {
      info(message, meta) {
        loggerCalls.info.push({ message, meta });
      },
      warn(message, meta) {
        loggerCalls.warn.push({ message, meta });
      },
      error(message, meta) {
        loggerCalls.error.push({ message, meta });
      },
    };
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
      expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });
    await encryption.storeCredential({
      tenantKey,
      installationId,
      credentialType: "access_token",
      plainValue: "access-token-cached",
      expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    });

    const ctx = {
      tenantId: tenantKey,
      installationId,
      connectorId: "cdef_flipkart",
      sellerId: "seller-1",
      getAccessToken: async () => "",
    };

    loggerCalls.warn.length = 0;
    loggerCalls.error.length = 0;
    await setRefreshExpiry(db, tenantKey, installationId, new Date(Date.now() - 24 * 60 * 60 * 1000));
    const expiredValidated = await connector.validateCredentials(ctx);
    assert(expiredValidated === false, "Expected validateCredentials to fail when refresh token is expired.");
    const expiredRow = await readRefreshRow(db, tenantKey, installationId);
    assert(
      String(expiredRow?.failureReason || "").toLowerCase().includes("expired"),
      `Expected expired failure reason on refresh_token row, got: ${expiredRow?.failureReason}`,
    );
    assert(
      loggerCalls.error.some((entry) => entry.message === "Flipkart refresh token expired"),
      "Expected structured error log for expired refresh token.",
    );

    loggerCalls.warn.length = 0;
    loggerCalls.error.length = 0;
    await setRefreshExpiry(db, tenantKey, installationId, new Date(Date.now() + 3 * 24 * 60 * 60 * 1000));
    const expiringSoonValidated = await connector.validateCredentials(ctx);
    assert(expiringSoonValidated === true, "Expected validateCredentials to pass when refresh token is expiring soon.");
    const expiringSoonRow = await readRefreshRow(db, tenantKey, installationId);
    assert(
      String(expiringSoonRow?.failureReason || "").includes("expires within 7 days"),
      `Expected warning failure reason for expiring refresh token, got: ${expiringSoonRow?.failureReason}`,
    );
    assert(
      loggerCalls.warn.some((entry) => entry.message === "Flipkart refresh token expiring soon"),
      "Expected structured warning log for expiring-soon refresh token.",
    );

    loggerCalls.warn.length = 0;
    loggerCalls.error.length = 0;
    await setRefreshExpiry(db, tenantKey, installationId, new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
    const healthyValidated = await connector.validateCredentials(ctx);
    assert(healthyValidated === true, "Expected validateCredentials to pass for healthy refresh token expiry.");
    const healthyRow = await readRefreshRow(db, tenantKey, installationId);
    assert(healthyRow?.failureReason == null, `Expected null failure reason for healthy token, got: ${healthyRow?.failureReason}`);

    loggerCalls.warn.length = 0;
    loggerCalls.error.length = 0;
    await setRefreshExpiry(db, tenantKey, installationId, null);
    const nullExpiryValidated = await connector.validateCredentials(ctx);
    assert(nullExpiryValidated === true, "Expected validateCredentials to pass when refresh token has no expiry.");
    const nullExpiryRow = await readRefreshRow(db, tenantKey, installationId);
    assert(nullExpiryRow?.failureReason == null, `Expected null failure reason for null-expiry token, got: ${nullExpiryRow?.failureReason}`);
    assert(
      loggerCalls.warn.every((entry) => entry.message !== "Flipkart refresh token expiring soon"),
      "Expected no expiring-soon warning log for null-expiry refresh token.",
    );

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
            "flipkart_refresh_token_expired_validation",
            "flipkart_refresh_token_expiring_warning",
            "flipkart_refresh_token_healthy_ok",
            "flipkart_refresh_token_null_expiry_ok",
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
  }
}

run().catch((error) => {
  console.error("Flipkart token expiry alerting integration test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
