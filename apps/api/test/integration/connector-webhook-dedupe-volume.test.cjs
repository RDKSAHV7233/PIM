#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Remediation stream E3 — Scenario 1
 * Duplicate connector-webhook delivery deduped at higher volume.
 *
 * Drives the REAL ConnectorWebhookIngestionService.ingest() in-process against the
 * live `pim1` Postgres, using a directly-constructed ShopifyConnector (installable,
 * launch stage "live") behind a minimal registry stub. Redelivers the SAME
 * external_event_id (x-shopify-webhook-id) 5x then 20x for one installation.
 *
 * "accepted" per connector-webhook-ingestion.service.ts:
 *   - first delivery   -> { accepted: true,  duplicate: false }   row created + processed
 *   - every redelivery -> { accepted: true,  duplicate: true, reason: "processed" }
 *     reserveWebhookEvent() short-circuits BEFORE any UPDATE, so
 *     processing_attempt_count stays 1 and the matched submission is resolved once.
 *
 * Asserts, per event id:
 *   - exactly ONE connector_webhook_events row
 *   - processing_status='processed', processing_attempt_count=1, processed_at set
 *   - surplus deliveries report duplicate=true / reason='processed' (no reprocessing)
 *   - the seeded PENDING submission is resolved exactly once (1 channel error, not N)
 */
const fs = require("node:fs");
const path = require("node:path");
const { createHmac, randomUUID } = require("node:crypto");
const { PrismaClient } = require("@prisma/client");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
function resolveDist() {
  const snap = path.join(REPO_ROOT, "apps", "api", ".dist-e3");
  if (fs.existsSync(path.join(snap, "main.js"))) return snap;
  return path.join(REPO_ROOT, "apps", "api", "dist");
}
const DIST = resolveDist();

function readEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    if (!line || /^\s*#/.test(line)) continue;
    const idx = line.indexOf("=");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim().replace(/^"|"$/g, "");
    if (key && !process.env[key]) process.env[key] = value;
  }
}
function setDefaultEnv(name, value) {
  if (!process.env[name] || String(process.env[name]).trim().length === 0) process.env[name] = value;
}
function prepareEnv() {
  readEnvFile(path.join(REPO_ROOT, ".env"));
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    setDefaultEnv("DATABASE_URL_POOLED", databaseUrl);
    setDefaultEnv("DATABASE_URL_DIRECT", databaseUrl);
  }
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_V1", "vexa-pim-local-encryption-key-v1-minimum-32");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION", "1");
  setDefaultEnv("REDIS_URL", "redis://localhost:6379");
  setDefaultEnv("APP_ENV", "development");
  setDefaultEnv("PIM_SHOPIFY_CLIENT_ID", "shopify-client-id");
  setDefaultEnv("PIM_SHOPIFY_CLIENT_SECRET", "shopify-client-secret");
}
function assert(condition, message) {
  if (!condition) throw new Error(message);
}
function shopifySignature(secret, rawBody) {
  return createHmac("sha256", secret).update(rawBody).digest("base64");
}

async function buildIngestion() {
  const { PrismaService } = require(path.join(DIST, "prisma", "prisma.service.js"));
  const { PrismaDirectService } = require(path.join(DIST, "prisma", "prisma-direct.service.js"));
  const { LoggerService } = require(path.join(DIST, "common", "logging", "logger.service.js"));
  const { ShopifyConnector } = require(path.join(DIST, "connectors", "shopify", "shopify.connector.js"));
  const { ShopifyApiClient } = require(path.join(DIST, "connectors", "shopify", "shopify-api-client.service.js"));
  const { ConnectorWebhookIngestionService } = require(path.join(
    DIST,
    "connector-framework",
    "connector-webhook-ingestion.service.js",
  ));

  const prisma = new PrismaService();
  const prismaDirect = new PrismaDirectService();
  const logger = new LoggerService();
  await prisma.onModuleInit();
  await prismaDirect.onModuleInit();

  const shopify = new ShopifyConnector(prismaDirect, logger, new ShopifyApiClient(logger));
  const registryStub = {
    getConnector(slug) {
      if (slug !== "shopify") throw new Error(`unexpected connector slug ${slug}`);
      return shopify;
    },
  };
  const ingestion = new ConnectorWebhookIngestionService(prisma, registryStub, logger);
  return { prisma, prismaDirect, ingestion };
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(path.join(DIST, "main.js"))) {
    throw new Error(`API build output not found at ${DIST}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const tenantKey = `cw-dedupe-vol-${runId}`;
  const installationId = `inst_cwdv_${runId}`;
  const secret = process.env.PIM_SHOPIFY_CLIENT_SECRET;

  const raw = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL } },
  });

  let svc;
  try {
    svc = await buildIngestion();

    // NOTE (regression guard): ConnectorWebhookIngestionService.reserveWebhookEvent()
    // takes its pg advisory lock via tx.$executeRaw(...). An earlier revision used
    // tx.$queryRaw(...) on the void-returning pg_advisory_xact_lock(), which throws
    // "Failed to deserialize column of type 'void'" on @prisma/client 6.19.3 and
    // prevented ANY connector_webhook_events row from being written. The assertions
    // below fail loudly if that regression returns.

    await raw.$executeRawUnsafe(
      `
      INSERT INTO connector_installations (
        id, tenant_key, connector_id, account_alias, status, metadata, installed_by, created_at, updated_at
      ) VALUES ($1, $2, 'cdef_shopify', $3, 'ACTIVE', '{}'::jsonb, $4, NOW(), NOW())
      `,
      installationId,
      tenantKey,
      `primary-${runId}`,
      `user_${runId}`,
    );

    async function seedSubmission(externalRef) {
      const id = randomUUID();
      await raw.$executeRawUnsafe(
        `
        INSERT INTO connector_submissions (
          id, tenant_key, installation_id, product_id, variant_id, idempotency_key,
          submission_type, source, attempt_number, status, external_ref,
          payload_snapshot, payload_snapshot_url, channel_errors, submitted_at, resolved_at
        ) VALUES (
          $1, $2, $3, $4, NULL, $5, 'PUBLISH', 'LIVE_API', 1, 'PENDING', $6,
          '{}'::jsonb, NULL, '[]'::jsonb, NOW(), NULL
        )
        `,
        id,
        tenantKey,
        installationId,
        `prod-${runId}`,
        `cwdv-${externalRef}:PUBLISH`,
        externalRef,
      );
      return id;
    }

    function delivery(eventId, gid) {
      const body = Buffer.from(
        JSON.stringify({ admin_graphql_api_id: gid, status: "active", variants: [{ sku: `CWDV-${runId}` }] }),
        "utf8",
      );
      return {
        rawBody: body,
        headers: {
          "x-shopify-topic": "products/delete",
          "x-shopify-webhook-id": eventId,
          "x-shopify-hmac-sha256": shopifySignature(secret, body),
        },
      };
    }

    async function deliverNTimes(eventId, gid, n, submissionId) {
      const results = [];
      for (let i = 0; i < n; i++) {
        const d = delivery(eventId, gid);
        // eslint-disable-next-line no-await-in-loop
        results.push(
          await svc.ingestion.ingest({ tenantKey, installationId, rawBody: d.rawBody, headers: d.headers }),
        );
      }

      const first = results[0];
      assert(first.accepted === true, `[${eventId}] first delivery must be accepted`);
      assert(first.duplicate === false, `[${eventId}] first delivery must NOT be a duplicate`);
      assert(first.eventId === eventId, `[${eventId}] unexpected eventId ${String(first.eventId)}`);
      assert(first.eventType === "products/delete", `[${eventId}] unexpected eventType ${String(first.eventType)}`);
      assert(first.submissionId === submissionId, `[${eventId}] first delivery must resolve submission ${submissionId}, got ${String(first.submissionId)}`);

      let dupCount = 0;
      for (let i = 1; i < results.length; i++) {
        const r = results[i];
        assert(r.accepted === true, `[${eventId}] redelivery #${i} must still be ack'd (idempotent)`);
        assert(r.duplicate === true, `[${eventId}] redelivery #${i} must be duplicate`);
        assert(r.reason === "processed", `[${eventId}] redelivery #${i} reason must be 'processed', got ${String(r.reason)}`);
        assert(r.submissionId === null, `[${eventId}] redelivery #${i} must NOT reprocess a submission`);
        dupCount++;
      }
      assert(dupCount === n - 1, `[${eventId}] expected ${n - 1} surplus deliveries flagged duplicate, got ${dupCount}`);

      const rows = await raw.$queryRawUnsafe(
        `
        SELECT processing_status AS "processingStatus", processing_attempt_count AS "attemptCount",
               processed_at AS "processedAt", submission_id AS "submissionId"
        FROM connector_webhook_events
        WHERE tenant_key = $1 AND installation_id = $2 AND external_event_id = $3
        `,
        tenantKey,
        installationId,
        eventId,
      );
      assert(Array.isArray(rows) && rows.length === 1, `[${eventId}] expected exactly 1 stored webhook row, got ${rows.length}`);
      const row = rows[0];
      assert(String(row.processingStatus) === "processed", `[${eventId}] expected processing_status=processed, got ${row.processingStatus}`);
      assert(Number(row.attemptCount) === 1, `[${eventId}] expected processing_attempt_count=1 after ${n} deliveries, got ${row.attemptCount}`);
      assert(row.processedAt, `[${eventId}] expected processed_at set`);
      assert(String(row.submissionId) === submissionId, `[${eventId}] expected submission ${submissionId} linked, got ${String(row.submissionId)}`);

      const subRows = await raw.$queryRawUnsafe(
        `SELECT status, channel_errors AS "channelErrors", resolved_at AS "resolvedAt"
         FROM connector_submissions WHERE tenant_key = $1 AND id = $2`,
        tenantKey,
        submissionId,
      );
      assert(Array.isArray(subRows) && subRows.length === 1, `[${eventId}] expected the seeded submission row`);
      const sub = subRows[0];
      assert(String(sub.status) === "SUPPRESSED", `[${eventId}] expected SUPPRESSED submission, got ${sub.status}`);
      assert(sub.resolvedAt, `[${eventId}] expected submission resolved_at set`);
      assert(
        Array.isArray(sub.channelErrors) && sub.channelErrors.length === 1,
        `[${eventId}] expected exactly 1 channel error (processed once), got ${JSON.stringify(sub.channelErrors)}`,
      );
    }

    const eventA = `wh-cwdv-a-${runId}`;
    const eventB = `wh-cwdv-b-${runId}`;
    const gidA = `gid://shopify/Product/${runId}01`;
    const gidB = `gid://shopify/Product/${runId}02`;

    const subA = await seedSubmission(gidA);
    await deliverNTimes(eventA, gidA, 5, subA);

    const subB = await seedSubmission(gidB);
    await deliverNTimes(eventB, gidB, 20, subB);

    const allRows = await raw.$queryRawUnsafe(
      `SELECT external_event_id AS "e" FROM connector_webhook_events
       WHERE tenant_key = $1 AND installation_id = $2 ORDER BY external_event_id`,
      tenantKey,
      installationId,
    );
    assert(Array.isArray(allRows) && allRows.length === 2, `expected 2 stored webhook rows for installation, got ${allRows.length}`);

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantKey,
          installationId,
          validated: [
            "connector_webhook_dedupe_holds_at_5x_redelivery",
            "connector_webhook_dedupe_holds_at_20x_redelivery",
            "surplus_redeliveries_report_duplicate_processed_without_reprocessing",
            "processing_attempt_count_stays_1_across_redeliveries",
            "matched_submission_resolved_exactly_once",
          ],
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error("Connector webhook dedupe volume test failed:");
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  } finally {
    try {
      await raw.$executeRawUnsafe(`DELETE FROM connector_webhook_events WHERE tenant_key = $1`, tenantKey);
      await raw.$executeRawUnsafe(`DELETE FROM connector_submissions WHERE tenant_key = $1`, tenantKey);
      await raw.$executeRawUnsafe(`DELETE FROM connector_installations WHERE tenant_key = $1`, tenantKey);
    } catch {
      /* best effort */
    }
    if (svc) {
      await svc.prisma.onModuleDestroy().catch(() => undefined);
      await svc.prismaDirect.onModuleDestroy().catch(() => undefined);
    }
    await raw.$disconnect().catch(() => undefined);
  }
}

run().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
