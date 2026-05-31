import { Card, CardTitle } from "@/components/ui/card";
import type { PlanUsageResponse } from "@/lib/api/core";

function percent(current: number, limit: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(limit) || limit <= 0) return 0;
  return Math.min(999, Math.round((current / limit) * 100));
}

function Meter({ label, current, limit }: { label: string; current: number; limit: number }) {
  const p = percent(current, limit);
  return (
    <div className="space-y-1 rounded-md border border-slate-200 p-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-slate-800">{label}</span>
        <span className="text-slate-600">{current} / {limit}</span>
      </div>
      <div className="h-2 rounded bg-slate-100">
        <div
          className={`h-2 rounded ${p >= 100 ? "bg-red-500" : p >= 80 ? "bg-amber-500" : "bg-emerald-500"}`}
          style={{ width: `${Math.min(100, p)}%` }}
        />
      </div>
      <div className="text-xs text-slate-500">{p}% used</div>
    </div>
  );
}

interface UsageMetersProps {
  usage: PlanUsageResponse;
}

export function UsageMeters({ usage }: UsageMetersProps) {
  return (
    <Card>
      <CardTitle>Usage meters</CardTitle>
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
      </div>
    </Card>
  );
}
