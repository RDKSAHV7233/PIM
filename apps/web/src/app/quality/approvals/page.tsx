import Link from "next/link";
import { redirect } from "next/navigation";
import { decideProductReviewAction } from "@/app/actions";
import { ApiHttpError, getIssueInbox, getProductList, getStats } from "@/lib/api";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { KpiCard } from "@/components/ui/kpi-card";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { canDecideApproval } from "@/lib/role-capabilities";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";

export const dynamic = "force-dynamic";

interface QualityApprovalsPageProps {
  searchParams: Promise<{
    decisionStatus?: "approved" | "rejected";
    decisionError?: string;
  }>;
}

export default async function QualityApprovalsPage({ searchParams }: QualityApprovalsPageProps) {
  const query = await searchParams;
  const authHeader = await getServerAuthHeader();
  const actorRole = await getServerActorRole();
  if (!authHeader) {
    redirect(buildLoginRedirect("/quality/approvals", 401));
  }

  try {
    const [stats, inbox, products] = await Promise.all([
      getStats({ role: actorRole, authHeader }),
      getIssueInbox(
        {
          productStatus: "in_review",
          limit: 50,
        },
        { role: actorRole, authHeader },
      ),
      getProductList({ slim: true }, { role: actorRole, authHeader }),
    ]);

    const blockingProducts = new Set(
      inbox.items.filter((item) => item.severity === "BLOCKING").map((item) => item.productId),
    ).size;
    const warningProducts = new Set(
      inbox.items.filter((item) => item.severity === "WARNING").map((item) => item.productId),
    ).size;
    const reviewedProductIds = new Set(inbox.items.map((item) => item.productId)).size;
    const cleanForDecision = Math.max(0, stats.pendingApprovals - reviewedProductIds);
    const decisionEnabled = canDecideApproval(actorRole);
    const returnTo = "/quality/approvals";
    const inReviewProducts = products
      .filter((product) => product.status === "in_review")
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
    const issuesByProduct = inbox.items.reduce<Map<string, { blocking: number; warning: number }>>((acc, item) => {
      const current = acc.get(item.productId) ?? { blocking: 0, warning: 0 };
      if (item.severity === "BLOCKING") {
        current.blocking += 1;
      } else {
        current.warning += 1;
      }
      acc.set(item.productId, current);
      return acc;
    }, new Map());

    return (
      <div className="space-y-5">
        <PageHeader
          title="Approval Queue"
          description="Review products in workflow review and resolve remaining publish-readiness blockers."
          breadcrumb={
            <>
              Dashboard / Quality / <span className="font-semibold text-slate-700">Approval Queue</span>
            </>
          }
        />

        {query.decisionStatus ? (
          <Card>
            <p className="text-sm font-medium text-emerald-700">
              Product review decision recorded: {query.decisionStatus}.
            </p>
          </Card>
        ) : null}
        {query.decisionError ? (
          <Card>
            <p className="text-sm font-medium text-rose-700">
              Review decision could not be applied. Refresh the queue and verify blocking issues are cleared.
            </p>
          </Card>
        ) : null}

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <KpiCard
            label="Products In Review"
            value={stats.pendingApprovals}
            tone={stats.pendingApprovals > 0 ? "warning" : "default"}
          />
          <KpiCard
            label="Products Blocked"
            value={blockingProducts}
            tone={blockingProducts > 0 ? "danger" : "success"}
          />
          <KpiCard
            label="Warnings In Review"
            value={warningProducts}
            tone={warningProducts > 0 ? "warning" : "success"}
          />
          <KpiCard
            label="Clean For Decision"
            value={cleanForDecision}
            tone={cleanForDecision > 0 ? "success" : "default"}
          />
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardTitle>Workflow Status</CardTitle>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <StatusChip
                label={stats.pendingApprovals > 0 ? "Review queue active" : "No products in review"}
                tone={stats.pendingApprovals > 0 ? "warning" : "neutral"}
              />
              <StatusChip
                label={blockingProducts > 0 ? `${blockingProducts} blocked` : "No blocking issues"}
                tone={blockingProducts > 0 ? "danger" : "success"}
              />
            </div>
            <p className="mt-3 text-sm text-slate-600">
              This queue reflects real `in_review` workflow status, not a placeholder approval stage.
            </p>
          </Card>
          <Card>
            <CardTitle>Operator Actions</CardTitle>
            <p className="mt-2 text-sm text-slate-700">
              Review blockers in Issue Inbox, open the product for context, and make final review decisions from this queue.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href="/quality/issues?productStatus=in_review"
                className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Open Review Issues
              </Link>
              <Link
                href="/quality/validation"
                className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Open Validation
              </Link>
            </div>
          </Card>
        </section>

        <Card>
          <CardTitle>Review Decisions</CardTitle>
          {inReviewProducts.length === 0 ? (
            <EmptyState
              icon="CHECK"
              title="No products waiting for review decisions"
              description="Products appear here when their workflow status moves to in_review."
              action={{ label: "Back to Quality", href: "/quality" }}
            />
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[960px] text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2">Product</th>
                    <th className="py-2">Completeness</th>
                    <th className="py-2">Open Issues</th>
                    <th className="py-2">Updated</th>
                    <th className="py-2">Decision</th>
                  </tr>
                </thead>
                <tbody>
                  {inReviewProducts.map((product) => {
                    const summary = issuesByProduct.get(product.id) ?? { blocking: 0, warning: 0 };
                    const canApprove = summary.blocking === 0;

                    return (
                      <tr key={product.id} className="border-t border-slate-200 align-top">
                        <td className="py-2.5">
                          <p className="font-medium text-slate-900">{product.title}</p>
                          <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
                            <span>{product.categoryName ?? product.categoryId}</span>
                            <StatusChip label={product.status} tone="warning" />
                          </div>
                          <Link
                            href={`/products/${encodeURIComponent(product.id)}?tab=quality&returnTo=${encodeURIComponent(returnTo)}`}
                            className="mt-2 inline-flex text-sm font-medium text-blue-700 hover:underline"
                          >
                            Open product
                          </Link>
                        </td>
                        <td className="py-2.5 text-slate-700">{product.completenessScore ?? 0}%</td>
                        <td className="py-2.5">
                          <div className="flex flex-wrap gap-2">
                            <StatusChip
                              label={summary.blocking > 0 ? `${summary.blocking} blocking` : "No blockers"}
                              tone={summary.blocking > 0 ? "danger" : "success"}
                            />
                            <StatusChip
                              label={summary.warning > 0 ? `${summary.warning} warnings` : "No warnings"}
                              tone={summary.warning > 0 ? "warning" : "neutral"}
                            />
                          </div>
                        </td>
                        <td className="py-2.5 text-xs text-slate-500">{new Date(product.updatedAt).toLocaleString()}</td>
                        <td className="py-2.5">
                          {decisionEnabled ? (
                            <div className="space-y-2">
                              <div className="flex flex-wrap gap-2">
                                <form action={decideProductReviewAction}>
                                  <input type="hidden" name="productId" value={product.id} />
                                  <input type="hidden" name="status" value="approved" />
                                  <input type="hidden" name="returnTo" value={returnTo} />
                                  <PendingSubmitButton
                                    type="submit"
                                    disabled={!canApprove}
                                    idleLabel="Approve"
                                    pendingLabel="Approving..."
                                  />
                                </form>
                                <form action={decideProductReviewAction}>
                                  <input type="hidden" name="productId" value={product.id} />
                                  <input type="hidden" name="status" value="rejected" />
                                  <input type="hidden" name="returnTo" value={returnTo} />
                                  <PendingSubmitButton
                                    type="submit"
                                    variant="secondary"
                                    idleLabel="Reject"
                                    pendingLabel="Rejecting..."
                                  />
                                </form>
                              </div>
                              {!canApprove ? (
                                <p className="text-xs text-slate-500">Clear blocking issues before approving.</p>
                              ) : null}
                            </div>
                          ) : (
                            <p className="text-sm text-slate-600">Your role can review items here, but not record final decisions.</p>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <CardTitle>Items In Review</CardTitle>
          {stats.pendingApprovals === 0 ? (
            <EmptyState
              icon="CHECK"
              title="No products waiting for approval"
              description="Products appear here when their workflow status moves to in_review."
              action={{ label: "Back to Quality", href: "/quality" }}
            />
          ) : inbox.items.length === 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-700">
                {stats.pendingApprovals} product(s) are in review with no open issue-inbox blockers right now.
              </p>
              <p className="text-sm text-slate-600">
                Use product detail readiness, channel checks, and validation to complete final review decisions.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-slate-200">
              <table className="w-full min-w-[880px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Product</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Severity</th>
                    <th className="px-3 py-2">Field</th>
                    <th className="px-3 py-2">Message</th>
                  </tr>
                </thead>
                <tbody>
                  {inbox.items.map((item) => (
                    <tr key={item.issueId} className="border-t border-slate-200 hover:bg-slate-50/50">
                      <td className="px-3 py-2.5">
                        <p className="font-medium text-slate-900">{item.productName}</p>
                        <p className="text-xs text-slate-500">{item.sku}</p>
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusChip
                          label={item.productStatus}
                          tone={item.productStatus === "in_review" ? "warning" : "neutral"}
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <StatusChip
                          label={item.severity}
                          tone={item.severity === "BLOCKING" ? "danger" : "warning"}
                        />
                      </td>
                      <td className="px-3 py-2.5 text-slate-600">{item.fieldPath ?? "-"}</td>
                      <td className="px-3 py-2.5 text-slate-700">{item.sellerMessage}</td>
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
      redirect(buildLoginRedirect("/quality/approvals", error.status));
    }
    throw error;
  }
}
