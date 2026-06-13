#!/usr/bin/env node
/* eslint-disable no-console */
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
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^"|"$/g, "");
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
  setDefaultEnv("PIM_AUTH_REDIS_DISABLED", "true");
  setDefaultEnv("R2_ACCOUNT_ID", "local-dev");
  setDefaultEnv("R2_ACCESS_KEY_ID", "local-dev");
  setDefaultEnv("R2_SECRET_ACCESS_KEY", "local-dev");
  setDefaultEnv("R2_BUCKET_NAME", "vexa-pim-local");
  setDefaultEnv("R2_PUBLIC_URL", "https://example.com/vexa-pim-local");
  setDefaultEnv("APP_ENV", "development");
  setDefaultEnv("PIM_DEFAULT_ROLE", "admin");
  setDefaultEnv("FEATURE_REAL_SPAPI_VALIDATION", "false");
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

// Stub: returns 200 for valid merchants, 401 for 'invalid-merchant' merchant-id header.
function createMyntraApiStub() {
  const calls = [];
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const merchantId = String(req.headers["x-myntra-merchant-id"] || "");
      calls.push({ method: req.method, url: req.url, merchantId });
      if (req.url === "/listing-api/v2/health") {
        if (merchantId === "invalid-merchant") {
          res.statusCode = 401;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ message: "Unauthorized" }));
        } else {
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ status: "ok" }));
        }
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Unable to resolve Myntra stub address."));
        return;
      }
      resolve({ server, baseUrl: `http://127.0.0.1:${address.port}`, calls });
    });
  });
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(API_ENTRY)) {
    throw new Error(
      `API build output not found at ${API_ENTRY}. Run: npm run build --workspace @pim1/api`,
    );
  }

  const runId = Date.now().toString();
  const tenantKey = `myntra-runtime-${runId}`;
  const installIdValid = `inst_myntra_valid_${runId}`;
  const installIdAuthFail = `inst_myntra_authfail_${runId}`;

  process.env.PIM_MYNTRA_API_BASE_URL = "";
  const stub = await createMyntraApiStub();
  process.env.PIM_MYNTRA_API_BASE_URL = stub.baseUrl;

  let prismaDirect;
  try {
    const { PrismaDirectService } = require(
      path.join(REPO_ROOT, "apps", "api", "dist", "prisma", "prisma-direct.service.js"),
    );
    const { LoggerService } = require(
      path.join(REPO_ROOT, "apps", "api", "dist", "common", "logging", "logger.service.js"),
    );
    const { ConnectorCredentialEncryptionService } = require(
      path.join(REPO_ROOT, "apps", "api", "dist", "connector-installer", "credential-encryption.service.js"),
    );
    const { MyntraConnector } = require(
      path.join(REPO_ROOT, "apps", "api", "dist", "connectors", "myntra", "myntra.connector.js"),
    );

    prismaDirect = new PrismaDirectService();
    await prismaDirect.onModuleInit();
    const db = prismaDirect.getClient();
    const logger = new LoggerService();
    const encryption = new ConnectorCredentialEncryptionService(prismaDirect, logger);
    const connector = new MyntraConnector(prismaDirect, logger);

    // ── Phase 1: pure-local validateProduct ────────────────────────────────────

    const fakeCtx = { tenantId: "local", installationId: "local", connectorId: "cdef_myntra", getAccessToken: async () => "" };

    // 1a: valid apparel product passes all local rules
    const validApparel = await connector.validateProduct(fakeCtx, {
      sku: "TShirt-Navy-M",
      title: "Classic Navy Blue Cotton T-Shirt",
      brand: "WearCo",
      mrp: 899,
      sellingPrice: 649,
      hsnCode: "61091000",
      description: "Comfortable everyday cotton tee in navy blue.",
      mainImageUrl: "https://cdn.example.com/tshirt-navy.jpg",
      countryOfOrigin: "India",
      productType: "apparel",
      attributes: {
        gender: "Men",
        colour: "Navy",
        size: "M",
        fabric: "Cotton",
      },
    });
    assert(validApparel.isValid === true, `Expected valid apparel to pass; errors: ${JSON.stringify(validApparel.errors)}`);
    assert(validApparel.errors.length === 0, "Expected zero errors for a fully specified apparel product.");
    assert(validApparel.source === "LOCAL_RULES", `Expected LOCAL_RULES source, got ${validApparel.source}`);

    // 1b: missing sku and title → required field errors
    const missingFields = await connector.validateProduct(fakeCtx, {
      sku: "",
      title: "",
      brand: "",
      mrp: 499,
      sellingPrice: 399,
      hsnCode: "61091000",
      description: "Some description here.",
      mainImageUrl: "https://cdn.example.com/img.jpg",
      countryOfOrigin: "India",
      productType: "apparel",
      attributes: {},
    });
    assert(missingFields.isValid === false, "Expected incomplete product to fail validation.");
    assert(
      missingFields.errors.some((e) => e.fieldPath === "sku"),
      "Expected SKU required error.",
    );
    assert(
      missingFields.errors.some((e) => e.fieldPath === "title"),
      "Expected title required error.",
    );
    assert(
      missingFields.errors.some((e) => e.fieldPath === "brand"),
      "Expected brand required error.",
    );

    // 1c: selling price > MRP → SELLING_PRICE_EXCEEDS_MRP
    const priceViolation = await connector.validateProduct(fakeCtx, {
      sku: "SHOE-001",
      title: "Leather Sneaker",
      brand: "StrideCo",
      mrp: 999,
      sellingPrice: 1200,
      hsnCode: "64041900",
      description: "Premium leather sneakers.",
      mainImageUrl: "https://cdn.example.com/shoe.jpg",
      countryOfOrigin: "India",
      productType: "footwear",
      attributes: { gender: "Men", colour: "Black", shoeSize: "9" },
    });
    assert(priceViolation.isValid === false, "Expected sellingPrice > MRP to fail.");
    assert(
      priceViolation.errors.some((e) => e.code === "SELLING_PRICE_EXCEEDS_MRP"),
      `Expected SELLING_PRICE_EXCEEDS_MRP error; errors: ${JSON.stringify(priceViolation.errors)}`,
    );

    // 1d: invalid HSN code format → HSN_INVALID
    const badHsn = await connector.validateProduct(fakeCtx, {
      sku: "KURTI-001",
      title: "Floral Kurti",
      brand: "EthnicWear",
      mrp: 799,
      sellingPrice: 599,
      hsnCode: "ABCDEF",
      description: "Beautiful floral kurti.",
      mainImageUrl: "https://cdn.example.com/kurti.jpg",
      countryOfOrigin: "India",
      productType: "ethnic-wear",
      attributes: { gender: "Women", colour: "Pink", fabric: "Cotton", occasion: "Casual" },
    });
    assert(badHsn.isValid === false, "Expected invalid HSN format to fail.");
    assert(
      badHsn.errors.some((e) => e.code === "HSN_INVALID"),
      `Expected HSN_INVALID error; errors: ${JSON.stringify(badHsn.errors)}`,
    );

    // 1e: non-HTTPS image URL → IMAGE_URL_NOT_HTTPS
    const httpImage = await connector.validateProduct(fakeCtx, {
      sku: "SAREE-001",
      title: "Silk Saree Red",
      brand: "SilkHouse",
      mrp: 2999,
      sellingPrice: 2499,
      hsnCode: "50072090",
      description: "Elegant silk saree.",
      mainImageUrl: "http://cdn.example.com/saree.jpg",
      countryOfOrigin: "India",
      productType: "ethnic-wear",
      attributes: { gender: "Women", colour: "Red", fabric: "Silk", occasion: "Wedding" },
    });
    assert(httpImage.isValid === false, "Expected HTTP image URL to fail HTTPS check.");
    assert(
      httpImage.errors.some((e) => e.code === "IMAGE_URL_NOT_HTTPS"),
      `Expected IMAGE_URL_NOT_HTTPS; errors: ${JSON.stringify(httpImage.errors)}`,
    );

    // ── Phase 2: normaliseError contract ──────────────────────────────────────

    const invalidMerchant = connector.normaliseError("INVALID_MERCHANT", "raw message");
    assert(invalidMerchant.code === "INVALID_MERCHANT", "Expected INVALID_MERCHANT code preserved.");
    assert(invalidMerchant.fieldPath === "", "Expected empty fieldPath for INVALID_MERCHANT.");
    assert(invalidMerchant.severity === "error", "Expected error severity for INVALID_MERCHANT.");
    assert(
      invalidMerchant.sellerMessage.toLowerCase().includes("merchant"),
      `Expected merchant mention in message; got: ${invalidMerchant.sellerMessage}`,
    );

    const brandNotApproved = connector.normaliseError("BRAND_NOT_APPROVED", "");
    assert(brandNotApproved.fieldPath === "brand", "Expected fieldPath 'brand' for BRAND_NOT_APPROVED.");
    assert(brandNotApproved.severity === "error", "Expected error severity for BRAND_NOT_APPROVED.");

    const rateLimit = connector.normaliseError("RATE_LIMIT_EXCEEDED", "");
    assert(rateLimit.severity === "error", "Expected error severity for RATE_LIMIT_EXCEEDED.");
    assert(
      rateLimit.sellerMessage.includes("100") || rateLimit.sellerMessage.toLowerCase().includes("rate limit"),
      `Expected rate-limit mention in message; got: ${rateLimit.sellerMessage}`,
    );

    const styleExists = connector.normaliseError("STYLE_ALREADY_EXISTS", "");
    assert(styleExists.severity === "warning", "Expected STYLE_ALREADY_EXISTS to be a warning, not an error.");

    const unknownCode = connector.normaliseError("SOME_UNKNOWN_ERROR", "Raw detail from Myntra");
    assert(
      unknownCode.sellerMessage === "Raw detail from Myntra",
      `Expected unknown error to preserve raw message; got: ${unknownCode.sellerMessage}`,
    );
    assert(unknownCode.severity === "error", "Expected unknown code to default to error severity.");

    // ── Phase 3: validateCredentials with DB + HTTP stub ──────────────────────

    for (const id of [installIdValid, installIdAuthFail]) {
      await db.$executeRawUnsafe(
        `
        INSERT INTO connector_installations (
          id, tenant_key, connector_id, account_alias, status, metadata, installed_by, created_at, updated_at
        ) VALUES ($1, $2, 'cdef_myntra', 'primary', 'ACTIVE', '{}'::jsonb, $3, NOW(), NOW())
        ON CONFLICT (tenant_key, connector_id, account_alias)
        DO UPDATE SET updated_at = NOW()
        `,
        id,
        `${tenantKey}_${id}`,
        `user_${runId}`,
      );
    }

    // Store credentials for valid installation
    const validTenant = `${tenantKey}_${installIdValid}`;
    await encryption.storeCredential({ tenantKey: validTenant, installationId: installIdValid, credentialType: "merchant_id", plainValue: "valid-merchant" });
    await encryption.storeCredential({ tenantKey: validTenant, installationId: installIdValid, credentialType: "secret_key", plainValue: "test-secret-key" });
    await encryption.storeCredential({ tenantKey: validTenant, installationId: installIdValid, credentialType: "warehouse_id", plainValue: "WH001" });

    // Store credentials for auth-fail installation (merchant ID triggers 401)
    const authFailTenant = `${tenantKey}_${installIdAuthFail}`;
    await encryption.storeCredential({ tenantKey: authFailTenant, installationId: installIdAuthFail, credentialType: "merchant_id", plainValue: "invalid-merchant" });
    await encryption.storeCredential({ tenantKey: authFailTenant, installationId: installIdAuthFail, credentialType: "secret_key", plainValue: "bad-secret-key" });
    await encryption.storeCredential({ tenantKey: authFailTenant, installationId: installIdAuthFail, credentialType: "warehouse_id", plainValue: "WH999" });

    const validCtx = { tenantId: validTenant, installationId: installIdValid, connectorId: "cdef_myntra", getAccessToken: async () => "" };
    const authFailCtx = { tenantId: authFailTenant, installationId: installIdAuthFail, connectorId: "cdef_myntra", getAccessToken: async () => "" };
    const noCredsCtx = { tenantId: "any", installationId: `inst_no_creds_${runId}`, connectorId: "cdef_myntra", getAccessToken: async () => "" };

    const validResult = await connector.validateCredentials(validCtx);
    assert(validResult === true, "Expected validateCredentials to return true when stub returns 200.");
    assert(stub.calls.length >= 1, "Expected at least one HTTP call to stub.");
    assert(
      stub.calls.some((c) => c.url === "/listing-api/v2/health"),
      "Expected health check endpoint to be called.",
    );

    const authFailResult = await connector.validateCredentials(authFailCtx);
    assert(authFailResult === false, "Expected validateCredentials to return false when stub returns 401.");

    const noCredsResult = await connector.validateCredentials(noCredsCtx);
    assert(noCredsResult === false, "Expected validateCredentials to return false when no credentials stored.");

    // cleanup
    for (const id of [installIdValid, installIdAuthFail]) {
      await db.$executeRawUnsafe(
        `DELETE FROM connector_installations WHERE id = $1`,
        id,
      );
    }

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantKey,
          validated: [
            "myntra_valid_apparel_passes_local_rules",
            "myntra_missing_required_fields_caught",
            "myntra_selling_price_exceeds_mrp_caught",
            "myntra_invalid_hsn_format_caught",
            "myntra_non_https_image_caught",
            "myntra_error_map_invalid_merchant",
            "myntra_error_map_brand_not_approved",
            "myntra_error_map_rate_limit_exceeded",
            "myntra_style_already_exists_is_warning",
            "myntra_unknown_error_code_preserves_raw_message",
            "myntra_validate_credentials_200_returns_true",
            "myntra_validate_credentials_401_returns_false",
            "myntra_validate_credentials_no_creds_returns_false",
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
  console.error("Myntra runtime foundation integration test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
