#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const PAGE = path.join(REPO_ROOT, "apps", "web", "src", "app", "admin", "webhooks", "page.tsx");
const ACTIONS = path.join(REPO_ROOT, "apps", "web", "src", "app", "admin", "webhooks", "actions.ts");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(PAGE, "utf8");
  const actionsSource = fs.readFileSync(ACTIONS, "utf8");

  assert(
    source.includes("const { authHeader, actorRole: role } = await getServerSession();"),
    "Admin webhooks must derive shared server auth/session context before loading data.",
  );
  assert(
    source.includes("const [endpoints, deliveries] = await Promise.all([") &&
      source.includes("getOutboundWebhookEndpoints({ role, authHeader })") &&
      source.includes("getOutboundWebhookDeliveries({ limit: 20 }, { role, authHeader })"),
    "Admin webhooks must load configured endpoints and recent deliveries together from the shared auth context.",
  );
  assert(
    source.includes("const EVENT_LABELS: Record<string, string> = {") &&
      source.includes('approval_decision: "Approval decision"') &&
      source.includes('publish_failed: "Publish failed"'),
    "Admin webhooks must expose the canonical event label map for the supported outbound webhook events.",
  );
  assert(
    source.includes('status === "webhook-error"') &&
      source.includes('message={errorMessage || "Unable to update webhook endpoint."}') &&
      source.includes('status === "webhook-created"') &&
      source.includes('status === "webhook-paused"') &&
      source.includes('status === "webhook-resumed"') &&
      source.includes('status === "webhook-test-queued"') &&
      source.includes('status === "webhook-deleted"'),
    "Admin webhooks must surface create, error, pause, resume, test, and delete state banners at the page level.",
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
      source.includes("form action={deleteOutboundWebhookAction}") &&
      source.includes("<CardTitle>Webhook Management</CardTitle>") &&
      source.includes("Admin role is required to create, test, pause, resume, or delete webhook endpoints. You can still review configured endpoints and recent deliveries below."),
    "Admin webhooks must keep create, test, toggle, and delete actions explicitly admin-only while explaining the read-only fallback at the page contract level.",
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
      actionsSource.includes('redirectWithError(error instanceof Error ? error.message : "Unable to update webhook endpoint.");') &&
      actionsSource.includes('redirectWithError(error instanceof Error ? error.message : "Unable to delete webhook endpoint.");'),
    "Admin webhooks must keep action failures inline instead of surfacing opaque server-action errors.",
  );
  assert(
    source.includes('href="/admin/audit"') &&
      source.includes('redirect(buildLoginRedirect("/admin/webhooks", error));'),
    "Admin webhooks must link to audit evidence and redirect auth failures through the shared login helper.",
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
