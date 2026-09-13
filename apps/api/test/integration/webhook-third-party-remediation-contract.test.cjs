const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const repoRoot = path.resolve(__dirname, "../../..", "..");

function read(rel) {
  return fs.readFileSync(path.join(repoRoot, rel), "utf8");
}

function assertContains(haystack, needle, message) {
  assert.ok(haystack.includes(needle), message || `Expected source to contain: ${needle}`);
}

function assertNotContains(haystack, needle, message) {
  assert.ok(!haystack.includes(needle), message || `Expected source not to contain: ${needle}`);
}

const schema = read("packages/db/prisma/schema.prisma");
const migration = read("packages/db/prisma/migrations/20260905093000_webhook_reliability_hardening/migration.sql");
const main = read("apps/api/src/main.ts");
const relay = read("apps/api/src/connector-framework/connector-webhook-relay.controller.ts");
const ingestion = read("apps/api/src/connector-framework/connector-webhook-ingestion.service.ts");
const outbound = read("apps/api/src/outbound-webhooks/outbound-webhooks.service.ts");
const urlSafety = read("apps/api/src/common/security/url-safety.ts");
const stripeService = read("apps/api/src/billing/stripe.service.ts");
const stripeController = read("apps/api/src/billing/stripe-webhook.controller.ts");
const wooConnector = read("apps/api/src/connectors/woocommerce/woocommerce.connector.ts");
const wooReconciliation = read("apps/api/src/connectors/woocommerce/woocommerce-reconciliation.service.ts");
const connectorHttp = read("apps/api/src/connector-framework/connector-http-client.service.ts");
const recoveryPage = read("apps/web/src/app/channels/connectors/[installationId]/recovery/page.tsx");

assertContains(schema, "processingLeaseUntil", "connector webhook events need a processing lease");
assertContains(schema, "rawBodySha256", "connector webhook events need raw body hash evidence");
assertContains(schema, "model StripeWebhookEvent", "Stripe event persistence model must exist");
assertContains(schema, "queueJobId", "outbound delivery enqueue job ID must be stored");
assertContains(schema, "enqueueError", "outbound delivery enqueue failure must be visible");
assertContains(migration, "CREATE TABLE IF NOT EXISTS \"stripe_webhook_events\"", "migration must create Stripe webhook event table");
assertContains(migration, "idx_outbound_webhook_deliveries_stuck_queued", "migration must index stuck queued recovery");

assertContains(main, 'app.use("/api/v1/connector-webhooks/relay", raw({ type: "*/*", limit: EXPRESS_BODY_LIMIT }))', "relay route must use raw body parser before JSON");
assertNotContains(relay, "@Body()", "relay must not use Nest Body parser for signed provider bytes");
assertContains(relay, "readRawRequestBody(request)", "relay must read exact raw request bytes");
assertContains(relay, "rawBodyBase64: canonicalBody.toString(\"base64\")", "relay must preserve raw bytes through queue payload");

assertContains(ingestion, "WEBHOOK_PROCESSING_LEASE_MS", "inbound webhook processing lease is required");
assertContains(ingestion, "pg_advisory_xact_lock", "inbound dedupe/recovery reservation must be serialized");
assertContains(ingestion, "processReservedWebhookEvent", "business mutation and processed marking must be coupled");
assertContains(ingestion, "processingStatus: WEBHOOK_PROCESSING_STATUS_FAILED", "failed inbound events must be persisted for retry");
assertContains(ingestion, "processingAttemptCount: { increment: 1 }", "inbound retry attempts must be counted");

assertContains(urlSafety, "Webhook target URL must resolve to a public address.", "DNS uncertainty must fail closed");
assertContains(urlSafety, "resolves to a private or reserved IP address", "resolved private addresses must be blocked");
assertContains(outbound, "recoverStuckQueuedDeliveries", "outbound stuck queued recovery must exist");
assertContains(outbound, "lastEnqueueAttemptAt", "outbound enqueue attempts must be stored");
assertContains(outbound, "enqueueError", "outbound enqueue errors must be visible");
assertContains(outbound, "redirect: \"manual\"", "outbound redirects must not be followed automatically");
assertContains(outbound, "const targetUrl = await this.normalizeTargetUrl(endpoint.targetUrl)", "dispatch must revalidate URL at send time");

assertContains(stripeService, 'export const STRIPE_API_VERSION = "2026-05-27.dahlia"', "Stripe API version must be pinned");
assertContains(stripeService, "reserveWebhookEvent", "Stripe webhook event reservation must exist");
assertContains(stripeService, "stripe_webhook_events", "Stripe service must persist event IDs");
assertContains(stripeController, "reserveWebhookEvent(event.id, event.type)", "Stripe controller must dedupe before dispatch");
assertContains(stripeController, "markWebhookEventProcessed(event.id, tenantKey)", "Stripe processed state must be recorded");
assertContains(stripeController, "markWebhookEventFailed(event.id, error, tenantKey)", "Stripe failed state must be recorded");

assertContains(wooConnector, "ConnectorHttpClient", "WooCommerce must use shared HTTP client");
assertContains(wooConnector, "this.httpClient.fetch('woocommerce'", "WooCommerce provider calls must route through shared retry/rate-limit behavior");
assertContains(wooConnector, "providerReadUnavailable: true", "WooCommerce reconciliation must report provider read failures");
assertContains(wooReconciliation, "providerReadUnavailable", "WooCommerce reconciliation job must not treat provider read failures as no drift");

assertContains(connectorHttp, "consumeChain", "token bucket must serialize concurrent consumers");
assertContains(connectorHttp, "consumeLocked", "token bucket must perform locked refill/decrement loop");

assertNotContains(
  recoveryPage,
  "getConnectorRecoveryGroups(installationId, { role: actorRole, authHeader }).catch(() => [])",
  "recovery page must not convert API failure into empty success state",
);
assertContains(recoveryPage, "Recovery data unavailable", "recovery page must show unavailable state");

console.log("webhook-third-party-remediation-contract: ok");
