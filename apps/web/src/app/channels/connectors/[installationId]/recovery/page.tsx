import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineAlert } from "@/components/ui/inline-alert";
import { KpiCard } from "@/components/ui/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import {
  ApiHttpError,
  getInstalledConnectors,
  getConnectorRecoveryGroups,
} from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerSession } from "@/lib/server-session";
import { RecoveryRetryButton } from "./_components/recovery-retry-button";

export const dynamic = "force-dynamic";

interface RecoveryPageProps {
  params: Promise<{ installationId: string }>;
  searchParams: Promise<{ status?: string }>;
}

export default async function ConnectorRecoveryPage({ params, searchParams }: RecoveryPageProps) {
  const { installationId } = await params;
  const query = await searchParams;
  const { authHeader, actorRole } = await getServerSession();

  try {
    const [installations, groups] = await Promise.all([
      getInstalledConnectors({ role: actorRole, authHeader }),
      getConnectorRecoveryGroups(installationId, { role: actorRole, authHeader }).catch(() => []),
    ]);

    const installation = installations.find((item) => item.id === installationId);
    if (!installation) {
      notFound();
    }

    const totalFailures = groups.reduce((sum, g) => sum + g.affectedCount, 0);
    const totalFamilies = groups.length;

    const statusMessage = String(query.status ?? "").trim().toLowerCase();
    const banner =
      statusMessage === "retry-queued"
        ? { tone: "success" as const, message: "Retry queued. Affected products have been added to the export lane." }
        : statusMessage === "retry-failed"
          ? { tone: "danger" as const, message: "Retry could not be queued right now. Check connector health and try again." }
          : null;

    return (
      <div className="space-y-5">
        <PageHeader
          title="Recovery Center"
          description={`Failed sync analysis and bulk retry for ${installation.displayName} / ${installation.accountAlias}.`}
          breadcrumb={
            <>
              <Link href="/dashboard" className="hover:underline">Dashboard</Link>{" "}
              /{" "}
              <Link href="/channels" className="hover:underline">Channels</Link>{" "}
              /{" "}
              <Link href="/channels/connectors" className="hover:underline">Connectors</Link>{" "}
              /{" "}
              <Link href={`/channels/connectors/${encodeURIComponent(installationId)}`} className="hover:underline">
                {installation.accountAlias}
              </Link>{" "}
              / <span className="font-semibold text-slate-700">Recovery</span>
            </>
          }
          actions={
            <Link
              href={`/channels/connectors/${encodeURIComponent(installationId)}`}
              className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Back to connector
            </Link>
          }
        />

        {banner ? (
          <div className={`rounded-lg border px-4 py-3 text-sm ${banner.tone === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-800" : "border-red-200 bg-red-50 text-red-800"}`}>
            {banner.message}
          </div>
        ) : null}

        <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <KpiCard label="Total Failures" value={totalFailures} tone={totalFailures > 0 ? "danger" : "default"} />
          <KpiCard label="Error Families" value={totalFamilies} tone={totalFamilies > 0 ? "warning" : "default"} />
          <KpiCard label="Products Affected" value={totalFailures} />
        </section>

        <Card>
          <CardTitle>Error Groups</CardTitle>
          <p className="mt-1 text-xs text-slate-500">
            Failures are grouped by error code. Retry all products in a group after fixing the underlying issue.
          </p>
          {groups.length === 0 ? (
            <div className="mt-4">
              <EmptyState
                icon="✓"
                title="No sync failures"
                description="All submissions for this installation are either successful or pending."
              />
            </div>
          ) : (
            <div className="mt-4 divide-y divide-slate-100">
              {groups.map((group) => (
                <div key={group.errorFamily} className="py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-medium text-slate-900">{group.errorFamily}</span>
                        <StatusChip label={`${group.affectedCount} product${group.affectedCount === 1 ? "" : "s"}`} tone="danger" />
                      </div>
                      <p className="mt-1 text-sm text-slate-600">{group.exampleMessage}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <Link
                        href={`/products?issues=error`}
                        className="rounded-md border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                      >
                        Fix all
                      </Link>
                      <RecoveryRetryButton
                        installationId={installationId}
                        errorFamily={group.errorFamily}
                        returnPath={`/channels/connectors/${encodeURIComponent(installationId)}/recovery`}
                      />
                    </div>
                  </div>
                  <details className="mt-3">
                    <summary className="cursor-pointer text-xs text-blue-600 hover:underline">
                      {group.productIds.length} affected product{group.productIds.length === 1 ? "" : "s"}
                    </summary>
                    <div className="mt-2 space-y-1">
                      {group.productIds.slice(0, 20).map((productId) => (
                        <div key={productId} className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-1.5">
                          <Link
                            href={`/products/${encodeURIComponent(productId)}`}
                            className="font-mono text-xs text-blue-700 hover:underline"
                          >
                            {productId}
                          </Link>
                          <Link
                            href={`/products/${encodeURIComponent(productId)}?tab=channels`}
                            className="text-xs text-slate-500 hover:underline"
                          >
                            Fix
                          </Link>
                        </div>
                      ))}
                      {group.productIds.length > 20 ? (
                        <p className="text-xs text-slate-400">+ {group.productIds.length - 20} more</p>
                      ) : null}
                    </div>
                  </details>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect(`/channels/connectors/${installationId}/recovery`, error));
    }
    return (
      <div className="space-y-5">
        <PageHeader
          title="Recovery Center"
          description="Recovery data is temporarily unavailable."
        />
        <InlineAlert
          tone="error"
          title="Recovery data unavailable"
          message="Sync failure data could not be loaded. Check the connector health and retry in a moment."
        />
      </div>
    );
  }
}
