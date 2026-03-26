import Link from "next/link";
import { redirect } from "next/navigation";
import { setPlanTierAction } from "@/app/actions";
import { Card, CardTitle } from "@/components/ui/card";
import { ApiHttpError, getBillingUsage, getKpiTrends } from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";

export const dynamic = "force-dynamic";

interface PlanPageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

const SIGNUP_TREND_WINDOWS = [7, 30, 90] as const;

function percent(current: number, limit: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(limit) || limit <= 0) {
    return 0;
  }
  return Math.min(999, Math.round((current / limit) * 100));
}

function sumTrendValues(points: Array<{ value: number }>): number {
  return points.reduce((sum, point) => sum + (Number.isFinite(point.value) ? point.value : 0), 0);
}

function latestTrendValue(points: Array<{ value: number }>): number {
  for (let index = points.length - 1; index >= 0; index -= 1) {
    const value = points[index]?.value;
    if (Number.isFinite(value)) {
      return Number(value);
    }
  }
  return 0;
}

function formatHours(value: number): string {
  if (!Number.isFinite(value)) {
    return "-";
  }
  if (value === 0) {
    return "0h";
  }
  return `${value.toFixed(value >= 10 ? 0 : 1)}h`;
}

function formatTrendDayLabel(value: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function resolveSignupTrendDays(input: string | undefined): (typeof SIGNUP_TREND_WINDOWS)[number] {
  const parsed = Number.parseInt(String(input ?? ""), 10);
  return SIGNUP_TREND_WINDOWS.includes(parsed as (typeof SIGNUP_TREND_WINDOWS)[number])
    ? (parsed as (typeof SIGNUP_TREND_WINDOWS)[number])
    : 30;
}

function buildSignupTrendRows(signupTrends: NonNullable<Awaited<ReturnType<typeof getKpiTrends>>>) {
  const rows = new Map();
  for (const point of signupTrends.signupRequests) {
    rows.set(point.date, {
      date: point.date,
      requests: point.value,
      verifications: 0,
      verificationRate: 0,
      medianVerifyHours: null as number | null,
    });
  }
  for (const point of signupTrends.signupVerifications) {
    const existing = rows.get(point.date) ?? {
      date: point.date,
      requests: 0,
      verifications: 0,
      verificationRate: 0,
      medianVerifyHours: null as number | null,
    };
    existing.verifications = point.value;
    rows.set(point.date, existing);
  }
  for (const point of signupTrends.signupVerificationRate) {
    const existing = rows.get(point.date) ?? {
      date: point.date,
      requests: 0,
      verifications: 0,
      verificationRate: 0,
      medianVerifyHours: null as number | null,
    };
    existing.verificationRate = point.value;
    rows.set(point.date, existing);
  }
  for (const point of signupTrends.signupMedianTimeToVerifyHours) {
    const existing = rows.get(point.date) ?? {
      date: point.date,
      requests: 0,
      verifications: 0,
      verificationRate: 0,
      medianVerifyHours: null as number | null,
    };
    existing.medianVerifyHours = point.value;
    rows.set(point.date, existing);
  }
  return Array.from(rows.values()).sort((left, right) => right.date.localeCompare(left.date));
}

function buildSignupTrendChartRows(rows: ReturnType<typeof buildSignupTrendRows>) {
  const chartRows = rows.slice(0, 10).reverse();
  const maxValue = Math.max(
    1,
    ...chartRows.map((row) => Math.max(Number(row.requests) || 0, Number(row.verifications) || 0)),
  );
  return chartRows.map((row) => ({
    ...row,
    requestHeight: row.requests > 0 ? Math.max(8, Math.round((row.requests / maxValue) * 96)) : 0,
    verificationHeight:
      row.verifications > 0 ? Math.max(8, Math.round((row.verifications / maxValue) * 96)) : 0,
    shortLabel: formatTrendDayLabel(row.date),
  }));
}

function pickTrendHighlight<T extends ReturnType<typeof buildSignupTrendRows>[number]>(
  rows: T[],
  score: (row: T) => number | null,
) {
  let best: T | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    const currentScore = score(row);
    if (currentScore == null || !Number.isFinite(currentScore)) {
      continue;
    }
    if (currentScore > bestScore) {
      best = row;
      bestScore = currentScore;
    }
  }
  return best;
}

function resolveSignupHealthAlert({
  rangeDays,
  requests,
  verifications,
  verificationRate,
  medianVerifyHours,
}: {
  rangeDays: number;
  requests: number;
  verifications: number;
  verificationRate: number;
  medianVerifyHours: number;
}) {
  const pending = Math.max(requests - verifications, 0);
  if (requests < 3) {
    return null;
  }
  if (verificationRate < 40) {
    return {
      tone: "border-red-200 bg-red-50 text-red-900",
      title: "Verification rate needs attention",
      body: `${pending} teams are still unverified in the last ${rangeDays} days. Check email delivery and the verification path before rollout friction compounds.`,
    };
  }
  if (medianVerifyHours >= 24) {
    return {
      tone: "border-amber-200 bg-amber-50 text-amber-900",
      title: "Verification is slowing down",
      body: `Median verification time is ${formatHours(medianVerifyHours)} in the last ${rangeDays} days. Review the onboarding email and any support touchpoints causing delay.`,
    };
  }
  return {
    tone: "border-emerald-200 bg-emerald-50 text-emerald-900",
    title: "Signup conversion looks healthy",
    body: `${verifications} of ${requests} signup requests verified in the last ${rangeDays} days. Keep an eye on the daily chart for any sudden drop.`,
  };
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
  const signupTrendDays = resolveSignupTrendDays(query.days);
  let usage: Awaited<ReturnType<typeof getBillingUsage>>;
  let signupTrends: Awaited<ReturnType<typeof getKpiTrends>> | null = null;
  try {
    [usage, signupTrends] = await Promise.all([
      getBillingUsage({ role, authHeader }),
      role === "admin"
        ? getKpiTrends({ days: signupTrendDays }, { role, authHeader })
        : Promise.resolve(null),
    ]);
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/admin/plan", error.status));
    }
    throw error;
  }
  const status = String(query.status ?? "").trim();
  const signupRequests = signupTrends ? Math.round(sumTrendValues(signupTrends.signupRequests)) : 0;
  const signupVerifications = signupTrends
    ? Math.round(sumTrendValues(signupTrends.signupVerifications))
    : 0;
  const signupPendingBacklog = Math.max(signupRequests - signupVerifications, 0);
  const signupVerificationRate = signupTrends
    ? latestTrendValue(signupTrends.signupVerificationRate)
    : 0;
  const signupMedianVerifyHours = signupTrends
    ? latestTrendValue(signupTrends.signupMedianTimeToVerifyHours)
    : 0;
  const allSignupTrendRows = signupTrends ? buildSignupTrendRows(signupTrends) : [];
  const signupTrendRows = allSignupTrendRows.slice(0, 10);
  const signupTrendChartRows = buildSignupTrendChartRows(allSignupTrendRows);
  const strongestSignupDay = pickTrendHighlight(allSignupTrendRows, (row) => row.requests);
  const bestVerificationDay = pickTrendHighlight(allSignupTrendRows, (row) =>
    row.requests > 0 ? row.verificationRate : null,
  );
  const slowestVerificationDay = pickTrendHighlight(allSignupTrendRows, (row) => row.medianVerifyHours);
  const signupHealthAlert = signupTrends
    ? resolveSignupHealthAlert({
        rangeDays: signupTrends.rangeDays,
        requests: signupRequests,
        verifications: signupVerifications,
        verificationRate: signupVerificationRate,
        medianVerifyHours: signupMedianVerifyHours,
      })
    : null;
  const signupExportHref = `/api/admin/plan/signup-trends/export?days=${signupTrendDays}`;

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 text-sm text-slate-600">
        <Link href="/dashboard" className="underline">
          Dashboard
        </Link>
        <span>/</span>
        <Link href="/admin" className="underline">
          Admin
        </Link>
        <span>/</span>
        <span>Plan &amp; Usage</span>
      </div>
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
      {role === "admin" && signupTrends ? (
        <div id="signup-conversion">
          <Card>
            <CardTitle>Self-Serve Signup Conversion</CardTitle>
            <p className="text-sm text-slate-600">
              Track how many teams started signup, how many verified, and how quickly they finished
              onboarding in the last {signupTrends.rangeDays} days.
            </p>
            {signupHealthAlert ? (
              <div className={`mt-4 rounded-md border px-3 py-3 text-sm ${signupHealthAlert.tone}`}>
                <div className="font-semibold">{signupHealthAlert.title}</div>
                <div className="mt-1">{signupHealthAlert.body}</div>
              </div>
            ) : null}
            <div
              className={`mt-4 rounded-md border px-3 py-3 text-sm ${
                signupPendingBacklog > 0
                  ? "border-sky-200 bg-sky-50 text-sky-900"
                  : "border-slate-200 bg-slate-50 text-slate-700"
              }`}
            >
              <div className="font-semibold">Pending Verification Backlog</div>
              <div className="mt-1">
                {signupRequests === 0
                  ? "No signup requests recorded in this window yet."
                  : signupPendingBacklog > 0
                    ? `${signupPendingBacklog} signup requests in the last ${signupTrends.rangeDays} days still need email verification. Use the chart and table below to spot the slowest days.`
                    : `Every signup request in the last ${signupTrends.rangeDays} days has verified.`}
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {SIGNUP_TREND_WINDOWS.map((days) => {
                const active = signupTrends.rangeDays === days;
                return (
                  <Link
                    key={days}
                    href={`/admin/plan?days=${days}`}
                    className={`rounded-md border px-3 py-2 text-sm font-medium ${
                      active
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-200 text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    Last {days} days
                  </Link>
                );
              })}
              <a
                href={signupExportHref}
                className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Export CSV
              </a>
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-md border border-slate-200 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Workspace Signups
                </div>
                <div className="mt-2 text-2xl font-semibold text-slate-900">{signupRequests}</div>
                <div className="mt-1 text-xs text-slate-500">Signup requests created</div>
              </div>
              <div className="rounded-md border border-emerald-200 bg-emerald-50/60 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Verified Workspaces
                </div>
                <div className="mt-2 text-2xl font-semibold text-slate-900">{signupVerifications}</div>
                <div className="mt-1 text-xs text-slate-500">
                  {signupPendingBacklog} still pending or unverified
                </div>
              </div>
              <div className="rounded-md border border-blue-200 bg-blue-50/60 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Verification Rate
                </div>
                <div className="mt-2 text-2xl font-semibold text-slate-900">
                  {Math.max(0, Math.min(100, Math.round(signupVerificationRate)))}%
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {signupVerifications} of {signupRequests} signups completed
                </div>
              </div>
              <div className="rounded-md border border-amber-200 bg-amber-50/60 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Median Verify Time
                </div>
                <div className="mt-2 text-2xl font-semibold text-slate-900">
                  {formatHours(signupMedianVerifyHours)}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  Latest daily median from request to verification
                </div>
              </div>
            </div>
            <div className="mt-4 text-sm text-slate-600">
              Watch these alongside the dashboard signup funnel to spot stalls before they turn into
              support issues.
            </div>
            <div className="mt-4 rounded-md border border-slate-200 bg-slate-50/70 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-slate-900">Daily Trend At A Glance</h3>
                  <p className="text-xs text-slate-500">
                    Signups are shown in slate. Verified workspaces are shown in green.
                  </p>
                </div>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-slate-400" />
                    Signups
                  </span>
                  <span className="inline-flex items-center gap-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                    Verified
                  </span>
                </div>
              </div>
              {signupTrendChartRows.length === 0 ? (
                <div className="mt-4 text-sm text-slate-500">No signup activity to chart yet.</div>
              ) : (
                <div className="mt-4 flex min-h-40 items-end gap-3 overflow-x-auto pb-1">
                  {signupTrendChartRows.map((row) => (
                    <div key={row.date} className="min-w-[54px] text-center">
                      <div className="mx-auto flex h-28 items-end justify-center gap-1.5">
                        <div className="flex flex-col items-center gap-1">
                          <div className="text-[10px] text-slate-500">{Math.round(row.requests)}</div>
                          <div
                            aria-label={`${row.date} signups`}
                            className="w-4 rounded-t bg-slate-400"
                            style={{ height: `${row.requestHeight}px` }}
                          />
                        </div>
                        <div className="flex flex-col items-center gap-1">
                          <div className="text-[10px] text-slate-500">
                            {Math.round(row.verifications)}
                          </div>
                          <div
                            aria-label={`${row.date} verified workspaces`}
                            className="w-4 rounded-t bg-emerald-500"
                            style={{ height: `${row.verificationHeight}px` }}
                          />
                        </div>
                      </div>
                      <div className="mt-2 text-[11px] font-medium text-slate-600">{row.shortLabel}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="mt-4 grid gap-3 lg:grid-cols-3">
              <div className="rounded-md border border-slate-200 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Strongest Signup Day
                </div>
                <div className="mt-2 text-lg font-semibold text-slate-900">
                  {strongestSignupDay ? formatTrendDayLabel(strongestSignupDay.date) : "No data yet"}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {strongestSignupDay
                    ? `${Math.round(strongestSignupDay.requests)} signup requests recorded`
                    : "We will highlight the busiest signup day once activity arrives."}
                </div>
              </div>
              <div className="rounded-md border border-emerald-200 bg-emerald-50/60 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Best Verification Day
                </div>
                <div className="mt-2 text-lg font-semibold text-slate-900">
                  {bestVerificationDay ? formatTrendDayLabel(bestVerificationDay.date) : "No data yet"}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {bestVerificationDay
                    ? `${Math.max(0, Math.min(100, Math.round(bestVerificationDay.verificationRate)))}% of signups verified`
                    : "We will highlight the strongest conversion day once teams start verifying."}
                </div>
              </div>
              <div className="rounded-md border border-amber-200 bg-amber-50/60 p-3">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Slowest Verification Day
                </div>
                <div className="mt-2 text-lg font-semibold text-slate-900">
                  {slowestVerificationDay ? formatTrendDayLabel(slowestVerificationDay.date) : "No data yet"}
                </div>
                <div className="mt-1 text-xs text-slate-500">
                  {slowestVerificationDay
                    ? `${formatHours(slowestVerificationDay.medianVerifyHours ?? 0)} median time to verify`
                    : "We will highlight the slowest day once verification timing data is available."}
                </div>
              </div>
            </div>
            <div className="mt-4 overflow-x-auto rounded-md border border-slate-200">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Signups</th>
                    <th className="px-3 py-2">Verified</th>
                    <th className="px-3 py-2">Rate</th>
                    <th className="px-3 py-2">Median Verify Time</th>
                  </tr>
                </thead>
                <tbody>
                  {signupTrendRows.length === 0 ? (
                    <tr className="border-t border-slate-200">
                      <td className="px-3 py-3 text-slate-600" colSpan={5}>
                        No signup activity recorded for this window yet.
                      </td>
                    </tr>
                  ) : (
                    signupTrendRows.map((row) => (
                      <tr key={row.date} className="border-t border-slate-200">
                        <td className="px-3 py-2.5 text-slate-700">{row.date}</td>
                        <td className="px-3 py-2.5 font-medium text-slate-900">
                          {Math.round(row.requests)}
                        </td>
                        <td className="px-3 py-2.5 font-medium text-slate-900">
                          {Math.round(row.verifications)}
                        </td>
                        <td className="px-3 py-2.5 text-slate-700">
                          {Math.max(0, Math.min(100, Math.round(row.verificationRate)))}%
                        </td>
                        <td className="px-3 py-2.5 text-slate-700">
                          {row.medianVerifyHours == null ? "-" : formatHours(row.medianVerifyHours)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      ) : null}
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
