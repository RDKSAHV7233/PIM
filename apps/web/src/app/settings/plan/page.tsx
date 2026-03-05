import Link from "next/link";
import { redirect } from "next/navigation";
import { setPlanTierAction } from "@/app/actions";
import { Card, CardTitle } from "@/components/ui/card";
import { ApiHttpError, getBillingUsage } from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";

export const dynamic = "force-dynamic";

interface PlanPageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

function percent(current: number, limit: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(limit) || limit <= 0) {
    return 0;
  }
  return Math.min(999, Math.round((current / limit) * 100));
}

function Meter({
  label,
  current,
  limit,
}: {
  label: string;
  current: number;
  limit: number;
}) {
  const p = percent(current, limit);
  return (
    <div className="space-y-1 rounded-md border border-slate-200 p-3">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-slate-800">{label}</span>
        <span className="text-slate-600">
          {current} / {limit}
        </span>
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

export default async function PlanPage({ searchParams }: PlanPageProps) {
  const query = await searchParams;
  const role = await getServerActorRole();
  const authHeader = await getServerAuthHeader();
  let usage: Awaited<ReturnType<typeof getBillingUsage>>;
  try {
    usage = await getBillingUsage({ role, authHeader });
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/settings/plan", error.status));
    }
    throw error;
  }
  const status = String(query.status ?? "").trim();

  return (
    <div className="space-y-5">
      <Link href="/" className="text-sm">
        Back to dashboard
      </Link>
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Plan and Usage</h1>
        <p className="text-sm text-slate-600">
          Plan: {usage.planTier} | Billing month: {usage.month} | Resets on{" "}
          {new Date(usage.billingCycleResetAt).toLocaleDateString()}
        </p>
      </header>
      {status === "plan-updated" ? (
        <div className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          Plan tier updated successfully.
        </div>
      ) : null}
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
      {role === "admin" ? (
        <Card>
          <CardTitle>Plan management</CardTitle>
          <form action={setPlanTierAction} className="mt-3 flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label htmlFor="plan-tier" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                Plan Tier
              </label>
              <select
                id="plan-tier"
                name="planTier"
                defaultValue={usage.planTier}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm"
              >
                <option value="STARTER">STARTER</option>
                <option value="GROWTH">GROWTH</option>
                <option value="ENTERPRISE">ENTERPRISE</option>
              </select>
            </div>
            <button
              type="submit"
              className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white"
            >
              Update plan
            </button>
          </form>
        </Card>
      ) : null}
    </div>
  );
}
