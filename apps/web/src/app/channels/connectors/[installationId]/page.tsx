import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { KpiCard } from "@/components/ui/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import {
  ApiHttpError,
  getConnectorPermissions,
  getInstalledConnectors,
  getProductList,
  getSubmissions,
} from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";

export const dynamic = "force-dynamic";

interface ChannelConnectorDetailPageProps {
  params: Promise<{ installationId: string }>;
  searchParams: Promise<{ tab?: string }>;
}

type DetailTab = "overview" | "catalog" | "issues" | "logs" | "access";

const DETAIL_TABS: Array<{ id: DetailTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "catalog", label: "Catalog" },
  { id: "issues", label: "Issues" },
  { id: "logs", label: "Logs" },
  { id: "access", label: "Access" },
];

function toItems<T>(value: T[] | { items: T[] } | null | undefined): T[] {
  if (!value) {
    return [];
  }
  if (Array.isArray(value)) {
    return value;
  }
  return Array.isArray(value.items) ? value.items : [];
}

function submissionStatusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  const normalized = status.toUpperCase();
  if (normalized === "SUCCESS") {
    return "success";
  }
  if (normalized === "PENDING" || normalized === "RETRYING") {
    return "warning";
  }
  if (normalized === "ERROR" || normalized === "REJECTED" || normalized === "SUPPRESSED") {
    return "danger";
  }
  return "neutral";
}

function installationStatusTone(status: string): "neutral" | "success" | "warning" | "danger" {
  const normalized = String(status ?? "").trim().toUpperCase();
  if (normalized === "ACTIVE") {
    return "success";
  }
  if (normalized === "CREDENTIAL_EXPIRED" || normalized === "FAILED" || normalized === "ERROR") {
    return "danger";
  }
  if (normalized === "PAUSED" || normalized === "DISABLED" || normalized === "INACTIVE") {
    return "warning";
  }
  return "neutral";
}

function formatStatusSummary(status: string): string {
  const normalized = String(status ?? "").trim().toUpperCase();
  if (normalized === "ACTIVE") {
    return "Healthy";
  }
  if (normalized === "CREDENTIAL_EXPIRED") {
    return "Credentials need attention";
  }
  if (normalized === "FAILED" || normalized === "ERROR") {
    return "Action required";
  }
  if (normalized === "PAUSED" || normalized === "DISABLED" || normalized === "INACTIVE") {
    return "Paused";
  }
  return status;
}

function describePermissionRule(permission: {
  principalType: string;
  principalId: string;
  action: string;
  accountAlias: string;
}) {
  const subject =
    permission.principalType === "role"
      ? `${permission.principalId} role holders`
      : `user ${permission.principalId}`;
  const action = permission.action === "uninstall" ? "disable" : permission.action;
  const scope = permission.accountAlias === "*" ? "all aliases" : `alias "${permission.accountAlias}"`;
  return `${subject} can ${action} this connector for ${scope}.`;
}

function summarizeSubmissionOutcome(submission: {
  status: string;
  source: string;
  channelErrors: Array<{ sellerMessage: string }>;
  externalRef: string | null;
}) {
  const firstError = submission.channelErrors[0]?.sellerMessage?.trim();
  if (firstError) {
    return firstError;
  }
  if (submission.status === "SUCCESS") {
    return submission.externalRef ? `Published as ${submission.externalRef}.` : "Completed successfully.";
  }
  if (submission.status === "PENDING" || submission.status === "RETRYING") {
    return `Waiting on ${submission.source.toLowerCase().replace(/_/g, " ")} processing.`;
  }
  if (submission.status === "SUPPRESSED") {
    return "Suppressed by connector rules or duplicate protection.";
  }
  if (submission.status === "REJECTED") {
    return "Rejected by the channel. Review the connector errors and product data.";
  }
  return "Needs operator review.";
}

function nextOperatorStep(submission: {
  status: string;
  channelErrors: Array<{ sellerMessage: string }>;
}) {
  if (submission.status === "SUCCESS") {
    return "No action needed.";
  }
  if (submission.status === "PENDING" || submission.status === "RETRYING") {
    return "Monitor the queue and connector health.";
  }
  if (submission.status === "SUPPRESSED") {
    return "Check duplicate protection or connector gating.";
  }
  if (submission.channelErrors.length > 0) {
    return "Fix the product mapping or required catalog fields, then retry.";
  }
  return "Inspect connector logs and account credentials.";
}

function buildDetailHref(installationId: string, tab: DetailTab): string {
  const params = new URLSearchParams();
  if (tab !== "overview") {
    params.set("tab", tab);
  }
  const encoded = params.toString();
  return encoded
    ? `/channels/connectors/${encodeURIComponent(installationId)}?${encoded}`
    : `/channels/connectors/${encodeURIComponent(installationId)}`;
}

function resolveTab(value: string): DetailTab {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "catalog" || normalized === "issues" || normalized === "logs" || normalized === "access") {
    return normalized;
  }
  return "overview";
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) {
    return "Not recorded";
  }
  return new Date(value).toLocaleString();
}

function catalogReadinessTone(product: {
  openValidationErrorCount?: number;
  openValidationWarningCount?: number;
  completenessScore?: number;
  status?: string;
} | undefined): "neutral" | "success" | "warning" | "danger" {
  if (!product) {
    return "neutral";
  }
  if ((product.openValidationErrorCount ?? 0) > 0) {
    return "danger";
  }
  if ((product.openValidationWarningCount ?? 0) > 0) {
    return "warning";
  }
  if ((product.completenessScore ?? 0) >= 80 || product.status === "active" || product.status === "approved") {
    return "success";
  }
  return "neutral";
}

function catalogReadinessLabel(product: {
  openValidationErrorCount?: number;
  openValidationWarningCount?: number;
  completenessScore?: number;
  status?: string;
} | undefined): string {
  if (!product) {
    return "Product lookup unavailable";
  }
  if ((product.openValidationErrorCount ?? 0) > 0) {
    return `${product.openValidationErrorCount} blocking issue${product.openValidationErrorCount === 1 ? "" : "s"}`;
  }
  if ((product.openValidationWarningCount ?? 0) > 0) {
    return `${product.openValidationWarningCount} warning${product.openValidationWarningCount === 1 ? "" : "s"}`;
  }
  if ((product.completenessScore ?? 0) > 0) {
    return `${product.completenessScore}% complete`;
  }
  return product.status ? `Catalog status: ${product.status}` : "Needs review";
}

function issueLaneLabel(submission: {
  status: string;
  channelErrors: Array<{ sellerMessage: string }>;
}): string {
  if (submission.status === "PENDING" || submission.status === "RETRYING") {
    return "Queue monitoring";
  }
  if (submission.status === "SUPPRESSED") {
    return "Connector policy";
  }
  if (submission.channelErrors.length > 0) {
    return "Catalog mapping";
  }
  return "Connector account";
}

function renderSubmissionRows(
  submissions: Array<{
    id: string;
    productId: string;
    status: string;
    channelErrors: Array<{ sellerMessage: string }>;
    source: string;
    externalRef: string | null;
    attemptNumber: number;
    submittedAt: string;
  }>,
  productsById: Map<string, { id: string; title: string; brand: string | null }>,
) {
  return submissions.map((submission) => {
    const product = productsById.get(submission.productId);
    return (
      <tr key={submission.id} className="border-t border-slate-200 hover:bg-slate-50/50">
        <td className="px-3 py-2.5">
          <Link href={`/products/${encodeURIComponent(submission.productId)}`} className="text-blue-700 hover:underline">
            {product?.title || "Open product"}
          </Link>
          <p className="mt-1 text-xs text-slate-500">
            {product?.brand ? `${product.brand} | ` : ""}
            {submission.productId}
          </p>
        </td>
        <td className="px-3 py-2.5">
          <StatusChip label={submission.status} tone={submissionStatusTone(submission.status)} />
        </td>
        <td className="px-3 py-2.5 text-sm text-slate-700">
          <p>{summarizeSubmissionOutcome(submission)}</p>
          <p className="mt-1 text-xs text-slate-500">{nextOperatorStep(submission)}</p>
        </td>
        <td className="px-3 py-2.5">{submission.attemptNumber}</td>
        <td className="px-3 py-2.5 text-xs text-slate-600">{new Date(submission.submittedAt).toLocaleString()}</td>
      </tr>
    );
  });
}

export default async function ChannelConnectorDetailPage({
  params,
  searchParams,
}: ChannelConnectorDetailPageProps) {
  const { installationId } = await params;
  const query = await searchParams;
  const authHeader = await getServerAuthHeader();
  const actorRole = await getServerActorRole();
  const selectedTab = resolveTab(String(query.tab ?? ""));
  const detailReturnPath = buildDetailHref(installationId, selectedTab);

  try {
    const installations = await getInstalledConnectors({ role: actorRole, authHeader });
    const installation = installations.find((item) => item.id === installationId);
    if (!installation) {
      notFound();
    }

    const [permissions, submissionsRaw, products] = await Promise.all([
      getConnectorPermissions(installation.slug, { role: actorRole, authHeader }),
      getSubmissions({ installationId: installation.id, limit: 100 }, { role: actorRole, authHeader }),
      getProductList({ slim: true }, { role: actorRole, authHeader }),
    ]);
    const submissions = toItems(submissionsRaw);
    const productsById = new Map(products.map((product) => [product.id, product]));
    const failedSubmissions = submissions.filter(
      (item) => item.status === "ERROR" || item.status === "REJECTED" || item.status === "SUPPRESSED",
    );
    const pendingSubmissions = submissions.filter(
      (item) => item.status === "PENDING" || item.status === "RETRYING",
    );
    const latestSubmissionByProductId = new Map<
      string,
      (typeof submissions)[number]
    >();
    for (const submission of submissions) {
      const current = latestSubmissionByProductId.get(submission.productId);
      if (!current || new Date(submission.submittedAt).getTime() > new Date(current.submittedAt).getTime()) {
        latestSubmissionByProductId.set(submission.productId, submission);
      }
    }
    const catalogEntries = Array.from(latestSubmissionByProductId.entries())
      .map(([productId, latestSubmission]) => ({
        productId,
        product: productsById.get(productId),
        latestSubmission,
      }))
      .sort(
        (left, right) =>
          new Date(right.latestSubmission.submittedAt).getTime() - new Date(left.latestSubmission.submittedAt).getTime(),
      );
    const catalogVariantCount = catalogEntries.reduce((total, entry) => total + (entry.product?.variantCount ?? 0), 0);
    const catalogBlockingCount = catalogEntries.reduce(
      (total, entry) => total + (entry.product?.openValidationErrorCount ?? 0),
      0,
    );
    const catalogWarningCount = catalogEntries.reduce(
      (total, entry) => total + (entry.product?.openValidationWarningCount ?? 0),
      0,
    );
    const readinessEntries = catalogEntries.filter(
      (entry) => (entry.product?.openValidationErrorCount ?? 0) > 0 || (entry.product?.openValidationWarningCount ?? 0) > 0,
    );
    return (
      <div className="space-y-5">
        <PageHeader
          title={`${installation.displayName} / ${installation.accountAlias}`}
          description="Account-scoped connector health, catalog publication context, and operator recovery actions for this installation only."
          breadcrumb={
            <>
              <Link href="/dashboard" className="hover:underline">
                Dashboard
              </Link>{" "}
              /{" "}
              <Link href="/channels" className="hover:underline">
                Channels
              </Link>{" "}
              /{" "}
              <Link href="/channels/connectors" className="hover:underline">
                Connectors
              </Link>{" "}
              / <span className="font-semibold text-slate-700">Detail</span>
            </>
          }
          actions={
            <>
              <StatusChip label={installation.status} tone={installationStatusTone(installation.status)} />
              <Link
                href={`/connectors/${encodeURIComponent(installation.id)}/mapping`}
                className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Open mapping workspace
              </Link>
            </>
          }
        />

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Account health"
            value={formatStatusSummary(installation.status)}
            helper={installation.lastSyncAt ? `Last sync ${new Date(installation.lastSyncAt).toLocaleString()}` : "No sync recorded yet"}
            tone={
              installationStatusTone(installation.status) === "danger"
                ? "danger"
                : installationStatusTone(installation.status) === "warning"
                  ? "warning"
                  : "default"
            }
          />
          <KpiCard label="Submissions" value={submissions.length} helper={`${pendingSubmissions.length} pending or retrying`} />
          <KpiCard
            label="Errors / Rejections"
            value={failedSubmissions.length}
            tone={failedSubmissions.length > 0 ? "danger" : "success"}
          />
          <KpiCard label="Access rules" value={permissions.length} helper="Role and user policy overrides" />
        </section>

        <Card>
          <div className="flex flex-wrap items-center gap-2">
            {DETAIL_TABS.map((tab) => {
              const isSelected = selectedTab === tab.id;
              return (
                <Link
                  key={tab.id}
                  href={buildDetailHref(installation.id, tab.id)}
                  className={`rounded-full border px-3 py-1.5 text-sm font-medium ${
                    isSelected
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {tab.label}
                </Link>
              );
            })}
          </div>
        </Card>

        {selectedTab === "overview" ? (
          <div className="space-y-4">
            <section className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardTitle>Account Profile</CardTitle>
                <dl className="mt-2 grid grid-cols-[140px_1fr] gap-y-2 text-sm">
                  <dt className="text-slate-500">Connector</dt>
                  <dd>{installation.displayName}</dd>
                  <dt className="text-slate-500">Account alias</dt>
                  <dd>{installation.accountAlias}</dd>
                  <dt className="text-slate-500">Installation ID</dt>
                  <dd className="font-mono text-xs text-slate-700">{installation.id}</dd>
                  <dt className="text-slate-500">Slug</dt>
                  <dd>{installation.slug}</dd>
                  <dt className="text-slate-500">External Ref</dt>
                  <dd>{installation.externalAccountRef || "-"}</dd>
                  <dt className="text-slate-500">Installed At</dt>
                  <dd>{new Date(installation.installedAt).toLocaleString()}</dd>
                  <dt className="text-slate-500">Last Sync</dt>
                  <dd>{installation.lastSyncAt ? new Date(installation.lastSyncAt).toLocaleString() : "-"}</dd>
                </dl>
              </Card>

              <Card>
                <CardTitle>Operator Summary</CardTitle>
                <div className="mt-2 space-y-3 text-sm text-slate-700">
                  <p>
                    This account is currently{" "}
                    <span className="font-medium">{formatStatusSummary(installation.status).toLowerCase()}</span>.
                  </p>
                  <p>
                    Catalog coverage:{" "}
                    <span className="font-medium">{catalogEntries.length}</span> product
                    {catalogEntries.length === 1 ? "" : "s"} have submission history for this account.
                  </p>
                  <p>
                    Recent connector pressure:{" "}
                    <span className="font-medium">
                      {failedSubmissions.length} issue{failedSubmissions.length === 1 ? "" : "s"}
                    </span>{" "}
                    and{" "}
                    <span className="font-medium">
                      {pendingSubmissions.length} in flight
                    </span>
                    .
                  </p>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Link
                      href={buildDetailHref(installation.id, "catalog")}
                      className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Review catalog coverage
                    </Link>
                    <Link
                      href={buildDetailHref(installation.id, "issues")}
                      className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Open issue queue
                    </Link>
                    <Link
                      href={buildDetailHref(installation.id, "logs")}
                      className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Inspect submission logs
                    </Link>
                  </div>
                </div>
              </Card>
            </section>

            <section className="grid gap-4 lg:grid-cols-2">
              <Card>
                <CardTitle>Catalog Snapshot</CardTitle>
                {catalogEntries.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-600">No catalog records have been submitted through this account yet.</p>
                ) : (
                  <ul className="mt-2 space-y-2 text-sm">
                    {catalogEntries.slice(0, 5).map((entry) => (
                      <li key={entry.productId} className="rounded-md border border-slate-200 px-3 py-2">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <Link href={`/products/${encodeURIComponent(entry.productId)}`} className="font-medium text-blue-700 hover:underline">
                              {entry.product?.title || "Open product"}
                            </Link>
                            <p className="mt-1 text-xs text-slate-500">
                              {entry.product?.brand ? `${entry.product.brand} | ` : ""}
                              Last submission {formatDateTime(entry.latestSubmission.submittedAt)}
                            </p>
                          </div>
                          <StatusChip
                            label={entry.latestSubmission.status}
                            tone={submissionStatusTone(entry.latestSubmission.status)}
                          />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card>
                <CardTitle>Issue Snapshot</CardTitle>
                {failedSubmissions.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-600">No failed or rejected submissions are open for this account right now.</p>
                ) : (
                  <ul className="mt-2 space-y-2 text-sm">
                    {failedSubmissions.slice(0, 5).map((submission) => {
                      const product = productsById.get(submission.productId);
                      return (
                        <li key={submission.id} className="rounded-md border border-slate-200 px-3 py-2">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <Link href={`/products/${encodeURIComponent(submission.productId)}`} className="font-medium text-blue-700 hover:underline">
                                {product?.title || "Open product"}
                              </Link>
                              <p className="mt-1 text-xs text-slate-500">{summarizeSubmissionOutcome(submission)}</p>
                            </div>
                            <StatusChip label={submission.status} tone={submissionStatusTone(submission.status)} />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            </section>
          </div>
        ) : null}

        {selectedTab === "catalog" ? (
          <div className="space-y-4">
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard label="Products in scope" value={catalogEntries.length} helper="Products with submission history on this account" />
              <KpiCard label="Variants represented" value={catalogVariantCount} helper="Variant count from linked catalog products" />
              <KpiCard
                label="Blocking readiness issues"
                value={catalogBlockingCount}
                helper="Open product-level validation errors"
                tone={catalogBlockingCount > 0 ? "danger" : "success"}
              />
              <KpiCard
                label="Warnings"
                value={catalogWarningCount}
                helper="Open validation warnings worth reviewing"
                tone={catalogWarningCount > 0 ? "warning" : "success"}
              />
            </section>

            <Card>
              <CardTitle>Catalog Modules</CardTitle>
              <p className="mt-2 text-sm text-slate-600">
                This account view stays PIM-focused: product coverage, variant footprint, category context, and readiness signals for publication.
              </p>
              {catalogEntries.length === 0 ? (
                <p className="mt-3 text-sm text-slate-600">No submissions recorded for this account yet.</p>
              ) : (
                <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full min-w-[1180px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Product</th>
                        <th className="px-3 py-2">Category</th>
                        <th className="px-3 py-2">Variants</th>
                        <th className="px-3 py-2">Readiness</th>
                        <th className="px-3 py-2">Latest Status</th>
                        <th className="px-3 py-2">Latest Outcome</th>
                        <th className="px-3 py-2">Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {catalogEntries.map((entry) => (
                        <tr key={entry.productId} className="border-t border-slate-200 hover:bg-slate-50/50">
                          <td className="px-3 py-2.5">
                            <Link href={`/products/${encodeURIComponent(entry.productId)}`} className="text-blue-700 hover:underline">
                              {entry.product?.title || "Open product"}
                            </Link>
                            <p className="mt-1 text-xs text-slate-500">
                              {entry.product?.brand ? `${entry.product.brand} | ` : ""}
                              {entry.productId}
                            </p>
                          </td>
                          <td className="px-3 py-2.5 text-slate-700">
                            <p>{entry.product?.categoryName || "Uncategorized"}</p>
                            <p className="mt-1 text-xs text-slate-500">{entry.product?.categoryPath || entry.product?.categoryId || "-"}</p>
                          </td>
                          <td className="px-3 py-2.5">{entry.product?.variantCount ?? 0}</td>
                          <td className="px-3 py-2.5">
                            <StatusChip label={catalogReadinessLabel(entry.product)} tone={catalogReadinessTone(entry.product)} />
                          </td>
                          <td className="px-3 py-2.5">
                            <StatusChip label={entry.latestSubmission.status} tone={submissionStatusTone(entry.latestSubmission.status)} />
                          </td>
                          <td className="px-3 py-2.5 text-slate-700">{summarizeSubmissionOutcome(entry.latestSubmission)}</td>
                          <td className="px-3 py-2.5 text-xs text-slate-600">
                            {formatDateTime(entry.product?.updatedAt || entry.latestSubmission.submittedAt)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>

            <section className="grid gap-4 xl:grid-cols-2">
              <Card>
                <CardTitle>Readiness Queue</CardTitle>
                {readinessEntries.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-600">No product-level readiness blockers are visible for this connector account.</p>
                ) : (
                  <ul className="mt-2 space-y-2 text-sm">
                    {readinessEntries.slice(0, 8).map((entry) => (
                      <li key={entry.productId} className="rounded-md border border-slate-200 px-3 py-2">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <Link href={`/products/${encodeURIComponent(entry.productId)}`} className="font-medium text-blue-700 hover:underline">
                              {entry.product?.title || "Open product"}
                            </Link>
                            <p className="mt-1 text-xs text-slate-500">
                              {entry.product?.openValidationErrorCount ?? 0} errors | {entry.product?.openValidationWarningCount ?? 0} warnings
                            </p>
                          </div>
                          <StatusChip label={catalogReadinessLabel(entry.product)} tone={catalogReadinessTone(entry.product)} />
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              <Card>
                <CardTitle>Publication Guidance</CardTitle>
                <div className="mt-2 space-y-3 text-sm text-slate-700">
                  <p>Use this account view to answer three questions before you publish again:</p>
                  <ul className="list-disc space-y-1 pl-5 text-slate-600">
                    <li>Is the product catalog complete enough for this channel account?</li>
                    <li>Are variants, taxonomy, and brand details present for the affected products?</li>
                    <li>Do readiness blockers need fixing before you retry publication?</li>
                  </ul>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Link
                      href={`/connectors/${encodeURIComponent(installation.id)}/mapping`}
                      className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Open catalog mapping
                    </Link>
                    <Link
                      href={buildDetailHref(installation.id, "issues")}
                      className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Review issue queue
                    </Link>
                  </div>
                </div>
              </Card>
            </section>
          </div>
        ) : null}

        {selectedTab === "issues" ? (
          <div className="space-y-4">
            <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <KpiCard
                label="Failed / rejected"
                value={failedSubmissions.length}
                helper="Items needing corrective action"
                tone={failedSubmissions.length > 0 ? "danger" : "success"}
              />
              <KpiCard
                label="In flight"
                value={pendingSubmissions.length}
                helper="Pending or retrying connector work"
                tone={pendingSubmissions.length > 0 ? "warning" : "success"}
              />
              <KpiCard
                label="Catalog blockers"
                value={catalogBlockingCount}
                helper="Open product validation errors linked to this account"
                tone={catalogBlockingCount > 0 ? "danger" : "success"}
              />
              <KpiCard
                label="Warnings"
                value={catalogWarningCount}
                helper="Non-blocking readiness findings"
                tone={catalogWarningCount > 0 ? "warning" : "success"}
              />
            </section>

            <section className="grid gap-4 xl:grid-cols-2">
              <Card>
                <CardTitle>Recovery Playbook</CardTitle>
                <div className="mt-2 space-y-3 text-sm text-slate-700">
                  <p>Work through recovery in this order so we do not waste retries on unresolved catalog problems.</p>
                  <ol className="list-decimal space-y-1 pl-5 text-slate-600">
                    <li>Fix product mapping or required catalog fields when the issue lane is catalog mapping.</li>
                    <li>Check this account’s credentials and status when items point to connector account review.</li>
                    <li>Use logs to confirm whether the queue is still processing before retrying pending items.</li>
                  </ol>
                  <div className="flex flex-wrap gap-2 pt-1">
                    <Link
                      href={`/connectors/${encodeURIComponent(installation.id)}/mapping`}
                      className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Fix mapping
                    </Link>
                    <Link
                      href={buildDetailHref(installation.id, "logs")}
                      className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Open logs
                    </Link>
                    <Link
                      href="/admin/connectors"
                      className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Review governance
                    </Link>
                  </div>
                </div>
              </Card>

              <Card>
                <CardTitle>Issue Buckets</CardTitle>
                {failedSubmissions.length === 0 && pendingSubmissions.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-600">No connector issues or in-flight items need attention for this account.</p>
                ) : (
                  <ul className="mt-2 space-y-2 text-sm">
                    {[...failedSubmissions, ...pendingSubmissions].slice(0, 8).map((submission) => {
                      const product = productsById.get(submission.productId);
                      return (
                        <li key={submission.id} className="rounded-md border border-slate-200 px-3 py-2">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <Link href={`/products/${encodeURIComponent(submission.productId)}`} className="font-medium text-blue-700 hover:underline">
                                {product?.title || "Open product"}
                              </Link>
                              <p className="mt-1 text-xs text-slate-500">{issueLaneLabel(submission)}</p>
                              <p className="mt-2 text-sm text-slate-700">{nextOperatorStep(submission)}</p>
                            </div>
                            <StatusChip label={submission.status} tone={submissionStatusTone(submission.status)} />
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            </section>

            <Card>
              <CardTitle>Issue Queue</CardTitle>
              {failedSubmissions.length === 0 && pendingSubmissions.length === 0 ? (
                <p className="mt-2 text-sm text-slate-600">No connector issues or in-flight items need attention for this account.</p>
              ) : (
                <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full min-w-[1060px] text-left text-sm">
                    <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                      <tr>
                        <th className="px-3 py-2">Product</th>
                        <th className="px-3 py-2">Lane</th>
                        <th className="px-3 py-2">Status</th>
                        <th className="px-3 py-2">Issue</th>
                        <th className="px-3 py-2">Next Step</th>
                        <th className="px-3 py-2">Submitted</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...failedSubmissions, ...pendingSubmissions].slice(0, 50).map((submission) => {
                        const product = productsById.get(submission.productId);
                        return (
                          <tr key={submission.id} className="border-t border-slate-200 hover:bg-slate-50/50">
                            <td className="px-3 py-2.5">
                              <Link href={`/products/${encodeURIComponent(submission.productId)}`} className="text-blue-700 hover:underline">
                                {product?.title || "Open product"}
                              </Link>
                              <p className="mt-1 text-xs text-slate-500">
                                {product?.brand ? `${product.brand} | ` : ""}
                                {submission.productId}
                              </p>
                            </td>
                            <td className="px-3 py-2.5 text-slate-700">{issueLaneLabel(submission)}</td>
                            <td className="px-3 py-2.5">
                              <StatusChip label={submission.status} tone={submissionStatusTone(submission.status)} />
                            </td>
                            <td className="px-3 py-2.5 text-slate-700">{summarizeSubmissionOutcome(submission)}</td>
                            <td className="px-3 py-2.5 text-slate-700">{nextOperatorStep(submission)}</td>
                            <td className="px-3 py-2.5 text-xs text-slate-600">{formatDateTime(submission.submittedAt)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          </div>
        ) : null}

        {selectedTab === "logs" ? (
          <Card>
            <CardTitle>Submission Activity</CardTitle>
            {submissions.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600">No submissions recorded for this account yet.</p>
            ) : (
              <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full min-w-[920px] text-left text-sm">
                  <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Product</th>
                      <th className="px-3 py-2">Status</th>
                      <th className="px-3 py-2">Outcome</th>
                      <th className="px-3 py-2">Attempt</th>
                      <th className="px-3 py-2">Submitted</th>
                    </tr>
                  </thead>
                  <tbody>{renderSubmissionRows(submissions.slice(0, 50), productsById)}</tbody>
                </table>
              </div>
            )}
          </Card>
        ) : null}

        {selectedTab === "access" ? (
          <Card>
            <CardTitle>Governance &amp; Access</CardTitle>
            {permissions.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600">
                No connector-specific permission overrides. Workspace defaults are currently in effect.
              </p>
            ) : (
              <ul className="mt-2 space-y-2 text-sm">
                {permissions.map((permission) => (
                  <li key={permission.id} className="rounded-md border border-slate-200 px-3 py-2">
                    <p className="font-medium text-slate-800">{describePermissionRule(permission)}</p>
                    <p className="text-xs text-slate-500">
                      Created by {permission.createdBy || "system"} | updated {new Date(permission.updatedAt).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href="/admin/connectors"
                className="inline-flex rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Manage connector access
              </Link>
              <Link
                href={buildDetailHref(installation.id, "overview")}
                className="inline-flex rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Back to overview
              </Link>
            </div>
          </Card>
        ) : null}
      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect(detailReturnPath, error));
    }
    throw error;
  }
}

