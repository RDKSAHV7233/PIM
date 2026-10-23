import Link from "@/components/ui/app-link";
import { redirect } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import { SystemAdminRequiredCard } from "@/components/ui/system-admin-required-card";
import { ApiHttpError } from "@/lib/api";
import {
  getInternalOpsSummary,
  type InternalOpsAggregateAvailability,
  type InternalOpsCardAvailability,
  type InternalOpsReadinessMetric,
  type InternalOpsSummaryResponse,
  type InternalOpsStatusCount,
} from "@/lib/api/internal-ops";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { formatDateTime } from "@/lib/format";
import { isSystemAdminBoundary } from "@/lib/role-capabilities";
import { getServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";

const PAGE_PATH = "/internal/ops";

export default async function InternalOpsPage() {
  const { authHeader, actorRole, adminBoundaryRoles } = await getServerSession();

  if (!authHeader) {
    redirect(buildLoginRedirect(PAGE_PATH));
  }

  if (!isSystemAdminBoundary(adminBoundaryRoles)) {
    return (
      <div className="space-y-5">
        <PageHeader
          title="Internal Ops"
          breadcrumb={
            <>
              <Link href="/dashboard" className="hover:underline">Dashboard</Link>{" / "}
              <span className="font-semibold text-slate-700">Internal Ops</span>
            </>
          }
        />
        <SystemAdminRequiredCard surfaceLabel="Internal Ops" backHref="/dashboard" />
      </div>
    );
  }
  if (actorRole !== "admin") {
    redirect("/dashboard");
  }

  try {
    const summary = await getInternalOpsSummary({ authHeader });
    const degradedCount = [
      summary.jobs,
      summary.imports,
      summary.publishing,
      summary.connectors,
      summary.readiness,
      summary.errors,
      summary.mediaIntegrity,
    ].filter((card) => card.availability !== "available").length;

    return (
      <div className="space-y-5">
        <PageHeader
          title="Internal Ops"
          description="Read-only cross-tenant health summary for platform operators."
          breadcrumb={
            <>
              <Link href="/dashboard" className="hover:underline">Dashboard</Link>{" / "}
              <span className="font-semibold text-slate-700">Internal Ops</span>
            </>
          }
          actions={
            <div className="flex items-center gap-2">
              <StatusChip
                label={degradedCount === 0 ? "All cards available" : `${degradedCount} card${degradedCount === 1 ? "" : "s"} degraded`}
                tone={degradedCount === 0 ? "success" : "warning"}
              />
              <Link
                href="/internal/ops/errors"
                className="rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                Error issues
              </Link>
            </div>
          }
        />

        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <KpiCard
            label="Jobs"
            value={formatNumber(summary.jobs.active)}
            helper={`${formatNumber(summary.jobs.stuck)} stuck, ${formatNumber(summary.jobs.failed)} failed, ${formatNumber(summary.jobs.deadLetter)} DLQ`}
            tone={summary.jobs.availability === "unavailable" ? "warning" : summary.jobs.deadLetter > 0 || summary.jobs.failed > 0 ? "danger" : "default"}
          />
          <KpiCard
            label="Imports"
            value={formatNumber(summary.imports.activeRuns)}
            helper={`${formatNumber(summary.imports.failedRows)} failed rows, ${formatNumber(summary.imports.dlqRows)} DLQ rows`}
            tone={summary.imports.availability === "unavailable" ? "warning" : summary.imports.dlqRows > 0 ? "danger" : "default"}
          />
          <KpiCard
            label="Publishing"
            value={`${summary.publishing.exports.successRate.toFixed(0)}%`}
            helper={`${formatNumber(summary.publishing.exports.success)} export successes, ${formatNumber(summary.publishing.exports.failed)} failures`}
            tone={summary.publishing.availability === "unavailable" ? "warning" : summary.publishing.exports.failed > 0 ? "danger" : "success"}
          />
          <KpiCard
            label="Connectors"
            value={formatNumber(summary.connectors.totalInstallations)}
            helper={formatStatusSummary(summary.connectors.byStatus)}
            tone={summary.connectors.availability === "unavailable" ? "warning" : "default"}
          />
          <KpiCard
            label="Readiness Health"
            value={formatReadinessAvailability(summary.readiness.availability)}
            helper="Persisted operational readiness signals"
            tone={summary.readiness.availability === "unavailable" ? "warning" : summary.readiness.availability === "partial" ? "warning" : "default"}
          />
          <KpiCard
            label="Errors"
            value={formatNumber(summary.errors.p0p1OpenCount)}
            helper={summary.errors.storageAvailable ? "Open P0/P1 issues" : "Error storage unavailable"}
            href="/internal/ops/errors"
            tone={summary.errors.availability === "unavailable" ? "warning" : summary.errors.p0p1OpenCount > 0 ? "danger" : "success"}
          />
          <KpiCard
            label="Media Integrity"
            value={formatNumber(summary.mediaIntegrity.totalAssets)}
            helper={formatMediaIntegrityHelper(summary.mediaIntegrity)}
            tone={mediaIntegrityTone(summary.mediaIntegrity)}
          />
        </div>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_380px]">
          <Card className="overflow-hidden p-0">
            <div className="border-b border-slate-200 p-4">
              <CardTitle>Operational Signals</CardTitle>
              <p className="text-sm text-slate-500">
                Window {formatDateTime(summary.windows.operational.dateFrom)} to {formatDateTime(summary.windows.operational.dateTo)}
              </p>
            </div>
            <div className="grid gap-4 p-4 md:grid-cols-2">
              <SignalPanel
                title="Job Status"
                unavailable={summary.jobs.availability === "unavailable"}
                rows={[
                  { label: "Active", value: summary.jobs.active, tone: "info" },
                  { label: "Stuck", value: summary.jobs.stuck, tone: summary.jobs.stuck > 0 ? "warning" : "success" },
                  { label: "Failed", value: summary.jobs.failed, tone: summary.jobs.failed > 0 ? "danger" : "success" },
                  { label: "Dead letter", value: summary.jobs.deadLetter, tone: summary.jobs.deadLetter > 0 ? "danger" : "success" },
                ]}
              />
              <SignalPanel
                title="Import Rows"
                unavailable={summary.imports.availability === "unavailable"}
                rows={[
                  { label: "Active runs", value: summary.imports.activeRuns, tone: "info" },
                  { label: "Run failed rows", value: summary.imports.runFailedRows, tone: summary.imports.runFailedRows > 0 ? "danger" : "success" },
                  { label: "Job failed rows", value: summary.imports.jobFailedRows, tone: summary.imports.jobFailedRows > 0 ? "danger" : "success" },
                  { label: "DLQ rows", value: summary.imports.dlqRows, tone: summary.imports.dlqRows > 0 ? "danger" : "success" },
                ]}
              />
              <SignalPanel
                title="Publish Results"
                unavailable={summary.publishing.availability === "unavailable"}
                rows={[
                  { label: "Export success", value: summary.publishing.exports.success, tone: "success" },
                  { label: "Export failed", value: summary.publishing.exports.failed, tone: summary.publishing.exports.failed > 0 ? "danger" : "success" },
                  { label: "Submission success", value: summary.publishing.submissions.success, tone: "success" },
                  { label: "Submission failed", value: summary.publishing.submissions.failed, tone: summary.publishing.submissions.failed > 0 ? "danger" : "success" },
                ]}
              />
              <ReadinessPanel readiness={summary.readiness} />
              <SignalPanel
                title="Error Authority"
                unavailable={summary.errors.availability === "unavailable"}
                rows={[
                  { label: "Open P0/P1", value: summary.errors.p0p1OpenCount, tone: summary.errors.p0p1OpenCount > 0 ? "danger" : "success" },
                ]}
              />
            </div>
          </Card>

          <Card className="space-y-4">
            <div>
              <CardTitle>Inventory</CardTitle>
              <p className="text-sm text-slate-500">
                Window {formatDateTime(summary.windows.inventory.dateFrom)} to {formatDateTime(summary.windows.inventory.dateTo)}
              </p>
            </div>
            <div className="space-y-3">
              <div>
                <div className="mb-2 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-900">Connector status</h3>
                  <AvailabilityChip availability={summary.connectors.availability} />
                </div>
                {summary.connectors.byStatus.length === 0 ? (
                  <p className="text-sm text-slate-500">No connector installations in the current inventory window.</p>
                ) : (
                  <div className="space-y-2">
                    {summary.connectors.byStatus.map((row) => (
                      <div key={row.status} className="flex items-center justify-between rounded-md border border-slate-200 px-3 py-2">
                        <span className="text-sm font-medium capitalize text-slate-700">{row.status.replace(/_/g, " ")}</span>
                        <span className="text-sm tabular-nums text-slate-900">{formatNumber(row.count)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="rounded-md border border-slate-200 px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium text-slate-700">Media assets</span>
                  <span className="text-sm tabular-nums text-slate-900">{formatNumber(summary.mediaIntegrity.totalAssets)}</span>
                </div>
                {summary.mediaIntegrity.latestRun ? (
                  <dl className="mt-2 grid gap-2 text-xs text-slate-600">
                    <div className="flex items-center justify-between gap-3">
                      <dt>Latest scan</dt>
                      <dd className="font-semibold capitalize text-slate-900">{summary.mediaIntegrity.latestRun.status}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt>Rows checked</dt>
                      <dd className="font-semibold tabular-nums text-slate-900">
                        {formatNumber(summary.mediaIntegrity.latestRun.rowsExamined)}
                        {summary.mediaIntegrity.latestRun.rowsEligible !== null ? ` / ${formatNumber(summary.mediaIntegrity.latestRun.rowsEligible)}` : ""}
                      </dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt>Defects</dt>
                      <dd className="font-semibold tabular-nums text-slate-900">{formatNumber(mediaIntegrityDefectCount(summary.mediaIntegrity.latestRun))}</dd>
                    </div>
                    <div className="flex items-center justify-between gap-3">
                      <dt>Completed</dt>
                      <dd className="font-semibold text-slate-900">
                        {summary.mediaIntegrity.latestRun.completedAt ? formatDateTime(summary.mediaIntegrity.latestRun.completedAt) : "Running"}
                      </dd>
                    </div>
                  </dl>
                ) : (
                  <p className="mt-1 text-xs text-slate-500">No scan run recorded yet.</p>
                )}
                <p className="mt-2 text-xs text-slate-500">Object-to-DB orphan enumeration remains deferred.</p>
              </div>
              <p className="text-xs text-slate-500">
                As of {formatDateTime(summary.asOf)}. Query timeout {summary.windows.queryTimeoutMs}ms.
              </p>
            </div>
          </Card>
        </div>
      </div>
    );
  } catch (error) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect(PAGE_PATH, error));
    }
    throw error;
  }
}

type SignalTone = "neutral" | "success" | "warning" | "danger" | "info";

function SignalPanel({
  title,
  unavailable,
  rows,
}: {
  title: string;
  unavailable: boolean;
  rows: Array<{ label: string; value: number; tone: SignalTone }>;
}) {
  return (
    <section className="rounded-md border border-slate-200 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
        <AvailabilityChip availability={unavailable ? "unavailable" : "available"} />
      </div>
      <dl className="space-y-2">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between gap-3">
            <dt className="text-sm text-slate-600">{row.label}</dt>
            <dd className="flex items-center gap-2">
              <span className="text-sm font-semibold tabular-nums text-slate-900">{formatNumber(row.value)}</span>
              <StatusChip label={row.tone === "success" ? "OK" : row.tone} tone={row.tone} />
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function ReadinessPanel({ readiness }: { readiness: InternalOpsSummaryResponse["readiness"] }) {
  const isUnavailable = readiness.availability === "unavailable";

  return (
    <section className="rounded-md border border-slate-200 p-3">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-slate-900">Readiness Health</h3>
          <p className="text-xs text-slate-500">Persisted operational readiness signals.</p>
        </div>
        <AvailabilityChip availability={readiness.availability} />
      </div>
      {isUnavailable ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          Readiness signals are temporarily unavailable.
        </p>
      ) : (
        <div className="space-y-3">
          <ReadinessSourceSection
            title="Product data"
            availability={readiness.productData.availability}
            rows={[
              { label: "Blocked products", value: readiness.productData.blockedProducts, tone: "danger" },
              { label: "Blocking issues", value: readiness.productData.blockingIssues, tone: "danger" },
              { label: "Warnings", value: readiness.productData.warningIssues, tone: "warning" },
            ]}
          />
          <ReadinessSourceSection
            title="Mappings"
            availability={readiness.mapping.availability}
            rows={[
              { label: "Blocking mappings", value: readiness.mapping.blockingMappings, tone: "danger" },
              { label: "Warnings", value: readiness.mapping.warningMappings, tone: "warning" },
            ]}
          />
          <ReadinessSourceSection
            title="Connectors"
            availability={readiness.connector.availability}
            rows={[
              { label: "Blocking installations", value: readiness.connector.blockingInstallations, tone: "danger" },
              { label: "Warnings", value: readiness.connector.warningInstallations, tone: "warning" },
              { label: "Check inconclusive", value: readiness.connector.inconclusiveInstallations, tone: "warning" },
              { label: "Configuration problem", value: readiness.connector.configurationProblemInstallations, tone: "warning" },
            ]}
          />
        </div>
      )}
      <p className="mt-3 text-xs text-slate-500">As of {formatDateTime(readiness.asOf)}</p>
    </section>
  );
}

function ReadinessSourceSection({
  title,
  availability,
  rows,
}: {
  title: string;
  availability: InternalOpsCardAvailability;
  rows: Array<{ label: string; value: InternalOpsReadinessMetric; tone: SignalTone }>;
}) {
  return (
    <div className="rounded-md border border-slate-200 px-3 py-2">
      <div className="mb-2 flex items-center justify-between gap-3">
        <h4 className="text-sm font-semibold text-slate-800">{title}</h4>
        <AvailabilityChip availability={availability} />
      </div>
      {availability === "unavailable" ? (
        <p className="text-sm text-slate-500">Signals temporarily unavailable.</p>
      ) : (
        <dl className="space-y-2">
          {rows.map((row) => (
            <div key={row.label} className="flex items-center justify-between gap-3">
              <dt className="text-sm text-slate-600">{row.label}</dt>
              <dd className="flex items-center gap-2">
                <span className="text-sm font-semibold tabular-nums text-slate-900">{formatMetric(row.value)}</span>
                <StatusChip label={row.tone === "danger" ? "Blocker" : "Warning"} tone={row.tone} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

function AvailabilityChip({ availability }: { availability: InternalOpsAggregateAvailability }) {
  return (
    <StatusChip
      label={formatReadinessAvailability(availability)}
      tone={availability === "available" ? "success" : "warning"}
    />
  );
}

function formatMetric(value: InternalOpsReadinessMetric) {
  return value === null ? "Unavailable" : formatNumber(value);
}

function formatReadinessAvailability(availability: InternalOpsAggregateAvailability) {
  if (availability === "partial") {
    return "Partial";
  }
  return availability === "available" ? "Available" : "Unavailable";
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("en-IN").format(value);
}

function formatStatusSummary(rows: InternalOpsStatusCount[]) {
  if (rows.length === 0) {
    return "No recent installations";
  }
  return rows
    .map((row) => `${row.status.replace(/_/g, " ")} ${formatNumber(row.count)}`)
    .join(", ");
}

function formatMediaIntegrityHelper(mediaIntegrity: InternalOpsSummaryResponse["mediaIntegrity"]) {
  if (mediaIntegrity.availability === "unavailable") {
    return "Summary source unavailable";
  }
  if (!mediaIntegrity.latestRun) {
    return "No scan run recorded";
  }
  const defects = mediaIntegrityDefectCount(mediaIntegrity.latestRun);
  const coverage = mediaIntegrity.latestRun.coverageComplete ? "complete" : "partial";
  return `${formatNumber(defects)} defect${defects === 1 ? "" : "s"}, ${coverage} coverage`;
}

function mediaIntegrityTone(mediaIntegrity: InternalOpsSummaryResponse["mediaIntegrity"]): "default" | "success" | "warning" | "danger" {
  if (mediaIntegrity.availability === "unavailable") {
    return "warning";
  }
  if (!mediaIntegrity.latestRun) {
    return "default";
  }
  const defects = mediaIntegrityDefectCount(mediaIntegrity.latestRun);
  if (defects > 0) {
    return "danger";
  }
  return mediaIntegrity.latestRun.coverageComplete ? "success" : "warning";
}

function mediaIntegrityDefectCount(latestRun: NonNullable<InternalOpsSummaryResponse["mediaIntegrity"]["latestRun"]>) {
  return (
    latestRun.totals.missing +
    latestRun.totals.invalidPath +
    latestRun.totals.unverifiable +
    latestRun.totals.storageErrors
  );
}
