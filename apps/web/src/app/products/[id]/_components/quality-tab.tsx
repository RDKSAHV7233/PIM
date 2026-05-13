import { decideProductReviewAction, updateProductAction, validateProductAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { ValidationIssuePanel } from "@/components/ui/validation-issue-panel";
import { canDecideApproval } from "@/lib/role-capabilities";
import { RoleHiddenInput } from "./product-detail-shared";
import type { ProductDetailPageData } from "./product-detail-types";

export function QualityTab({ data }: { data: ProductDetailPageData }) {
  const canDecide = canDecideApproval(data.actorRole);
  const status = data.product.status;
  const returnTo = `/products/${encodeURIComponent(data.productId)}?tab=quality`;

  return (
    <>
      {(status === "draft" || status === "rejected") && data.canWrite ? (
        <Card hidden={data.activeTab !== "quality"}>
          <CardTitle>Submit for review</CardTitle>
          <div className="space-y-2">
            <p className="text-sm text-slate-600">
              {status === "rejected"
                ? "Address the reviewer feedback above, then resubmit for another review pass."
                : "Quality blockers are clear. Move this draft forward for reviewer approval."}
            </p>
            <form action={updateProductAction}>
              <RoleHiddenInput role={data.actorRole} />
              <input type="hidden" name="productId" value={data.productId} />
              <input type="hidden" name="title" value={data.product.title} />
              <input type="hidden" name="description" value={data.product.description ?? ""} />
              <input type="hidden" name="brand" value={data.product.brand ?? ""} />
              <input type="hidden" name="categoryId" value={data.product.categoryId} />
              <input type="hidden" name="expectedVersion" value={data.product.version} />
              <input type="hidden" name="attributes" value={JSON.stringify(data.productAttributes)} />
              <input type="hidden" name="status" value="in_review" />
              <input type="hidden" name="currentTab" value="quality" />
              <PendingSubmitButton idleLabel="Submit for review" pendingLabel="Submitting…" />
            </form>
          </div>
        </Card>
      ) : null}

      {status === "in_review" && canDecide ? (
        <Card hidden={data.activeTab !== "quality"}>
          <CardTitle>Review decision</CardTitle>
          <div className="space-y-3">
            <p className="text-sm text-slate-600">
              This product is awaiting a review decision. Approve to allow publishing, or reject with feedback.
            </p>
            <form action={decideProductReviewAction} className="flex flex-wrap gap-2">
              <RoleHiddenInput role={data.actorRole} />
              <input type="hidden" name="productId" value={data.productId} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <input type="hidden" name="status" value="approved" />
              <PendingSubmitButton
                idleLabel="Approve"
                pendingLabel="Approving…"
                className="bg-emerald-700 text-white hover:bg-emerald-800"
              />
            </form>
            <form action={decideProductReviewAction} className="flex flex-wrap gap-2">
              <RoleHiddenInput role={data.actorRole} />
              <input type="hidden" name="productId" value={data.productId} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <input type="hidden" name="status" value="rejected" />
              <PendingSubmitButton
                variant="secondary"
                idleLabel="Reject"
                pendingLabel="Rejecting…"
              />
            </form>
          </div>
        </Card>
      ) : null}

      <Card hidden={data.activeTab !== "quality"}>
        <CardTitle>Compliance Validation</CardTitle>
        <div className="space-y-3">
          {data.canWrite ? (
            <form id="product-validate-form" action={validateProductAction}>
              <RoleHiddenInput role={data.actorRole} />
              <input type="hidden" name="productId" value={data.productId} />
              <Button type="submit">Run validation</Button>
            </form>
          ) : (
            <p className="text-sm text-slate-600">Your role cannot trigger validation.</p>
          )}
          {data.product.validationIssues && data.product.validationIssues.length > 0 ? (
            <ValidationIssuePanel issues={data.product.validationIssues} />
          ) : (
            <EmptyState
              icon="CHECK"
              title="No issues found"
              description="This product passes all compliance and channel checks."
            />
          )}
        </div>
      </Card>
    </>
  );
}
