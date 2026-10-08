#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * Remediation stream E3 — Scenario 2
 * Connector-webhook processing-lease / crash-window recovery.
 *
 * Mechanics (apps/api/src/connector-framework/connector-webhook-ingestion.service.ts,
 * reserveWebhookEvent):
 *   - WEBHOOK_PROCESSING_LEASE_MS = 5min. First delivery INSERTs a row with
 *     processing_status='processing', processing_attempt_count=1,
 *     processing_lease_until = now + 5min, then processReservedWebhookEvent()
 *     drives it to processing_status='processed', processed_at set,
 *     processing_lease_until = NULL.
 *   - A REDELIVERY of the same (installation_id, external_event_id):
 *       * if processed          -> { duplicate:true, reason:"processed" }
 *       * if 'processing' AND processing_lease_until > now
 *                               -> { duplicate:true, reason:"in_progress" }  (still owned)
 *       * if 'processing' AND processing_lease_until <= now  (crash window)
 *                               -> re-reserved: processing_attempt_count += 1,
 *                                  new lease, then processed  ->  NOT lost.
 *   There is NO timer/sweeper for connector_webhook_events lease recovery
 *   (idx_connector_webhooks_recovery is unused by any scan). Recovery is
 *   REDELIVERY-driven only — exercised here by re-invoking ingest().
 *
 * Intended assertions:
 *   - crash-window row (expired lease) is picked up by the next delivery and
 *     driven to terminal 'processed'; attempt_count increments to 2; lease cleared
 *   - actively-leased row (future lease) redelivery is a no-op:
 *     duplicate=true/reason='in_progress'; attempt_count stays 1; still 'processing'
 *
 * PREFLIGHT: reserveWebhookEvent() takes a pg advisory lock via
 *   await tx.$queryRaw(Prisma.sql`SELECT pg_advisory_xact_lock(...)`)
 * which throws with @prisma/client 6.19.3 (void deserialization). The test
 * detects that and reports E3-BLOCKED with the code evidence.
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
  const dbUrl = process.env.DATABASE_URL;
  if (dbUrl) {
    setDefaultEnv("DATABASE_URL_POOLED", dbUrl);
    setDefaultEnv("DATABASE_URL_DIRECT", dbUrl);
  }
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_V1", "vexa-pim-local-encryption-key-v1-minimum-32");
  setDefaultEnv("CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION", "1");
  setDefaultEnv("REDIS_URL", "redis://localhost:6379");
  setDefaultEnv("APP_ENV", "development");
  setDefaultEnv("PIM_SHOPIFY_CLIENT_ID", "shopify-client-id");
  setDefaultEnv("PIM_SHOPIFY_CLIENT_SECRET", "shopify-client-secret");
}
function assert(c, m) {
  if (!c) throw new Error(m);
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
  return { prisma, prismaDirect, ingestion: new ConnectorWebhookIngestionService(prisma, registryStub, logger) };
}

async function run() {
  prepareEnv();
  if (!fs.existsSync(path.join(DIST, "main.js"))) {
    throw new Error(`API build output not found under ${DIST}. Run: npm run build --workspace @pim1/api`);
  }

  const runId = Date.now().toString();
  const tenantKey = `cw-lease-rec-${runId}`;
  const installationId = `inst_cwlr_${runId}`;
  const secret = process.env.PIM_SHOPIFY_CLIENT_SECRET;

  const raw = new PrismaClient({
    datasources: { db: { url: process.env.DATABASE_URL_POOLED || process.env.DATABASE_URL } },
  });

  let svc;
  try {
    svc = await buildIngestion();

    // NOTE (regression guard): reserveWebhookEvent() is the sole entry point for
    // lease recovery (there is no sweeper). It takes its pg advisory lock via
    // tx.$executeRaw(...). An earlier revision used tx.$queryRaw(...) on the
    // void-returning pg_advisory_xact_lock(), which throws "Failed to deserialize
    // column of type 'void'" on @prisma/client 6.19.3 and made recovery impossible.
    // The assertions below fail loudly if that regression returns.

    await raw.$executeRawUnsafe(
      `INSERT INTO connector_installations
         (id, tenant_key, connector_id, account_alias, status, metadata, installed_by, created_at, updated_at)
       VALUES ($1, $2, 'cdef_shopify', $3, 'ACTIVE', '{}'::jsonb, $4, NOW(), NOW())`,
      installationId,
      tenantKey,
      `primary-${runId}`,
      `user_${runId}`,
    );

    function delivery(eventId, gid) {
      const body = Buffer.from(
        JSON.stringify({ admin_graphql_api_id: gid, status: "active", variants: [{ sku: `CWLR-${runId}` }] }),
        "utf8",
      );
      return {
        rawBody: body,
        headers: {
          "x-shopify-topic": "products/update",
          "x-shopify-webhook-id": eventId,
          "x-shopify-hmac-sha256": shopifySignature(secret, body),
        },
      };
    }
    const ingest = (d) => svc.ingestion.ingest({ tenantKey, installationId, rawBody: d.rawBody, headers: d.headers });
    const rowFor = async (eventId) => {
      const rows = await raw.$queryRawUnsafe(
        `SELECT processing_status AS "processingStatus", processing_attempt_count AS "attemptCount",
                processed_at AS "processedAt", processing_lease_until AS "leaseUntil"
         FROM connector_webhook_events WHERE tenant_key = $1 AND installation_id = $2 AND external_event_id = $3`,
        tenantKey,
        installationId,
        eventId,
      );
      return Array.isArray(rows) && rows.length === 1 ? rows[0] : null;
    };

    // --- Case A: crash window (expired lease) is recovered on redelivery ---
    const eventA = `wh-cwlr-a-${runId}`;
    const gidA = `gid://shopify/Product/${runId}01`;
    const firstA = await ingest(delivery(eventA, gidA));
    assert(firstA.accepted === true && firstA.duplicate === false, `A: first delivery must be accepted & not duplicate (${JSON.stringify(firstA)})`);
    let rowA = await rowFor(eventA);
    assert(rowA && String(rowA.processingStatus) === "processed", `A: expected processed after first delivery, got ${rowA && rowA.processingStatus}`);

    // Simulate a worker crash mid-processing with an EXPIRED lease.
    await raw.$executeRawUnsafe(
      `UPDATE connector_webhook_events
         SET processing_status = 'processing', processed_at = NULL, submission_id = NULL,
             processing_lease_until = NOW() - INTERVAL '10 minutes'
       WHERE tenant_key = $1 AND installation_id = $2 AND external_event_id = $3`,
      tenantKey,
      installationId,
      eventA,
    );

    const recoverA = await ingest(delivery(eventA, gidA));
    assert(
      recoverA.accepted === true && recoverA.duplicate === false,
      `A: redelivery after expired lease must be re-reserved (not skipped), got ${JSON.stringify(recoverA)}`,
    );
    rowA = await rowFor(eventA);
    assert(String(rowA.processingStatus) === "processed", `A: crash-window event must be driven back to 'processed', got ${rowA.processingStatus}`);
    assert(rowA.processedAt, "A: processed_at must be set again");
    assert(rowA.leaseUntil === null, "A: processing_lease_until must be cleared after recovery");
    assert(Number(rowA.attemptCount) === 2, `A: processing_attempt_count must increment to 2 on recovery, got ${rowA.attemptCount}`);

    // --- Case B: actively-leased event (future lease) redelivery is a no-op ---
    const eventB = `wh-cwlr-b-${runId}`;
    const gidB = `gid://shopify/Product/${runId}02`;
    const firstB = await ingest(delivery(eventB, gidB));
    assert(firstB.accepted === true && firstB.duplicate === false, `B: first delivery must be accepted (${JSON.stringify(firstB)})`);
    await raw.$executeRawUnsafe(
      `UPDATE connector_webhook_events
         SET processing_status = 'processing', processed_at = NULL,
             processing_lease_until = NOW() + INTERVAL '10 minutes'
       WHERE tenant_key = $1 AND installation_id = $2 AND external_event_id = $3`,
      tenantKey,
      installationId,
      eventB,
    );
    const redeliverB = await ingest(delivery(eventB, gidB));
    assert(
      redeliverB.duplicate === true && redeliverB.reason === "in_progress",
      `B: redelivery of an actively-leased event must be skipped as in_progress, got ${JSON.stringify(redeliverB)}`,
    );
    const rowB = await rowFor(eventB);
    assert(Number(rowB.attemptCount) === 1, `B: attempt_count must stay 1 for an actively-leased event, got ${rowB.attemptCount}`);
    assert(String(rowB.processingStatus) === "processing", `B: row must remain 'processing' (still owned), got ${rowB.processingStatus}`);

    // --- Case C: SWEEPER-driven recovery — stranded 'processing' row, NO redelivery ---
    // Proves idx_connector_webhooks_recovery is now read by the lease sweeper and
    // that a row whose worker crashed mid-processing (expired lease, connector
    // never re-sends) is driven to a terminal state instead of stranded forever.
    const { ConnectorWebhookLeaseSweeperService } = require(path.join(
      DIST,
      "connector-framework",
      "connector-webhook-lease-sweeper.service.js",
    ));

    const eventC = `wh-cwlr-c-${runId}`;
    const gidC = `gid://shopify/Product/${runId}03`;
    const firstC = await ingest(delivery(eventC, gidC));
    assert(
      firstC.accepted === true && firstC.duplicate === false,
      `C: first delivery must be accepted & not duplicate (${JSON.stringify(firstC)})`,
    );
    let rowC = await rowFor(eventC);
    assert(rowC && String(rowC.processingStatus) === "processed", `C: expected processed after first delivery, got ${rowC && rowC.processingStatus}`);

    // Simulate crash mid-processing: back to 'processing', lease 10 min in the past,
    // effects rolled back. Crucially: we DO NOT re-invoke ingest() — there is no redelivery.
    await raw.$executeRawUnsafe(
      `UPDATE connector_webhook_events
         SET processing_status = 'processing', processed_at = NULL, submission_id = NULL,
             processing_lease_until = NOW() - INTERVAL '10 minutes'
       WHERE tenant_key = $1 AND installation_id = $2 AND external_event_id = $3`,
      tenantKey,
      installationId,
      eventC,
    );
    const beforeC = await rowFor(eventC);
    assert(String(beforeC.processingStatus) === "processing", `C: precondition — row must be stranded 'processing', got ${beforeC.processingStatus}`);
    assert(beforeC.leaseUntil && new Date(beforeC.leaseUntil).getTime() < Date.now(), "C: precondition — lease must be expired");

    const sweeper = new ConnectorWebhookLeaseSweeperService(svc.prisma, svc.ingestion);
    // Tenant-scoped + tiny cap keeps the run deterministic in a shared dev DB.
    const sweepSummary = await sweeper.runSweep({ tenantKey, maxAttempts: 3 });
    assert(
      sweepSummary && Number(sweepSummary.scanned) >= 1,
      `C: sweep must scan the stranded row, got ${JSON.stringify(sweepSummary)}`,
    );
    assert(
      Number(sweepSummary.processed) + Number(sweepSummary.failed) + Number(sweepSummary.retried) >= 1,
      `C: sweep must act on the stranded row, got ${JSON.stringify(sweepSummary)}`,
    );

    const afterC = await rowFor(eventC);
    assert(
      ["processed", "failed"].includes(String(afterC.processingStatus)),
      `C: sweeper must drive the stranded event to a terminal state (processed|failed), got ${afterC.processingStatus} (lastError: ${afterC.lastError})`,
    );
    assert(
      Number(afterC.attemptCount) === Number(beforeC.attemptCount) + 1,
      `C: processing_attempt_count must advance by exactly 1, got ${beforeC.attemptCount} -> ${afterC.attemptCount}`,
    );
    assert(afterC.leaseUntil === null, `C: processing_lease_until must be cleared once terminal, got ${afterC.leaseUntil}`);
    // With a re-parsable stored payload and no matching PENDING submission, the
    // canonical outcome is 'processed' (row unstranded, submission_id NULL).
    assert(
      String(afterC.processingStatus) === "processed",
      `C: stored-payload replay must reach 'processed', got ${afterC.processingStatus} (lastError: ${afterC.lastError})`,
    );

    // Idempotency: a second sweep finds nothing to do for this tenant.
    const sweepAgain = await sweeper.runSweep({ tenantKey, maxAttempts: 3 });
    assert(Number(sweepAgain.scanned) === 0, `C: terminal row must not be re-swept, got ${JSON.stringify(sweepAgain)}`);

    console.log(
      JSON.stringify(
        {
          status: "ok",
          tenantKey,
          installationId,
          validated: [
            "crash_window_event_with_expired_lease_is_re_reserved_and_driven_to_processed",
            "recovery_increments_processing_attempt_count_and_clears_lease",
            "actively_leased_event_redelivery_is_skipped_in_progress",
            "actively_leased_event_is_not_reprocessed_or_lost",
          ],
          checkedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error("Connector webhook lease recovery test failed:");
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
