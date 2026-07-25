#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "admin", "webhooks", "page.tsx");
const ACTIONS = path.join(REPO_ROOT, "apps", "web", "src", "app", "admin", "webhooks", "actions.ts");
const WEBHOOK_EVENTS = path.join(REPO_ROOT, "apps", "web", "src", "lib", "constants", "webhook-events.ts");
const WEB_API = path.join(REPO_ROOT, "apps", "web", "src", "lib", "api", "admin.ts");
const API_CONTROLLER = path.join(REPO_ROOT, "apps", "api", "src", "outbound-webhooks", "outbound-webhooks.controller.ts");
const API_SERVICE = path.join(REPO_ROOT, "apps", "api", "src", "outbound-webhooks", "outbound-webhooks.service.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(PAGE, "utf8");
  const actionsSource = fs.readFileSync(ACTIONS, "utf8");
  const eventsSource = fs.readFileSync(WEBHOOK_EVENTS, "utf8");
  const webApiSource = fs.readFileSync(WEB_API, "utf8");
  const apiControllerSource = fs.readFileSync(API_CONTROLLER, "utf8");
  const apiServiceSource = fs.readFileSync(API_SERVICE, "utf8");
  const retryMethodMatch = apiServiceSource.match(/async retryFailedDelivery[\s\S]*?\n  async enqueueNotificationEvent/);
  const retryMethodSource = retryMethodMatch ? retryMethodMatch[0] : "";

  assert(
    source.includes("await getServerSession();") &&
      source.includes("authHeader") &&
      source.includes("actorRole: role"),
    "Admin webhooks must derive shared server auth/session context before loading data.",
  );
  assert(
    source.includes("const [endpoints, deliveries, planProfile] = await Promise.all([") &&
      source.includes("getOutboundWebhookEndpoints({ role, authHeader })") &&
      source.includes("limit: 200") &&
      source.includes("endpointId: deliveryEndpointFilter || undefined") &&
      source.includes('status: deliveryStatusFilter === "all" ? undefined : deliveryStatusFilter'),
    "Admin webhooks must load configured endpoints and filterable recent deliveries from the shared auth context.",
  );
  assert(
    eventsSource.includes("WEBHOOK_EVENT_LABELS") &&
      eventsSource.includes('approval_decision: "Approval decision"') &&
      eventsSource.includes('publish_failed: "Publish failed"') &&
      source.includes("WEBHOOK_EVENT_LABELS"),
    "Admin webhooks must expose the canonical event label map for the supported outbound webhook events.",
  );
  assert(
    source.includes('status === "webhook-error"') &&
      source.includes('message={errorMessage || "Unable to update webhook endpoint."}') &&
      source.includes('status === "webhook-created"') &&
      source.includes('status === "webhook-paused"') &&
      source.includes('status === "webhook-resumed"') &&
      source.includes('status === "webhook-test-queued"') &&
      source.includes('status === "webhook-secret-rotated"') &&
      source.includes('status === "webhook-retry-queued"') &&
      source.includes('status === "webhook-deleted"'),
    "Admin webhooks must surface create, error, pause, resume, test, rotation, retry, and delete state banners at the page level.",
  );
  assert(
    source.includes("CardTitle>Delivery health guide</CardTitle>") &&
      source.includes("If status is queued") &&
      source.includes("If status is failed") &&
      source.includes("If an endpoint is paused"),
    "Admin webhooks must explain delivery-state recovery guidance in plain language before operators inspect endpoint and delivery tables.",
  );
  assert(
    source.includes("Receiver readiness checklist") &&
      source.includes("Validate the signature") &&
      source.includes("Acknowledge quickly") &&
      source.includes("Log event evidence") &&
      source.includes("x-pim1-webhook-signature") &&
      source.includes("Return a fast 2xx response after persistence or queue handoff") &&
      source.includes("receiver response details so incidents can be traced across Vexa and the downstream system."),
    "Admin webhooks must guide operators on what a healthy receiver implementation should do after endpoint setup.",
  );
  assert(
    source.includes('role === "admin" ? (') &&
      source.includes("form action={createOutboundWebhookAction}") &&
      source.includes("form action={sendTestOutboundWebhookAction}") &&
      source.includes("form action={toggleOutboundWebhookAction}") &&
      source.includes("form action={rotateOutboundWebhookSecretAction}") &&
      source.includes("form action={retryOutboundWebhookDeliveryAction}") &&
      source.includes("form action={deleteOutboundWebhookAction}") &&
      source.includes("<CardTitle>Webhook Management</CardTitle>") &&
      source.includes("Admin role is required to create, test, rotate, pause, resume, retry, or delete webhook endpoints. You can still review configured endpoints and recent deliveries below."),
    "Admin webhooks must keep create, test, rotate, retry, toggle, and delete actions explicitly admin-only while explaining the read-only fallback at the page contract level.",
  );
  assert(
    source.includes('const WEBHOOK_DELIVERY_STATUS_FILTERS = ["all", "queued", "delivered", "failed", "skipped"] as const') &&
      source.includes('name="endpointId"') &&
      source.includes('name="deliveryStatus"') &&
      source.includes("No deliveries match the selected filters.") &&
      webApiSource.includes("endpointId?: string; status?: OutboundWebhookDelivery[\"status\"]; limit?: number"),
    "Admin webhooks must expose endpoint/status delivery filters backed by the existing API client query support.",
  );
  assert(
    actionsSource.includes("rotateOutboundWebhookSecretAction") &&
      actionsSource.includes("signingSecret.length < 16") &&
      actionsSource.includes("updateOutboundWebhookEndpoint(endpointId, { signingSecret }") &&
      actionsSource.includes('redirectWithStatus("webhook-secret-rotated"'),
    "Admin webhooks must rotate signing secrets through the existing endpoint update path with validation and banners.",
  );
  assert(
    webApiSource.includes("retryOutboundWebhookDelivery") &&
      webApiSource.includes('/admin/webhooks/deliveries/${encodeURIComponent(deliveryId)}/retry') &&
      apiControllerSource.includes('@Post("deliveries/:id/retry")') &&
      apiControllerSource.includes("retryFailedDelivery("),
    "Admin webhooks must expose a tenant-scoped failed-delivery retry API route and web API helper.",
  );
  assert(
    retryMethodSource.includes('existing.status !== "failed"') &&
      retryMethodSource.includes("Only failed webhook deliveries can be retried.") &&
      retryMethodSource.includes("!endpoint.isActive") &&
      retryMethodSource.includes("Resume the webhook endpoint before retrying this delivery.") &&
      retryMethodSource.includes("this.createQueuedDelivery(") &&
      retryMethodSource.includes("existing.eventId") &&
      retryMethodSource.includes("originalDeliveryId: existing.id") &&
      !retryMethodSource.includes("outboundWebhookDelivery.update("),
    "Admin webhooks retry must clone failed deliveries into a new queued delivery while preserving the original failed row.",
  );
  assert(
    source.includes('delivery.status === "failed"') &&
      source.includes("Retry") &&
      source.includes('name="deliveryId" value={delivery.id}'),
    "Admin webhooks must show retry only for failed delivery rows.",
  );
  assert(
    source.includes('x-pim1-webhook-signature') &&
      source.includes('HMAC SHA-256') &&
      source.includes('No outbound webhook endpoints configured for this tenant.') &&
      source.includes('No deliveries recorded yet.'),
    "Admin webhooks must document delivery signing and surface honest empty states for endpoints and deliveries.",
  );
  assert(
    source.includes('StatusChip label={endpoint.isActive ? "active" : "paused"} tone={endpoint.isActive ? "success" : "neutral"}') &&
      source.includes('StatusChip label={delivery.status} tone={DeliveryTone(delivery.status)}') &&
      source.includes('delivery.errorMessage ? ` - ${delivery.errorMessage}` : ""'),
    "Admin webhooks must surface endpoint lifecycle and delivery health states with meaningful status chips and failure detail.",
  );
  assert(
    source.includes('const errorMessage = String(query.message ?? "").trim();') &&
      actionsSource.includes('redirectWithError(error instanceof Error ? error.message : "Unable to create webhook endpoint.");') &&
      actionsSource.includes('"Unable to update webhook endpoint.", redirectTo') &&
      actionsSource.includes('"Unable to delete webhook endpoint.", redirectTo') &&
      actionsSource.includes('"Unable to retry webhook delivery.", redirectTo'),
    "Admin webhooks must keep action failures inline instead of surfacing opaque server-action errors.",
  );
  assert(
    source.includes('href="/admin/audit"') &&
      source.includes('redirect(buildLoginRedirect("/admin/webhooks", error));'),
    "Admin webhooks must link to audit evidence and redirect auth failures through the shared login helper.",
  );
  assert(
    source.includes("getBillingPlanProfile(") &&
      source.includes('planTier === "TRIAL" || planTier === "STARTER"') &&
      source.includes("Plan Upgrade Required"),
    "Admin webhooks must gate the page behind a GROWTH+ plan check and show an upgrade card to TRIAL/STARTER workspaces.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "admin_webhooks_route_uses_shared_server_auth_context",
          "admin_webhooks_route_fetches_endpoints_and_deliveries_in_parallel",
          "admin_webhooks_route_exposes_canonical_event_labels",
          "admin_webhooks_route_surfaces_status_banners",
          "admin_webhooks_route_keeps_error_feedback_inline",
          "admin_webhooks_route_keeps_mutations_admin_only",
          "admin_webhooks_route_supports_endpoint_status_delivery_filters",
          "admin_webhooks_route_supports_secret_rotation",
          "admin_webhooks_route_supports_failed_delivery_retry",
          "admin_webhooks_route_documents_signing_and_empty_states",
          "admin_webhooks_route_surfaces_endpoint_and_delivery_status",
          "admin_webhooks_route_links_audit_and_redirects_auth_failures",
        ],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

try {
  run();
} catch (error) {
  console.error("Admin webhooks route contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
