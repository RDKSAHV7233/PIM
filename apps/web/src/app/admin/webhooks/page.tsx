import Link from "next/link";
import { redirect } from "next/navigation";
import {
  createOutboundWebhookAction,
  deleteOutboundWebhookAction,
  sendTestOutboundWebhookAction,
  toggleOutboundWebhookAction,
} from "./actions";
import { Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import {
  ApiHttpError,
  getOutboundWebhookDeliveries,
  getOutboundWebhookEndpoints,
} from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";

export const dynamic = "force-dynamic";

interface WebhookAdminPageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

const EVENT_LABELS: Record<string, string> = {
  import_completed: "Import completed",
  import_failed: "Import failed",
  publish_succeeded: "Publish succeeded",
  publish_failed: "Publish failed",
  approval_decision: "Approval decision",
};

function StatusBanner({ tone, message }: { tone: "success" | "error" | "info"; message: string }) {
  const classes =
    tone === "success"
      ? "border-emerald-200 bg-emerald-50 text-emerald-800"
      : tone === "error"
        ? "border-rose-200 bg-rose-50 text-rose-800"
        : "border-sky-200 bg-sky-50 text-sky-800";
  return <div className={`rounded-md border px-3 py-2 text-sm ${classes}`}>{message}</div>;
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

export default async function WebhookAdminPage({ searchParams }: WebhookAdminPageProps) {
  const query = await searchParams;
  const role = await getServerActorRole();
  const authHeader = await getServerAuthHeader();
  const status = String(query.status ?? "").trim();

  try {
    const [endpoints, deliveries] = await Promise.all([
      getOutboundWebhookEndpoints({ role, authHeader }),
      getOutboundWebhookDeliveries({ limit: 20 }, { role, authHeader }),
    ]);

    return (
      <div className="space-y-5">
        <PageHeader
          title="Outbound Webhooks"
          description="Send TEJ PIM notification events to tenant-managed HTTP endpoints."
          breadcrumb={
            <>
              Dashboard / Admin / <span className="font-semibold text-slate-700">Outbound Webhooks</span>
            </>
          }
        />

        {status === "webhook-created" ? <StatusBanner tone="success" message="Webhook endpoint created." /> : null}
        {status === "webhook-paused" ? <StatusBanner tone="info" message="Webhook endpoint paused." /> : null}
        {status === "webhook-resumed" ? <StatusBanner tone="success" message="Webhook endpoint resumed." /> : null}
        {status === "webhook-test-queued" ? <StatusBanner tone="success" message="Webhook test delivery queued." /> : null}
        {status === "webhook-deleted" ? <StatusBanner tone="success" message="Webhook endpoint deleted." /> : null}

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
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-slate-600">Event</span>
                <select name="eventType" required className="w-full rounded-md border border-slate-200 px-3 py-2">
                  {Object.entries(EVENT_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-slate-600">Target URL</span>
                <input
                  type="url"
                  name="targetUrl"
                  required
                  className="w-full rounded-md border border-slate-200 px-3 py-2"
                  placeholder="https://example.com/webhooks/tej-pim"
                />
              </label>
              <label className="space-y-1 text-sm">
                <span className="text-slate-600">Signing secret</span>
                <input
                  type="password"
                  name="signingSecret"
                  required
                  className="w-full rounded-md border border-slate-200 px-3 py-2"
                  placeholder="minimum 16 characters"
                />
              </label>
              <div className="md:col-span-2 xl:col-span-4 flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                <span>
                  TEJ PIM signs each delivery with <code>x-pim1-webhook-signature</code> using HMAC SHA-256 over
                  <code>{" timestamp.body"}</code>.
                </span>
                <button type="submit" className="rounded-md bg-slate-900 px-4 py-2 font-medium text-white">
                  Create webhook
                </button>
              </div>
            </form>
          </Card>
        ) : null}

        <Card>
          <CardTitle>Configured Endpoints</CardTitle>
          {endpoints.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">No outbound webhook endpoints configured for this tenant.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2">Name</th>
                    <th className="py-2">Event</th>
                    <th className="py-2">Target</th>
                    <th className="py-2">Status</th>
                    <th className="py-2">Last triggered</th>
                    <th className="py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {endpoints.map((endpoint) => (
                    <tr key={endpoint.id} className="border-t border-slate-200 align-top">
                      <td className="py-2 font-medium text-slate-900">
                        <div>{endpoint.name}</div>
                        <div className="text-xs text-slate-500">Created by {endpoint.createdBy || "system"}</div>
                      </td>
                      <td className="py-2">{EVENT_LABELS[endpoint.eventType] ?? endpoint.eventType}</td>
                      <td className="py-2 text-xs text-slate-600 break-all">{endpoint.targetUrl}</td>
                      <td className="py-2">
                        <StatusChip label={endpoint.isActive ? "active" : "paused"} tone={endpoint.isActive ? "success" : "neutral"} />
                      </td>
                      <td className="py-2 text-xs text-slate-600">
                        {endpoint.lastTriggeredAt ? new Date(endpoint.lastTriggeredAt).toLocaleString() : "-"}
                      </td>
                      <td className="py-2">
                        {role === "admin" ? (
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
                            <form action={deleteOutboundWebhookAction}>
                              <input type="hidden" name="endpointId" value={endpoint.id} />
                              <button type="submit" className="rounded-md border border-rose-200 px-3 py-2 text-sm text-rose-700">
                                Delete
                              </button>
                            </form>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-500">Read-only</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardTitle>Recent Deliveries</CardTitle>
          {deliveries.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">No deliveries recorded yet.</p>
          ) : (
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[960px] text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2">Endpoint</th>
                    <th className="py-2">Event</th>
                    <th className="py-2">Status</th>
                    <th className="py-2">Attempts</th>
                    <th className="py-2">Response</th>
                    <th className="py-2">Last attempt</th>
                  </tr>
                </thead>
                <tbody>
                  {deliveries.map((delivery) => (
                    <tr key={delivery.id} className="border-t border-slate-200">
                      <td className="py-2 font-medium text-slate-900">{delivery.endpointName || delivery.endpointId}</td>
                      <td className="py-2">{EVENT_LABELS[delivery.eventType] ?? delivery.eventType}</td>
                      <td className="py-2">
                        <StatusChip label={delivery.status} tone={DeliveryTone(delivery.status)} />
                      </td>
                      <td className="py-2">{delivery.attemptCount}</td>
                      <td className="py-2 text-xs text-slate-600">
                        {delivery.responseStatus ?? "-"}
                        {delivery.errorMessage ? ` - ${delivery.errorMessage}` : ""}
                      </td>
                      <td className="py-2 text-xs text-slate-600">
                        {delivery.attemptedAt ? new Date(delivery.attemptedAt).toLocaleString() : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <div className="text-sm text-slate-600">
          Looking for audit evidence? Open <Link href="/admin/audit" className="text-blue-700 hover:underline">Audit Logs</Link>.
        </div>
      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/admin/webhooks", error.status));
    }
    throw error;
  }
}

