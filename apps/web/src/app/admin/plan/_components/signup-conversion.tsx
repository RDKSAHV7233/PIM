import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import { DataGrid, type Column } from "@/components/ui/data-grid";
import type { getKpiTrends } from "@/lib/api";

const SIGNUP_TREND_WINDOWS = [7, 30, 90] as const;

function formatHours(value: number): string {
  if (!Number.isFinite(value)) return "-";
  if (value === 0) return "0h";
  return `${value.toFixed(value >= 10 ? 0 : 1)}h`;
}

function formatTrendDayLabel(value: string): string {
  return new Date(`${value}T00:00:00Z`).toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

type SignupTrends = NonNullable<Awaited<ReturnType<typeof getKpiTrends>>>;

function buildSignupTrendRows(signupTrends: SignupTrends) {
  const rows = new Map<string, {
    date: string;
    requests: number;
    verifications: number;
    verificationRate: number;
    medianVerifyHours: number | null;
    pendingBacklog: number;
  }>();
  for (const point of signupTrends.signupRequests) {
    rows.set(point.date, { date: point.date, requests: point.value, verifications: 0, verificationRate: 0, medianVerifyHours: null, pendingBacklog: 0 });
  }
  for (const point of signupTrends.signupVerifications) {
    const r = rows.get(point.date) ?? { date: point.date, requests: 0, verifications: 0, verificationRate: 0, medianVerifyHours: null, pendingBacklog: 0 };
    r.verifications = point.value; rows.set(point.date, r);
  }
  for (const point of signupTrends.signupVerificationRate) {
    const r = rows.get(point.date) ?? { date: point.date, requests: 0, verifications: 0, verificationRate: 0, medianVerifyHours: null, pendingBacklog: 0 };
    r.verificationRate = point.value; rows.set(point.date, r);
  }
  for (const point of signupTrends.signupMedianTimeToVerifyHours) {
    const r = rows.get(point.date) ?? { date: point.date, requests: 0, verifications: 0, verificationRate: 0, medianVerifyHours: null, pendingBacklog: 0 };
    r.medianVerifyHours = point.value; rows.set(point.date, r);
  }
  return Array.from(rows.values())
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((row) => ({ ...row, pendingBacklog: Math.max(Number(row.requests) - Number(row.verifications), 0) }));
}

function pickTrendHighlight<T extends { date: string }>(rows: T[], score: (row: T) => number | null): T | null {
  let best: T | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const row of rows) {
    const s = score(row);
    if (s == null || !Number.isFinite(s)) continue;
    if (s > bestScore) { best = row; bestScore = s; }
  }
  return best;
}

interface SignupConversionProps {
  signupTrends: SignupTrends;
  signupRequests: number;
  signupVerifications: number;
  signupPendingBacklog: number;
  signupVerificationRate: number;
  signupMedianVerifyHours: number;
  signupHealthAlert: { tone: string; title: string; body: string } | null;
  signupExportHref: string;
}

export function SignupConversionSection({
  signupTrends,
  signupRequests,
  signupVerifications,
  signupPendingBacklog,
  signupVerificationRate,
  signupMedianVerifyHours,
  signupHealthAlert,
  signupExportHref,
}: SignupConversionProps) {
  const allRows = buildSignupTrendRows(signupTrends);
  const signupTrendRows = allRows.slice(0, 10);
  const chartRows = allRows.slice(0, 10).reverse().map((row) => {
    const maxValue = Math.max(1, ...allRows.slice(0, 10).map((r) => Math.max(Number(r.requests) || 0, Number(r.verifications) || 0)));
    return {
      ...row,
      requestHeight: row.requests > 0 ? Math.max(8, Math.round((row.requests / maxValue) * 96)) : 0,
      verificationHeight: row.verifications > 0 ? Math.max(8, Math.round((row.verifications / maxValue) * 96)) : 0,
      shortLabel: formatTrendDayLabel(row.date),
    };
  });
  const strongestSignupDay = pickTrendHighlight(allRows, (r) => r.requests);
  const highestBacklogDay = pickTrendHighlight(allRows, (r) => r.pendingBacklog > 0 ? r.pendingBacklog : null);
  const bestVerificationDay = pickTrendHighlight(allRows, (r) => r.requests > 0 ? r.verificationRate : null);
  const slowestVerificationDay = pickTrendHighlight(allRows, (r) => r.medianVerifyHours);

  const columns: Column<(typeof signupTrendRows)[number]>[] = [
    { key: "date", header: "Date", render: (row) => <span className="text-slate-700">{row.date}</span> },
    { key: "signups", header: "Signups", render: (row) => <span className="font-medium text-slate-900">{Math.round(row.requests)}</span> },
    { key: "verified", header: "Verified", render: (row) => <span className="font-medium text-slate-900">{Math.round(row.verifications)}</span> },
    {
      key: "pending",
      header: "Pending",
      render: (row) => (
        <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${row.pendingBacklog > 0 ? "bg-sky-100 text-sky-900" : "bg-slate-100 text-slate-600"}`}>
          {Math.round(row.pendingBacklog)}
        </span>
      ),
    },
    { key: "rate", header: "Rate", render: (row) => `${Math.max(0, Math.min(100, Math.round(row.verificationRate)))}%` },
    { key: "median", header: "Median Verify Time", render: (row) => formatHours(row.medianVerifyHours ?? 0) },
  ];

  return (
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
        <div className={`mt-4 rounded-md border px-3 py-3 text-sm ${signupPendingBacklog > 0 ? "border-sky-200 bg-sky-50 text-sky-900" : "border-slate-200 bg-slate-50 text-slate-700"}`}>
          <div className="font-semibold">Pending Verification Backlog</div>
          <div className="mt-1">
            {signupRequests === 0 ? "No signup requests recorded in this window yet."
              : signupPendingBacklog > 0 ? `${signupPendingBacklog} signup requests in the last ${signupTrends.rangeDays} days still need email verification.`
              : `Every signup request in the last ${signupTrends.rangeDays} days has verified.`}
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {SIGNUP_TREND_WINDOWS.map((days) => (
            <Link key={days} href={`/admin/plan?days=${days}`}
              className={`rounded-md border px-3 py-2 text-sm font-medium ${signupTrends.rangeDays === days ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-700 hover:bg-slate-50"}`}>
              Last {days} days
            </Link>
          ))}
          <a href={signupExportHref} className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">Export CSV</a>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            { label: "Workspace Signups", value: signupRequests, sub: "Signup requests created", cls: "" },
            { label: "Verified Workspaces", value: signupVerifications, sub: `${signupPendingBacklog} still pending`, cls: "border-emerald-200 bg-emerald-50/60" },
            { label: "Verification Rate", value: `${Math.max(0, Math.min(100, Math.round(signupVerificationRate)))}%`, sub: `${signupVerifications} of ${signupRequests} completed`, cls: "border-blue-200 bg-blue-50/60" },
            { label: "Median Verify Time", value: formatHours(signupMedianVerifyHours), sub: "Latest daily median", cls: "border-amber-200 bg-amber-50/60" },
          ].map(({ label, value, sub, cls }) => (
            <div key={label} className={`rounded-md border border-slate-200 p-3 ${cls}`}>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
              <div className="mt-2 text-2xl font-semibold text-slate-900">{value}</div>
              <div className="mt-1 text-xs text-slate-500">{sub}</div>
            </div>
          ))}
        </div>
        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50/70 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">Daily Trend At A Glance</h3>
              <p className="text-xs text-slate-500">Signups in slate. Verified in green.</p>
            </div>
            <div className="flex items-center gap-3 text-xs text-slate-500">
              <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-slate-400" />Signups</span>
              <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />Verified</span>
            </div>
          </div>
          {chartRows.length === 0 ? <div className="mt-4 text-sm text-slate-500">No signup activity to chart yet.</div> : (
            <div className="mt-4 grid min-h-40 grid-cols-[repeat(auto-fit,minmax(54px,1fr))] items-end gap-3">
              {chartRows.map((row) => (
                <div key={row.date} className="text-center">
                  <div className="mx-auto flex h-28 items-end justify-center gap-1.5">
                    <div className="flex flex-col items-center gap-1">
                      <div className="text-[10px] text-slate-500">{Math.round(row.requests)}</div>
                      <div aria-label={`${row.date} signups`} className="w-4 rounded-t bg-slate-400" style={{ height: `${row.requestHeight}px` }} />
                    </div>
                    <div className="flex flex-col items-center gap-1">
                      <div className="text-[10px] text-slate-500">{Math.round(row.verifications)}</div>
                      <div aria-label={`${row.date} verified workspaces`} className="w-4 rounded-t bg-emerald-500" style={{ height: `${row.verificationHeight}px` }} />
                    </div>
                  </div>
                  <div className="mt-2 text-[11px] font-medium text-slate-600">{row.shortLabel}</div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-4">
          {[
            { label: "Strongest Signup Day", day: strongestSignupDay, sub: (d: typeof strongestSignupDay) => d ? `${Math.round(d.requests)} signup requests recorded` : "Busiest signup day will appear here.", cls: "" },
            { label: "Highest Backlog Day", day: highestBacklogDay, sub: (d: typeof highestBacklogDay) => d ? `${Math.round(d.pendingBacklog)} still waiting to verify` : "Heaviest pending-verification day will appear here.", cls: "border-sky-200 bg-sky-50/60" },
            { label: "Best Verification Day", day: bestVerificationDay, sub: (d: typeof bestVerificationDay) => d ? `${Math.max(0, Math.min(100, Math.round(d.verificationRate)))}% of signups verified` : "Strongest conversion day will appear here.", cls: "border-emerald-200 bg-emerald-50/60" },
            { label: "Slowest Verification Day", day: slowestVerificationDay, sub: (d: typeof slowestVerificationDay) => d ? `${formatHours(d.medianVerifyHours ?? 0)} median time to verify` : "Slowest day will appear here.", cls: "border-amber-200 bg-amber-50/60" },
          ].map(({ label, day, sub, cls }) => (
            <div key={label} className={`rounded-md border border-slate-200 p-3 ${cls}`}>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</div>
              <div className="mt-2 text-lg font-semibold text-slate-900">{day ? formatTrendDayLabel(day.date) : "No data yet"}</div>
              <div className="mt-1 text-xs text-slate-500">{sub(day as never)}</div>
            </div>
          ))}
        </div>
        {signupTrendRows.length > 0 ? (
          <DataGrid className="mt-4" columns={columns} rows={signupTrendRows} getRowKey={(row) => row.date} />
        ) : (
          <div className="mt-4 rounded-md border border-slate-200 px-3 py-3 text-slate-600">No signup activity recorded for this window yet.</div>
        )}
      </Card>
    </div>
  );
}
