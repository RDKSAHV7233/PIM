import Link from "next/link";
import { redirect } from "next/navigation";
import { addApprovalCommentAction, decideProductReviewAction } from "@/app/actions";
import { createChangeRequestAction, resolveChangeRequestAction } from "@/app/quality-actions";
import { ApiHttpError, getAllProductsSlim, getApprovalComments, getBillingPlanProfile, getIssueInbox, getStats } from "@/lib/api";
import { getChangeRequests, getWorkflowSla, getOverdueCount } from "@/lib/api/catalog";
import { SlaBadge } from "@/components/ui/sla-badge";
import type { ProductRevision } from "@/lib/api";
import { getProductRevisions } from "@/lib/api/revisions";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { DataGrid } from "@/components/ui/data-grid";
import { EmptyState } from "@/components/ui/empty-state";
import { InlineAlert } from "@/components/ui/inline-alert";
import { KpiCard } from "@/components/ui/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { StatusChip } from "@/components/ui/status-chip";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { canDecideApproval } from "@/lib/role-capabilities";
import { getServerSession } from "@/lib/server-session";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ApprovalEvidenceDrawer } from "./approval-evidence-drawer";

/** Maximum characters to display for a diff field value in the "What Changed" section. */
const MAX_DIFF_VALUE_LENGTH = 120;

export const dynamic = "force-dynamic";

interface QualityApprovalsPageProps {
  searchParams: Promise<{
    decisionStatus?: "approved" | "rejected";
    decisionError?: string;
  }>;
}

function summarizeDecisionNote(note: string | null | undefined): string | null {
  const normalized = String(note ?? "").trim();
  if (!normalized) {
    return null;
  }
  return normalized.length > 96 ? `${normalized.slice(0, 93)}...` : normalized;
}

export default async function QualityApprovalsPage({ searchParams }: QualityApprovalsPageProps) {
  const query = await searchParams;
  const { authHeader, actorRole } = await getServerSession();
  if (!authHeader) {
    redirect(buildLoginRedirect("/quality/approvals", 401));
  }

  try {
    const planProfile = await getBillingPlanProfile({ role: actorRole, authHeader });
    const planTier = String(planProfile.planTier ?? "TRIAL").toUpperCase();
    if (planTier === "TRIAL" || planTier === "STARTER") {
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
          <Card>
            <CardTitle>Plan Upgrade Required</CardTitle>
            <p className="mt-2 text-sm text-slate-600">
              Approval workflow is available on the Growth plan and above. Upgrade to review product
              submissions, assign approvers, and enforce sign-off before publish.
            </p>
            <div className="mt-4">
              <Link
                href="/admin/plan"
                className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                View Plan &amp; Upgrade
              </Link>
            </div>
          </Card>
        </div>
      );
    }
    const [stats, inbox, products, slaConfig, overdueCount] = await Promise.all([
      getStats({ role: actorRole, authHeader }),
      getIssueInbox(
        {
          productStatus: "in_review",
          limit: 50,
        },
        { role: actorRole, authHeader },
      ),
      getAllProductsSlim({ role: actorRole, authHeader }),
      getWorkflowSla({ role: actorRole, authHeader }).catch(() => ({ reviewTargetDays: 3, tenantKey: "" })),
      getOverdueCount({ role: actorRole, authHeader }).catch(() => ({ count: 0 })),
    ]);

    const blockingProducts = new Set(
      inbox.items.filter((item) => item.severity === "BLOCKING").map((item) => item.productId),
    ).size;
    const warningProducts = new Set(
      inbox.items.filter((item) => item.severity === "WARNING").map((item) => item.productId),
    ).size;
    const reviewedProductIds = new Set(inbox.items.map((item) => item.productId)).size;
    const approvalQueueRedacted =
      Array.isArray(stats.redactedSections) && stats.redactedSections.includes("approval_queue");
    const cleanForDecision = approvalQueueRedacted ? 0 : Math.max(0, stats.pendingApprovals - reviewedProductIds);
    const decisionEnabled = canDecideApproval(actorRole);
    const returnTo = "/quality/approvals";
    const inReviewProducts = products
      .filter((product) => product.status === "in_review")
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
    const revisionsByProduct = new Map([] as Array<[string, ProductRevision[]]>);
    await Promise.all(
      inReviewProducts.map(async (product) => {
        try {
          const revisions = await getProductRevisions(product.id, { role: actorRole, authHeader });
          revisionsByProduct.set(product.id, revisions.items as unknown as ProductRevision[]);
        } catch {
          // Graceful degradation — revision fetch failure does not block approval flow
        }
      }),
    );

    // Sprint 2: fetch change requests per in-review product (direct API call — no HTTP self-loop)
    const changeRequestsByProduct = new Map<string, { id: string; reason: string; status: string }[]>();
    await Promise.all(
      inReviewProducts.map(async (product) => {
        try {
          const crs = await getChangeRequests(product.id, { role: actorRole, authHeader });
          changeRequestsByProduct.set(product.id, crs as { id: string; reason: string; status: string }[]);
        } catch { /* graceful degradation */ }
      }),
    );

    const commentsByProduct = new Map<string, Awaited<ReturnType<typeof getApprovalComments>>>();
    await Promise.all(
      inReviewProducts.map(async (product) => {
        try {
          const comments = await getApprovalComments(product.id, { role: actorRole, authHeader });
          commentsByProduct.set(product.id, comments);
        } catch {
          // Graceful degradation — comment fetch failure does not block approval flow
        }
      }),
    );

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
    const productsWithRevisionEvidence = inReviewProducts.filter(
      (product) => (revisionsByProduct.get(product.id) ?? []).length > 0,
    ).length;
    const productsWithoutRevisionEvidence = inReviewProducts.length - productsWithRevisionEvidence;
    const revisionsWithDecisionNotes = Array.from(revisionsByProduct.values()).filter((revisions) =>
      revisions.some((revision) => summarizeDecisionNote(revision.decisionNote)),
    ).length;

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
          <InlineAlert
            tone="success"
            title="Review decision recorded"
            message={`Product review decision recorded: ${query.decisionStatus}.`}
          />
        ) : null}
        {query.decisionError ? (
          <InlineAlert
            tone="error"
            title="Review decision could not be applied"
            message="Refresh the queue and verify blocking issues are cleared before recording the decision again."
          />
        ) : null}

        <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <KpiCard
            label="Products In Review"
            value={approvalQueueRedacted ? "-" : stats.pendingApprovals}
            tone={approvalQueueRedacted ? "default" : stats.pendingApprovals > 0 ? "warning" : "default"}
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
            value={approvalQueueRedacted ? "-" : cleanForDecision}
            tone={approvalQueueRedacted ? "default" : cleanForDecision > 0 ? "success" : "default"}
          />
          <KpiCard
            label="SLA At Risk"
            value={overdueCount.count}
            tone={overdueCount.count > 0 ? "danger" : "success"}
          />
        </section>

        <section className="grid gap-4 lg:grid-cols-3">
          <Card>
            <CardTitle>Workflow Status</CardTitle>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <StatusChip
                label={
                  approvalQueueRedacted
                    ? "Approval queue restricted"
                    : stats.pendingApprovals > 0
                      ? "Review queue active"
                      : "No products in review"
                }
                tone={approvalQueueRedacted ? "neutral" : stats.pendingApprovals > 0 ? "warning" : "neutral"}
              />
              <StatusChip
                label={blockingProducts > 0 ? `${blockingProducts} blocked` : "No blocking issues"}
                tone={blockingProducts > 0 ? "danger" : "success"}
              />
            </div>
            <p className="mt-3 text-sm text-slate-600">
              {approvalQueueRedacted
                ? "Approval queue counts require reviewer, editor, or admin access."
                : "This queue reflects real `in_review` workflow status, not a placeholder approval stage."}
            </p>
          </Card>
          <Card>
            <CardTitle>Revision Evidence Coverage</CardTitle>
            <p className="mt-2 text-sm text-slate-700">
              Latest field-level evidence is loaded directly into the queue so reviewers can answer what changed before opening product detail.
            </p>
            <div className="mt-3 space-y-2 text-sm text-slate-700">
              <p>
                <strong>1. Check blockers.</strong> Confirm whether blocking issues are cleared before you approve.
              </p>
              <p>
                <strong>2. Open product context.</strong> Review the product quality tab and the latest workflow updates before recording a final decision.
              </p>
              <p>
                <strong>3. Use rejection intentionally.</strong> Reject items when quality or publish readiness still needs editor follow-up.
              </p>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusChip
                label={`${productsWithRevisionEvidence} with revision evidence`}
                tone={productsWithRevisionEvidence > 0 ? "success" : "neutral"}
              />
              <StatusChip
                label={
                  productsWithoutRevisionEvidence > 0
                    ? `${productsWithoutRevisionEvidence} awaiting evidence`
                    : "No evidence gaps"
                }
                tone={productsWithoutRevisionEvidence > 0 ? "warning" : "success"}
              />
              <StatusChip
                label={`${revisionsWithDecisionNotes} with reviewer notes`}
                tone={revisionsWithDecisionNotes > 0 ? "info" : "neutral"}
              />
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Use inline revision history first, then open product detail only when you need deeper readiness or validation context.
            </p>
          </Card>
          <Card>
            <CardTitle>Reviewer Decision Guide</CardTitle>
            <p className="mt-2 text-sm text-slate-700">
              Use the same evidence path on every item so approval stays consistent across the review queue.
            </p>
            <div className="mt-3 space-y-2 text-sm text-slate-700">
              <p>
                <strong>1. Check blockers.</strong> Confirm whether blocking issues are cleared before you approve.
              </p>
              <p>
                <strong>2. Open product context.</strong> Review the product quality tab and the latest workflow updates before recording a final decision.
              </p>
              <p>
                <strong>3. Use rejection intentionally.</strong> Reject items when quality or publish readiness still needs editor follow-up.
              </p>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <StatusChip
                label={`${productsWithRevisionEvidence} with revision evidence`}
                tone={productsWithRevisionEvidence > 0 ? "success" : "neutral"}
              />
              <StatusChip
                label={
                  productsWithoutRevisionEvidence > 0
                    ? `${productsWithoutRevisionEvidence} awaiting evidence`
                    : "No evidence gaps"
                }
                tone={productsWithoutRevisionEvidence > 0 ? "warning" : "success"}
              />
              <StatusChip
                label={`${revisionsWithDecisionNotes} with reviewer notes`}
                tone={revisionsWithDecisionNotes > 0 ? "info" : "neutral"}
              />
            </div>
            <p className="mt-3 text-xs text-slate-500">
              Use inline revision history first, then open product detail only when you need deeper readiness or validation context.
            </p>
          </Card>
          <Card>
            <CardTitle>Reviewer Decision Guide</CardTitle>
            <p className="mt-2 text-sm text-slate-700">
              Use the same evidence path on every item so approval stays consistent across the review queue.
            </p>
            <div className="mt-3 space-y-2 text-sm text-slate-700">
              <p>
                <strong>1. Check blockers.</strong> Confirm whether blocking issues are cleared before you approve.
              </p>
              <p>
                <strong>2. Open product context.</strong> Review the product quality tab and the latest workflow updates before recording a final decision.
              </p>
              <p>
                <strong>3. Use rejection intentionally.</strong> Reject items when quality or publish readiness still needs editor follow-up.
              </p>
            </div>
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
            <p className="mt-3 text-xs text-slate-500">
              Approval decisions here reflect the live in-review queue and the current issue inbox, not a demo-only workflow.
            </p>
          </Card>
        </section>

        {/* SLA configuration banner — PUT /catalog/workflow/sla (admin only) */}
        <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600 shadow-sm">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 shrink-0 text-slate-400" aria-hidden><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>
          <span>Review SLA: <strong className="text-slate-800">{slaConfig.reviewTargetDays} days</strong> from <code className="rounded bg-slate-200 px-1 py-0.5 font-mono text-xs">in_review</code> transition.</span>
          {overdueCount.count > 0 && (
            <span className="ml-auto rounded-full border border-red-200 bg-red-50 px-2.5 py-0.5 text-[11px] font-bold text-red-700">
              {overdueCount.count} overdue
            </span>
          )}
        </div>

        <Card>
          <CardTitle>Review Decisions</CardTitle>
          <DataGrid
            columns={[
              {
                key: "product",
                header: "Product",
                render: (product) => (
                  <>
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
                    {(() => {
                      const revItems = revisionsByProduct.get(product.id) ?? [];
                      if (revItems.length === 0) return null;
                      const latestRevision = revItems[0];
                      const changedFieldCount = latestRevision.changedFields.length;
                      if (changedFieldCount === 0) return null;
                      return (
                        <details className="mt-2 rounded-md border border-slate-200 bg-slate-50">
                          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100">
                            What Changed ({changedFieldCount} field{changedFieldCount !== 1 ? "s" : ""})
                          </summary>
                          <div className="border-t border-slate-200 px-3 py-2">
                            {latestRevision.changedFields.map((change) => (
                              <div key={change.path} className="mb-1 text-xs">
                                <span className="font-medium text-slate-700">{change.label}:</span>{" "}
                                <span className="text-slate-500 line-through">
                                  {String(change.before ?? "-").slice(0, MAX_DIFF_VALUE_LENGTH)}
                                </span>
                                {" → "}
                                <span className="text-slate-900">
                                  {String(change.after ?? "-").slice(0, MAX_DIFF_VALUE_LENGTH)}
                                </span>
                              </div>
                            ))}
                          </div>
                        </details>
                      );
                    })()}
                    {(() => {
                      const comments = commentsByProduct.get(product.id) ?? [];
                      return (
                        <section aria-label="Review comments" className="mt-2">
                          <details className="rounded-md border border-slate-200 bg-slate-50">
                            <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100">
                              Review Comments ({comments.length})
                            </summary>
                            <div className="border-t border-slate-200 px-3 py-2">
                              {comments.length > 0 ? (
                                <ul className="mb-2 space-y-2">
                                  {comments.map((comment) => (
                                    <li key={comment.id} className="text-xs text-slate-700">
                                      <span className="font-medium capitalize">{comment.actorRole}</span>
                                      {": "}
                                      {comment.body}
                                      <span className="ml-1 text-slate-400">
                                        — {formatDateTime(comment.createdAt)}
                                      </span>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <p className="mb-2 text-xs text-slate-500">No comments yet.</p>
                              )}
                              <form action={addApprovalCommentAction} className="space-y-1">
                                <input type="hidden" name="productId" value={product.id} />
                                <label htmlFor={`comment-body-${product.id}`} className="text-xs font-medium text-slate-700">
                                  Add comment
                                </label>
                                <textarea
                                  id={`comment-body-${product.id}`}
                                  name="body"
                                  rows={2}
                                  required
                                  maxLength={2000}
                                  className="w-full rounded border border-slate-200 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
                                  placeholder="Write a review comment..."
                                />
                                <PendingSubmitButton
                                  type="submit"
                                  idleLabel="Post Comment"
                                  pendingLabel="Posting..."
                                />
                              </form>
                            </div>
                          </details>
                        </section>
                      );
                    })()}
                    {/* Sprint 2: Change Requests */}
                    {(() => {
                      const crs = changeRequestsByProduct.get(product.id) ?? [];
                      if (crs.length === 0) return null;
                      return (
                        <section aria-label="Change requests" className="mt-2">
                          <details className="rounded-md border border-amber-200 bg-amber-50">
                            <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-amber-800 hover:bg-amber-100">
                              Change Requests ({crs.length})
                            </summary>
                            <div className="border-t border-amber-200 px-3 py-2 space-y-2">
                              {crs.map((cr) => (
                                <div key={cr.id} className="flex items-start justify-between gap-2 text-xs">
                                  <p className="text-slate-700">{cr.reason}</p>
                                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${cr.status === "open" ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"}`}>{cr.status}</span>
                                  {cr.status === "open" && decisionEnabled ? (
                                    <form action={resolveChangeRequestAction}>
                                      <input type="hidden" name="productId" value={product.id} />
                                      <input type="hidden" name="requestId" value={cr.id} />
                                      <button type="submit" className="rounded px-2 py-0.5 text-[10px] font-semibold bg-white border border-emerald-200 text-emerald-700 hover:bg-emerald-50">Resolve</button>
                                    </form>
                                  ) : null}
                                </div>
                              ))}
                              {decisionEnabled ? (
                                <form action={createChangeRequestAction} className="mt-2 space-y-1">
                                  <input type="hidden" name="productId" value={product.id} />
                                  <textarea name="reason" required rows={2} placeholder="Describe required change…" className="w-full rounded border border-amber-200 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-amber-400" />
                                  <button type="submit" className="rounded-md border border-amber-300 bg-white px-2 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-50">Request change</button>
                                </form>
                              ) : null}
                            </div>
                          </details>
                        </section>
                      );
                    })()}
                  </>
                ),
              },
              {
                key: "completenessScore",
                header: "Completeness",
                cellClassName: "text-slate-700",
                mobileHide: true,
                render: (product) => `${product.completenessScore ?? 0}%`,
              },
              {
                key: "issues",
                header: "Open Issues",
                render: (product) => {
                  const summary = issuesByProduct.get(product.id) ?? { blocking: 0, warning: 0 };
                  return (
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
                  );
                },
              },
              {
                key: "revisionEvidence",
                header: "Revision Evidence",
                cellClassName: "align-top",
                mobileHide: true,
                render: (product) => {
                  const revisions = revisionsByProduct.get(product.id) ?? [];
                  const summary = issuesByProduct.get(product.id) ?? { blocking: 0, warning: 0 };
                  const productHref = `/products/${encodeURIComponent(product.id)}?returnTo=${encodeURIComponent(returnTo)}`;
                  const productQualityHref =
                    `/products/${encodeURIComponent(product.id)}?tab=quality&returnTo=${encodeURIComponent(returnTo)}`;
                  return (
                    <ApprovalEvidenceDrawer
                      productTitle={product.title}
                      productHref={productHref}
                      productQualityHref={productQualityHref}
                      blockingCount={summary.blocking}
                      warningCount={summary.warning}
                      revisions={revisions}
                    />
                  );
                },
              },
              {
                key: "updatedAt",
                header: "Updated",
                cellClassName: "text-xs text-slate-500",
                mobileHide: true,
                render: (product) => formatDateTime(product.updatedAt),
              },
              {
                key: "decision",
                header: "Decision",
                render: (product) => {
                  const summary = issuesByProduct.get(product.id) ?? { blocking: 0, warning: 0 };
                  const canApprove = summary.blocking === 0;
                  return decisionEnabled ? (
                    <div className="space-y-2">
                      <form action={decideProductReviewAction} className="space-y-2">
                        <input type="hidden" name="productId" value={product.id} />
                        <input type="hidden" name="returnTo" value={returnTo} />
                        <label className="block space-y-1 text-xs text-slate-600">
                          <span className="font-medium text-slate-700">Reviewer note</span>
                          <textarea
                            name="note"
                            rows={3}
                            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                            placeholder="Capture approval context or rejection rationale."
                          />
                        </label>
                        <div className="flex flex-wrap gap-2">
                          <PendingSubmitButton
                            type="submit"
                            name="status"
                            value="approved"
                            disabled={!canApprove}
                            variant="dark"
                            className="bg-emerald-700 hover:bg-emerald-800 active:bg-emerald-900"
                            idleLabel="Approve"
                            pendingLabel="Approving..."
                          />
                          <PendingSubmitButton
                            type="submit"
                            name="status"
                            value="rejected"
                            className={buttonVariants({ variant: "secondary" })}
                            idleLabel="Reject"
                            pendingLabel="Rejecting..."
                          />
                        </div>
                      </form>
                      {!canApprove ? (
                        <p className="text-xs text-slate-500">Clear blocking issues before approving.</p>
                      ) : null}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-600">Your role can review items here, but not record final decisions.</p>
                  );
                },
              },
            ]}
            rows={inReviewProducts}
            getRowKey={(product) => product.id}
            caption="Review Decisions"
            rowClassName="align-top"
            emptyState={
              <EmptyState
                icon="CHECK"
                title="No products waiting for review decisions"
                description="Products appear here when their workflow status moves to in_review."
                action={{ label: "Back to Quality", href: "/quality" }}
              />
            }
          />
        </Card>

        <Card>
          <CardTitle>Items In Review</CardTitle>
          {approvalQueueRedacted ? (
            <div className="space-y-3">
              <p className="text-sm text-slate-700">
                Approval queue counts are restricted for your role. Reviewers, editors, and admins can view the live
                in-review count here.
              </p>
              <p className="text-sm text-slate-600">
                You can still use Issue Inbox and product detail to investigate quality blockers.
              </p>
            </div>
          ) : stats.pendingApprovals === 0 ? (
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
            <DataGrid
              columns={[
                {
                  key: "product",
                  header: "Product",
                  render: (item) => (
                    <>
                      <p className="font-medium text-slate-900">{item.productName}</p>
                      <p className="text-xs text-slate-500">{item.sku}</p>
                    </>
                  ),
                },
                {
                  key: "productStatus",
                  header: "Status",
                  render: (item) => (
                    <StatusChip
                      label={item.productStatus}
                      tone={item.productStatus === "in_review" ? "warning" : "neutral"}
                    />
                  ),
                },
                {
                  key: "severity",
                  header: "Severity",
                  render: (item) => (
                    <StatusChip
                      label={item.severity}
                      tone={item.severity === "BLOCKING" ? "danger" : "warning"}
                    />
                  ),
                },
                {
                  key: "fieldPath",
                  header: "Field",
                  mobileHide: true,
                  cellClassName: "text-slate-600",
                  render: (item) => item.fieldPath ?? "-",
                },
                {
                  key: "sellerMessage",
                  header: "Message",
                  cellClassName: "text-slate-700",
                },
              ]}
              rows={inbox.items}
              getRowKey={(item) => item.issueId}
              caption="Items In Review"
            />
          )}
        </Card>
      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/quality/approvals", error));
    }
    throw error;
  }
}
