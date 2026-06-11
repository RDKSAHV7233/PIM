import { Card, CardTitle } from "@/components/ui/card";
import type { PlanUsageResponse } from "@/lib/api/core";

function percent(current: number, limit: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(limit) || limit <= 0) return 0;
  return Math.min(999, Math.round((current / limit) * 100));
}

function Meter({ label, current, limit }: { label: string; current: number; limit: number }) {
  const p = percent(current, limit);
  const isWarning = p >= 80 && p < 100;
  const isExceeded = p >= 100;

  return (
    <div className={`space-y-1 rounded-md border p-3 ${
      isExceeded ? "border-red-200 bg-red-50/50" :
      isWarning ? "border-amber-200 bg-amber-50/30" :
      "border-slate-200"
    }`}>
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-slate-800">{label}</span>
        <span className={isExceeded ? "font-semibold text-red-700" : isWarning ? "font-semibold text-amber-700" : "text-slate-600"}>
          {current} / {limit}
        </span>
      </div>
      <div className="h-2 rounded bg-slate-100">
        <div
          className={`h-2 rounded ${isExceeded ? "bg-red-500" : isWarning ? "bg-amber-500" : "bg-emerald-500"}`}
          style={{ width: `${Math.min(100, p)}%` }}
        />
      </div>
      <div className="flex items-center justify-between">
        <span className="text-xs text-slate-500">{p}% used</span>
        {isExceeded ? (
          <span className="text-xs font-medium text-red-700">Limit reached</span>
        ) : isWarning ? (
          <span className="text-xs font-medium text-amber-700">Approaching limit</span>
        ) : null}
      </div>
    </div>
  );
}

interface UsageMetersProps {
  usage: PlanUsageResponse;
}

function getUsageAlerts(usage: PlanUsageResponse): string[] {
  const alerts: string[] = [];
  const check = (label: string, current: number, limit: number) => {
    const p = percent(current, limit);
    if (p >= 100) alerts.push(`${label} limit reached (${current}/${limit}). Upgrade your plan to continue.`);
    else if (p >= 80) alerts.push(`${label} is at ${p}% (${current}/${limit}). Consider upgrading soon.`);
  };
  check("SKUs", usage.skus.current, usage.skus.limit);
  check("Submissions", usage.submissions.current, usage.submissions.limit);
  check("Users", usage.users.current, usage.users.limit);
  check("Storage", Number(usage.storageGb.current.toFixed(2)), usage.storageGb.limit);
  check("Connector Installations", usage.connectorsInstallations.current, usage.connectorsInstallations.limit);
  check("Accounts Per Connector", usage.connectorAccounts.current, usage.connectorAccounts.limit);
  if (usage.apiKeys?.limit > 0) check("API Keys", usage.apiKeys.current, usage.apiKeys.limit);
  if (usage.outboundWebhooks?.limit > 0) check("Outbound Webhooks", usage.outboundWebhooks.current, usage.outboundWebhooks.limit);
  return alerts;
}

export function UsageMeters({ usage }: UsageMetersProps) {
  const alerts = getUsageAlerts(usage);

  return (
    <Card>
      <CardTitle>Usage meters</CardTitle>
      {alerts.length > 0 ? (
        <div className="mb-3 space-y-2">
          {alerts.map((alert) => (
            <div
              key={alert}
              className={`rounded-md px-3 py-2 text-sm ${
                alert.includes("reached")
                  ? "border border-red-200 bg-red-50 text-red-900"
                  : "border border-amber-200 bg-amber-50 text-amber-900"
              }`}
            >
              {alert.includes("reached") ? (
                <span className="mr-1 font-semibold">Limit reached:</span>
              ) : (
                <span className="mr-1 font-semibold">Warning:</span>
              )}
              {alert}
            </div>
          ))}
        </div>
      ) : null}
      <div className="grid gap-3 md:grid-cols-2">
        <Meter label="SKUs" current={usage.skus.current} limit={usage.skus.limit} />
        <Meter label="Submissions" current={usage.submissions.current} limit={usage.submissions.limit} />
        <Meter
          label="Storage (GB)"
          current={Number(usage.storageGb.current.toFixed(2))}
          limit={usage.storageGb.limit}
        />
        <Meter label="Users" current={usage.users.current} limit={usage.users.limit} />
        <Meter
          label="Connector Installations"
          current={usage.connectorsInstallations.current}
          limit={usage.connectorsInstallations.limit}
        />
        <Meter
          label="Accounts Per Connector"
          current={usage.connectorAccounts.current}
          limit={usage.connectorAccounts.limit}
        />
        {usage.apiKeys?.limit > 0 && (
          <Meter label="API Keys" current={usage.apiKeys.current} limit={usage.apiKeys.limit} />
        )}
        {usage.outboundWebhooks?.limit > 0 && (
          <Meter label="Outbound Webhooks" current={usage.outboundWebhooks.current} limit={usage.outboundWebhooks.limit} />
        )}
        {usage.importRowsPerJob?.limit > 0 && (
          <div className="space-y-1 rounded-md border border-slate-200 p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium text-slate-800">Import Rows / Job</span>
              <span className="text-slate-600">{usage.importRowsPerJob.limit.toLocaleString()}</span>
            </div>
            <p className="text-xs text-slate-500">Maximum rows per import job</p>
          </div>
        )}
      </div>
    </Card>
  );
}
