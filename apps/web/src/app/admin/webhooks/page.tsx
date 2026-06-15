import Link from "next/link";
import { redirect } from "next/navigation";
import {
  createOutboundWebhookAction,
  deleteOutboundWebhookAction,
  sendTestOutboundWebhookAction,
  toggleOutboundWebhookAction,
} from "./actions";
import { Card, CardTitle } from "@/components/ui/card";
import { DataGrid } from "@/components/ui/data-grid";
import { InlineAlert } from "@/components/ui/inline-alert";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import {
  ApiHttpError,
  getBillingPlanProfile,
  getOutboundWebhookDeliveries,
  getOutboundWebhookEndpoints,
} from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerSession } from "@/lib/server-session";
import { formatDateTime } from "@/lib/format";
import { WEBHOOK_EVENT_LABELS as EVENT_LABELS } from "@/lib/constants/webhook-events";

export const dynamic = "force-dynamic";

interface WebhookAdminPageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

function DeliveryTone(status: string) {
  if (status === "delivered") {
    return "success" as const;
  }
  if (status === "failed") {
    return "danger" as const;
  }
  if (status === "queued") {
    return "info" as const;
  }
  return "neutral" as const;
}

function isRecentDelivery(value: string | null | undefined, nowMs: number, cutoffMs: number) {
  if (!value) {
    return false;
  }
  const parsed = new Date(value).getTime();
  if (Number.isNaN(parsed)) {
    return false;
  }
  return nowMs - parsed <= cutoffMs;
}

function resolveWebhookFieldErrors(message: string) {
  const normalized = message.toLowerCase();
  return {
    name: normalized.includes("name"),
    eventType: normalized.includes("event"),
    targetUrl: normalized.includes("target url") || normalized.includes("url"),
    signingSecret: normalized.includes("signing secret") || normalized.includes("secret"),
  };
}

export default async function WebhookAdminPage({ searchParams }: WebhookAdminPageProps) {
  const query = await searchParams;
  const { authHeader, actorRole: role, adminBoundaryRoles } = await getServerSession();
  const isSystemAdmin = adminBoundaryRoles.includes("system_admin") || adminBoundaryRoles.includes("super_admin");
  if (role !== "admin" || !isSystemAdmin) {
    redirect("/admin");
  }
  const status = String(query.status ?? "").trim();
  const errorMessage = String(query.message ?? "").trim();
  const confirmDeleteEndpointId = String(query.confirmDelete ?? "").trim();
  const webhookFieldErrors = resolveWebhookFieldErrors(errorMessage);

  try {
    const [endpoints, deliveries, planProfile] = await Promise.all([
      getOutboundWebhookEndpoints({ role, authHeader }),
      getOutboundWebhookDeliveries({ limit: 20 }, { role, authHeader }),
      getBillingPlanProfile({ role, authHeader }),
    ]);
    const planTier = String(planProfile.planTier ?? "TRIAL").toUpperCase();

    if (planTier === "TRIAL" || planTier === "STARTER") {
      return (
        <div className="space-y-5">
          <PageHeader
            title="Outbound Webhooks"
            description="Send Vexa notification events to tenant-managed HTTP endpoints."
            breadcrumb={
              <>
                Dashboard / Admin / <span className="font-semibold text-slate-700">Outbound Webhooks</span>
              </>
            }
          />
          <Card>
            <CardTitle>Plan Upgrade Required</CardTitle>
            <p className="mt-2 text-sm text-slate-600">
              Outbound webhooks are available on the Growth plan and above. Upgrade to deliver HMAC-signed
              import and publish event notifications to your own HTTP endpoints.
            </p>
            <div className="mt-4">
              <Link
                href="/admin/plan"
                className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                View Plan &amp; Upgrade
              </Link>
            </div>
          </Card>
        </div>
      );
    }

    const nowMs = Date.now();
    const last24HoursMs = 24 * 60 * 60 * 1000;
    const activeEndpoints = endpoints.filter((endpoint) => endpoint.isActive).length;
    const recentDeliveries = deliveries.filter((delivery) =>
      isRecentDelivery(delivery.attemptedAt, nowMs, last24HoursMs),
    );
    const failedDeliveries24h = recentDeliveries.filter((delivery) => delivery.status === "failed").length;

    return (
      <div className="space-y-5">
        <PageHeader
          title="Outbound Webhooks"
          description="Send Vexa notification events to tenant-managed HTTP endpoints."
          breadcrumb={
            <>
              Dashboard / Admin / <span className="font-semibold text-slate-700">Outbound Webhooks</span>
            </>
          }
        />

        {status === "webhook-error" ? (
          <InlineAlert tone="error" message={errorMessage || "Unable to update webhook endpoint."} />
        ) : null}
        {status === "webhook-created" ? <InlineAlert tone="success" message="Webhook endpoint created." /> : null}
        {status === "webhook-paused" ? <InlineAlert tone="info" message="Webhook endpoint paused." /> : null}
        {status === "webhook-resumed" ? <InlineAlert tone="success" message="Webhook endpoint resumed." /> : null}
        {status === "webhook-test-queued" ? <InlineAlert tone="success" message="Webhook test delivery queued." /> : null}
        {status === "webhook-deleted" ? <InlineAlert tone="success" message="Webhook endpoint deleted." /> : null}

        <section className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardTitle>Active Endpoints</CardTitle>
            <p className="mt-3 text-3xl font-semibold text-slate-900">{activeEndpoints}</p>
            <p className="mt-2 text-sm text-slate-600">
              {activeEndpoints > 0 ? "Endpoints currently able to receive events." : "No active endpoints are configured yet."}
            </p>
          </Card>
          <Card>
            <CardTitle>Deliveries (24h)</CardTitle>
            <p className="mt-3 text-3xl font-semibold text-slate-900">{recentDeliveries.length}</p>
            <p className="mt-2 text-sm text-slate-600">Recent attempts recorded in the last 24 hours.</p>
          </Card>
          <Card className={failedDeliveries24h > 0 ? "border-red-200 bg-red-50/70" : undefined}>
            <CardTitle>Failed (24h)</CardTitle>
            <p className="mt-3 text-3xl font-semibold text-slate-900">{failedDeliveries24h}</p>
            <p className="mt-2 text-sm text-slate-600">
              {failedDeliveries24h > 0 ? "Recent delivery failures need follow-up." : "No failed deliveries recorded in the last 24 hours."}
            </p>
          </Card>
        </section>

        <Card>
          <CardTitle>Delivery health guide</CardTitle>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="space-y-3">
              <p className="text-sm text-slate-700">
                Use delivery status to decide whether to monitor the queue, inspect the receiver, or pause the endpoint before downstream systems drift.
              </p>
              <div className="flex flex-wrap gap-2">
                <StatusChip label="queued" tone="info" />
                <StatusChip label="delivered" tone="success" />
                <StatusChip label="failed" tone="danger" />
              </div>
              <p className="text-sm text-slate-600">
                Recent failures usually mean the receiver rejected the payload, the signing secret is mismatched, or the target is temporarily unavailable.
              </p>
            </div>
            <div className="space-y-2 text-sm">
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="font-medium text-slate-900">If status is queued</p>
                <p className="mt-1 text-slate-600">Wait for the delivery worker to finish and then refresh the recent deliveries table.</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="font-medium text-slate-900">If status is failed</p>
                <p className="mt-1 text-slate-600">Inspect the response code, confirm the signing secret, and use Send test before resuming live traffic.</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                <p className="font-medium text-slate-900">If an endpoint is paused</p>
                <p className="mt-1 text-slate-600">Resume only after the receiver is healthy so delivery retries do not create more operational noise.</p>
              </div>
            </div>
          </div>
        </Card>

        <Card>
          <CardTitle>Receiver readiness checklist</CardTitle>
          <div className="mt-3 grid gap-3 md:grid-cols-3">
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-900">Validate the signature</p>
              <p className="mt-1 text-sm text-slate-600">
                Verify <code>x-pim1-webhook-signature</code> before processing the payload so unexpected senders cannot trigger automation.
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-900">Acknowledge quickly</p>
              <p className="mt-1 text-sm text-slate-600">
                Return a fast 2xx response after persistence or queue handoff so delivery retries are reserved for real failures.
              </p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="text-sm font-semibold text-slate-900">Log event evidence</p>
              <p className="mt-1 text-sm text-slate-600">
                Capture the event type, endpoint name, and receiver response details so incidents can be traced across Vexa and the downstream system.
              </p>
            </div>
          </div>
        </Card>

        {role === "admin" ? (
          <Card>
            <CardTitle>Create Endpoint</CardTitle>
            <form action={createOutboundWebhookAction} className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <label className="space-y-1 text-sm">
                <span className="text-slate-600">Name</span>
                <input
                  type="text"
                  name="name"
                  required
                  className="w-full rounded-md border border-slate-200 px-3 py-2"
                  placeholder="Approval decisions"
                  aria-invalid={status === "webhook-error" && webhookFieldErrors.name ? "true" : undefined}
                  aria-describedby={status === "webhook-error" && webhookFieldErrors.name ? "webhook-name-error" : undefined}
                />
                {status === "webhook-error" && webhookFieldErrors.name ? (
                  <p id="webhook-name-error" className="text-xs text-red-700">{errorMessage}</p>
                ) : null}
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-slate-600">Event</span>
                <select
                  name="eventType"
                  required
                  className="w-full rounded-md border border-slate-200 px-3 py-2"
                  aria-invalid={status === "webhook-error" && webhookFieldErrors.eventType ? "true" : undefined}
                  aria-describedby={status === "webhook-error" && webhookFieldErrors.eventType ? "webhook-event-error" : undefined}
                >
                  {Object.entries(EVENT_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                {status === "webhook-error" && webhookFieldErrors.eventType ? (
                  <p id="webhook-event-error" className="text-xs text-red-700">{errorMessage}</p>
                ) : null}
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-slate-600">Target URL</span>
                <input
                  type="url"
                  name="targetUrl"
                  id="webhook-target-url"
                  required
                  className="w-full rounded-md border border-slate-200 px-3 py-2"
                  placeholder="https://example.com/webhooks/vexa-pim"
                  aria-required="true"
                  aria-invalid={status === "webhook-error" && webhookFieldErrors.targetUrl ? "true" : undefined}
                  aria-describedby={status === "webhook-error" && webhookFieldErrors.targetUrl ? "webhook-target-error" : "webhook-url-hint"}
                />
                {status === "webhook-error" && webhookFieldErrors.targetUrl ? (
                  <p id="webhook-target-error" className="text-xs text-red-700">{errorMessage}</p>
                ) : (
                  <span id="webhook-url-hint" className="text-xs text-slate-500">Must be a valid HTTPS URL.</span>
                )}
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-slate-600">Signing secret</span>
                <input
                  type="password"
                  name="signingSecret"
                  id="webhook-signing-secret"
                  required
                  className="w-full rounded-md border border-slate-200 px-3 py-2"
                  placeholder="minimum 16 characters"
                  aria-required="true"
                  aria-invalid={status === "webhook-error" && webhookFieldErrors.signingSecret ? "true" : undefined}
                  aria-describedby={status === "webhook-error" && webhookFieldErrors.signingSecret ? "webhook-secret-error" : "webhook-secret-hint"}
                />
                {status === "webhook-error" && webhookFieldErrors.signingSecret ? (
                  <p id="webhook-secret-error" className="text-xs text-red-700">{errorMessage}</p>
                ) : (
                  <span id="webhook-secret-hint" className="text-xs text-slate-500">Minimum 16 characters.</span>
                )}
              </label>
              <div className="md:col-span-2 xl:col-span-4 flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                <span>
                  Vexa PIM signs each delivery with <code>x-pim1-webhook-signature</code> using HMAC SHA-256 over
                  <code>{" timestamp.body"}</code>.
                </span>
                <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 font-medium text-white">
                  Create webhook
                </button>
              </div>
            </form>
          </Card>
        ) : (
          <Card>
            <CardTitle>Webhook Management</CardTitle>
            <p className="mt-3 text-sm text-slate-600">
              Admin role is required to create, test, pause, resume, or delete webhook endpoints. You can still review configured endpoints and recent deliveries below.
            </p>
          </Card>
        )}

        <Card>
          <CardTitle>Configured Endpoints</CardTitle>
          <div className="mt-3">
            <DataGrid
              columns={[
                {
                  key: "name",
                  header: "Name",
                  render: (endpoint) => (
                    <>
                      <div className="font-medium text-slate-900">{endpoint.name}</div>
                      <div className="text-xs text-slate-500">Created by {endpoint.createdBy || "system"}</div>
                    </>
                  ),
                },
                {
                  key: "eventType",
                  header: "Event",
                  render: (endpoint) => EVENT_LABELS[endpoint.eventType] ?? endpoint.eventType,
                },
                {
                  key: "targetUrl",
                  header: "Target",
                  mobileHide: true,
                  cellClassName: "text-xs text-slate-600 break-all",
                },
                {
                  key: "status",
                  header: "Status",
                  render: (endpoint) => (
                    <StatusChip label={endpoint.isActive ? "active" : "paused"} tone={endpoint.isActive ? "success" : "neutral"} />
                  ),
                },
                {
                  key: "lastTriggeredAt",
                  header: "Last triggered",
                  mobileHide: true,
                  cellClassName: "text-xs text-slate-600",
                  render: (endpoint) => (endpoint.lastTriggeredAt ? formatDateTime(endpoint.lastTriggeredAt) : "-"),
                },
                {
                  key: "actions",
                  header: "Actions",
                  render: (endpoint) =>
                    role === "admin" ? (
                      <div className="flex flex-wrap gap-2">
                        <form action={sendTestOutboundWebhookAction}>
                          <input type="hidden" name="endpointId" value={endpoint.id} />
                          <button type="submit" className="rounded-md border border-sky-200 px-3 py-2 text-sm text-sky-700">
                            Send test
                          </button>
                        </form>
                        <form action={toggleOutboundWebhookAction}>
                          <input type="hidden" name="endpointId" value={endpoint.id} />
                          <input type="hidden" name="isActive" value={endpoint.isActive ? "false" : "true"} />
                          <button type="submit" className="rounded-md border border-slate-200 px-3 py-2 text-sm">
                            {endpoint.isActive ? "Pause" : "Resume"}
                          </button>
                        </form>
                        {confirmDeleteEndpointId === endpoint.id ? (
                          <form action={deleteOutboundWebhookAction} className="flex items-center gap-2">
                            <input type="hidden" name="endpointId" value={endpoint.id} />
                            <span className="text-xs text-rose-700">Confirm delete?</span>
                            <button type="submit" className="rounded-md border border-rose-300 bg-rose-50 px-3 py-1.5 text-xs font-medium text-rose-700 hover:bg-rose-100">
                              Delete
                            </button>
                            <Link href="/admin/webhooks" className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
                              Cancel
                            </Link>
                          </form>
                        ) : (
                          <Link
                            href={`/admin/webhooks?confirmDelete=${encodeURIComponent(endpoint.id)}`}
                            className="rounded-md border border-rose-200 px-3 py-2 text-sm text-rose-700 hover:bg-rose-50"
                          >
                            Delete
                          </Link>
                        )}
                      </div>
                    ) : (
                      <span className="text-xs text-slate-500">Read-only</span>
                    ),
                },
              ]}
              rows={endpoints}
              getRowKey={(endpoint) => endpoint.id}
              caption="Configured Endpoints"
              rowClassName="align-top"
              emptyState={<p className="text-sm text-slate-600">No outbound webhook endpoints configured for this tenant.</p>}
            />
          </div>
        </Card>

        <Card>
          <CardTitle>Recent Deliveries</CardTitle>
          <div className="mt-3">
            <DataGrid
              columns={[
                {
                  key: "endpointName",
                  header: "Endpoint",
                  cellClassName: "font-medium text-slate-900",
                  render: (delivery) => delivery.endpointName || delivery.endpointId,
                },
                {
                  key: "eventType",
                  header: "Event",
                  render: (delivery) => EVENT_LABELS[delivery.eventType] ?? delivery.eventType,
                },
                {
                  key: "status",
                  header: "Status",
                  render: (delivery) => (
                    <StatusChip label={delivery.status} tone={DeliveryTone(delivery.status)} />
                  ),
                },
                {
                  key: "attemptCount",
                  header: "Attempts",
                  mobileHide: true,
                },
                {
                  key: "response",
                  header: "Response",
                  mobileHide: true,
                  cellClassName: "text-xs text-slate-600",
                  render: (delivery) => (
                    <>
                      {delivery.responseStatus ?? "-"}
                      {delivery.errorMessage ? ` - ${delivery.errorMessage}` : ""}
                    </>
                  ),
                },
                {
                  key: "attemptedAt",
                  header: "Last attempt",
                  mobileHide: true,
                  cellClassName: "text-xs text-slate-600",
                  render: (delivery) => (delivery.attemptedAt ? formatDateTime(delivery.attemptedAt) : "-"),
                },
              ]}
              rows={deliveries}
              getRowKey={(delivery) => delivery.id}
              caption="Recent Deliveries"
              emptyState={<p className="text-sm text-slate-600">No deliveries recorded yet.</p>}
            />
          </div>
        </Card>

        <div className="text-sm text-slate-600">
          Looking for audit evidence? Open <Link href="/admin/audit" className="text-blue-700 hover:underline">Audit Logs</Link>.
        </div>
      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/admin/webhooks", error));
    }
    throw error;
  }
}

