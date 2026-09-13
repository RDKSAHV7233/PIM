/**
 * E2E seed helper: put working-looking Flipkart credentials on the pre-seeded
 * Flipkart installation in the `playwright_e2e` schema so that
 * `POST /marketplace/products/:id/export-jobs {channel:"flipkart"}` is accepted
 * (a destination resolves) and then fails later in dispatch when the connector
 * cannot reach Flipkart.
 *
 * Without this, the seeded installation has zero credential rows and the
 * connector heartbeat flips it to CREDENTIAL_EXPIRED, so
 * `resolvePublishingDestination` throws DESTINATION_NOT_FOUND at job-creation
 * time and publish-failure-recovery.spec.js self-skips.
 *
 * Mirrors apps/api/test/integration/outbound-webhooks.test.cjs `seedCredentials()`
 * / connector-idempotency-semantics.test.cjs: it reuses the compiled
 * ConnectorCredentialEncryptionService from apps/api/dist so the stored ciphertext
 * is decryptable by the running API with the same CREDENTIAL_ENCRYPTION_KEY_*.
 */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../../..");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const eq = line.indexOf("=");
    if (eq <= 0) {
      continue;
    }
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (key && (process.env[key] === undefined || process.env[key] === "")) {
      process.env[key] = value;
    }
  }
}

function resolvePlaywrightDatabaseUrl() {
  return (
    process.env.PLAYWRIGHT_DATABASE_URL ||
    process.env.DATABASE_URL_DIRECT ||
    process.env.DATABASE_URL ||
    "postgresql://postgres:postgres@127.0.0.1:5432/pim1?schema=playwright_e2e"
  );
}

/**
 * @param {object} [opts]
 * @param {string} [opts.tenantKey="default"]
 * @param {string} [opts.connectorSlug="flipkart"]
 * @returns {Promise<{installationId: string, accountAlias: string|null, credentialTypes: string[]}>}
 */
async function seedConnectorCredentials(opts = {}) {
  const tenantKey = opts.tenantKey || process.env.PLAYWRIGHT_TENANT_KEY || "default";
  const connectorSlug = opts.connectorSlug || "flipkart";

  loadEnvFile(path.join(REPO_ROOT, ".env"));
  const dbUrl = resolvePlaywrightDatabaseUrl();
  // PrismaDirectService reads these at construction time.
  process.env.DATABASE_URL = dbUrl;
  process.env.DATABASE_URL_DIRECT = dbUrl;
  process.env.DATABASE_URL_POOLED = dbUrl;
  if (!process.env.CREDENTIAL_ENCRYPTION_KEY_V1) {
    process.env.CREDENTIAL_ENCRYPTION_KEY_V1 = "vexa-pim-local-encryption-key-v1-minimum-32";
  }
  if (!process.env.CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION) {
    process.env.CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION = "1";
  }

  const { PrismaClient } = require(path.join(REPO_ROOT, "node_modules", "@prisma", "client"));
  const { PrismaDirectService } = require(
    path.join(REPO_ROOT, "apps", "api", "dist", "prisma", "prisma-direct.service.js"),
  );
  const { LoggerService } = require(
    path.join(REPO_ROOT, "apps", "api", "dist", "common", "logging", "logger.service.js"),
  );
  const { ConnectorCredentialEncryptionService } = require(
    path.join(REPO_ROOT, "apps", "api", "dist", "connector-installer", "credential-encryption.service.js"),
  );

  const prisma = new PrismaClient({ datasources: { db: { url: dbUrl } } });
  const direct = new PrismaDirectService();
  try {
    const definition = await prisma.connectorDefinition.findFirst({
      where: { slug: connectorSlug },
      select: { id: true },
    });
    if (!definition) {
      throw new Error(`Connector definition "${connectorSlug}" not found in ${dbUrl}`);
    }
    const installation = await prisma.connectorInstallation.findFirst({
      where: { connectorId: definition.id, tenantKey },
      orderBy: [{ installedAt: "desc" }],
      select: { id: true, accountAlias: true },
    });
    if (!installation) {
      throw new Error(
        `No ${connectorSlug} installation for tenant "${tenantKey}" in ${dbUrl}. ` +
          "Expected the playwright_e2e schema to already have one seeded.",
      );
    }

    const encryption = new ConnectorCredentialEncryptionService(direct, new LoggerService());
    const validatedAt = new Date();
    const credentials = [
      ["client_id", "e2e-flipkart-client-id"],
      ["client_secret", "e2e-flipkart-client-secret"],
      ["refresh_token", "e2e-flipkart-refresh-token"],
    ];
    for (const [credentialType, plainValue] of credentials) {
      await encryption.storeCredential(
        { tenantKey, installationId: installation.id, credentialType, plainValue },
        undefined,
        // Mark as freshly validated so credentialsValidated checks pass and the
        // heartbeat's next tick treats the row as healthy.
        { lastValidatedAt: validatedAt, failureReason: null },
      );
    }

    // Undo any prior heartbeat downgrade — resolvePublishingDestination rejects
    // CREDENTIAL_EXPIRED installations (that is the DESTINATION_NOT_FOUND the
    // spec used to hit). Do this last so the window before job creation is small.
    await prisma.connectorInstallation.update({
      where: { id: installation.id },
      data: { status: "ACTIVE" },
    });

    return {
      installationId: installation.id,
      accountAlias: installation.accountAlias,
      credentialTypes: credentials.map(([type]) => type),
    };
  } finally {
    await prisma.$disconnect().catch(() => undefined);
    if (typeof direct.onModuleDestroy === "function") {
      await direct.onModuleDestroy().catch(() => undefined);
    }
  }
}

module.exports = { seedConnectorCredentials };
