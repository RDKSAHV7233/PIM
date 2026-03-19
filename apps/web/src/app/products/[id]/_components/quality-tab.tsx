import { validateProductAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ValidationIssuePanel } from "@/components/ui/validation-issue-panel";
import { RoleHiddenInput } from "./product-detail-shared";
import type { ProductDetailPageData } from "./product-detail-types";

export function QualityTab({ data }: { data: ProductDetailPageData }) {
  return (
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
  );
}
