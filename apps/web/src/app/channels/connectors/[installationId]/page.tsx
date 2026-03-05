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
  getSubmissions,
} from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";

export const dynamic = "force-dynamic";

interface ChannelConnectorDetailPageProps {
  params: Promise<{ installationId: string }>;
}

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

export default async function ChannelConnectorDetailPage({
  params,
}: ChannelConnectorDetailPageProps) {
  const { installationId } = await params;
  const authHeader = await getServerAuthHeader();
  const actorRole = await getServerActorRole();

  try {
    const installations = await getInstalledConnectors({ role: actorRole, authHeader });
    const installation = installations.find((item) => item.id === installationId);
    if (!installation) {
      notFound();
    }

    const [permissions, submissionsRaw] = await Promise.all([
      getConnectorPermissions(installation.slug, { role: actorRole, authHeader }),
      getSubmissions({ connectorSlug: installation.slug, limit: 100 }, { role: actorRole, authHeader }),
    ]);
    const submissions = toItems(submissionsRaw);
    const failedSubmissions = submissions.filter(
      (item) => item.status === "ERROR" || item.status === "REJECTED" || item.status === "SUPPRESSED",
    );

    return (
      <div className="space-y-5">
        <PageHeader
          title={`${installation.displayName} Connector`}
          description={`Account alias: ${installation.accountAlias}`}
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
              <StatusChip
                label={installation.status}
                tone={installation.status === "ACTIVE" ? "success" : "warning"}
              />
              <Link
                href={`/connectors/${encodeURIComponent(installation.id)}/mapping`}
                className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Open Mapping Manager
              </Link>
            </>
          }
        />

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Capabilities"
            value={installation.capabilities.length}
            helper={installation.capabilities.length > 0 ? installation.capabilities.join(", ") : "No capabilities configured"}
          />
          <KpiCard label="Submissions" value={submissions.length} />
          <KpiCard
            label="Errors / Rejections"
            value={failedSubmissions.length}
            tone={failedSubmissions.length > 0 ? "danger" : "success"}
          />
          <KpiCard
            label="Permission Rules"
            value={permissions.length}
            helper="User and role overrides"
          />
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardTitle>Overview</CardTitle>
            <dl className="mt-2 grid grid-cols-[140px_1fr] gap-y-2 text-sm">
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
            <CardTitle>Permissions</CardTitle>
            {permissions.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600">No connector-specific permission overrides.</p>
            ) : (
              <ul className="mt-2 space-y-2 text-sm">
                {permissions.map((permission) => (
                  <li key={permission.id} className="rounded-md border border-slate-200 px-3 py-2">
                    <p className="font-medium text-slate-800">
                      {permission.principalType}:{permission.principalId}
                    </p>
                    <p className="text-slate-600">action={permission.action} | alias={permission.accountAlias}</p>
                  </li>
                ))}
              </ul>
            )}
            <Link
              href="/admin/connectors"
              className="mt-3 inline-flex rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Manage Connector Access
            </Link>
          </Card>
        </section>

        <Card>
          <CardTitle>Submission History</CardTitle>
          {submissions.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">No submissions recorded for this connector yet.</p>
          ) : (
            <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Submission</th>
                    <th className="px-3 py-2">Product</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Attempt</th>
                    <th className="px-3 py-2">Submitted</th>
                  </tr>
                </thead>
                <tbody>
                  {submissions.slice(0, 50).map((submission) => (
                    <tr key={submission.id} className="border-t border-slate-200 hover:bg-slate-50/50">
                      <td className="px-3 py-2.5 font-mono text-xs">{submission.id}</td>
                      <td className="px-3 py-2.5">
                        <Link href={`/products/${encodeURIComponent(submission.productId)}`} className="text-blue-700 hover:underline">
                          {submission.productId}
                        </Link>
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusChip label={submission.status} tone={submissionStatusTone(submission.status)} />
                      </td>
                      <td className="px-3 py-2.5">{submission.attemptNumber}</td>
                      <td className="px-3 py-2.5 text-xs text-slate-600">{new Date(submission.submittedAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect(`/channels/connectors/${encodeURIComponent(installationId)}`, error.status));
    }
    throw error;
  }
}
