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
      getSubmissions({ installationId: installation.id, limit: 100 }, { role: actorRole, authHeader }),
    ]);
    const submissions = toItems(submissionsRaw);
    const failedSubmissions = submissions.filter(
      (item) => item.status === "ERROR" || item.status === "REJECTED" || item.status === "SUPPRESSED",
    );
    const pendingSubmissions = submissions.filter(
      (item) => item.status === "PENDING" || item.status === "RETRYING",
    );

    return (
      <div className="space-y-5">
        <PageHeader
          title={`${installation.displayName} / ${installation.accountAlias}`}
          description="Account-level connector health, access policy, and submission activity for this installation only."
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
                tone={installationStatusTone(installation.status)}
              />
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
            value={installation.status === "ACTIVE" ? "Healthy" : installation.status}
            helper={installation.lastSyncAt ? `Last sync ${new Date(installation.lastSyncAt).toLocaleString()}` : "No sync recorded yet"}
            tone={installationStatusTone(installation.status) === "danger" ? "danger" : installationStatusTone(installation.status) === "warning" ? "warning" : "default"}
          />
          <KpiCard label="Submissions" value={submissions.length} helper={`${pendingSubmissions.length} pending or retrying`} />
          <KpiCard
            label="Errors / Rejections"
            value={failedSubmissions.length}
            tone={failedSubmissions.length > 0 ? "danger" : "success"}
          />
          <KpiCard
            label="Access rules"
            value={permissions.length}
            helper="Role and user policy overrides"
          />
        </section>

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
            <CardTitle>Access Policy</CardTitle>
            {permissions.length === 0 ? (
              <p className="mt-2 text-sm text-slate-600">No connector-specific permission overrides. Workspace defaults are currently in effect.</p>
            ) : (
              <ul className="mt-2 space-y-2 text-sm">
                {permissions.map((permission) => (
                  <li key={permission.id} className="rounded-md border border-slate-200 px-3 py-2">
                    <p className="font-medium text-slate-800">{describePermissionRule(permission)}</p>
                    <p className="text-xs text-slate-500">
                      Created by {permission.createdBy || "system"} · updated {new Date(permission.updatedAt).toLocaleString()}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <Link
              href="/admin/connectors"
              className="mt-3 inline-flex rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Manage connector access
            </Link>
          </Card>
        </section>

        <Card>
          <CardTitle>Submission Activity</CardTitle>
          {submissions.length === 0 ? (
            <p className="mt-2 text-sm text-slate-600">No submissions recorded for this account yet.</p>
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
                          Open product
                        </Link>
                        <p className="mt-1 text-xs text-slate-500">{submission.productId}</p>
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
      redirect(buildLoginRedirect(`/channels/connectors/${encodeURIComponent(installationId)}`, error));
    }
    throw error;
  }
}
