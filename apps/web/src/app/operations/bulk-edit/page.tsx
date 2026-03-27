import { redirect } from "next/navigation";
import { applyBulkEditAction } from "@/app/actions";
import { BulkEditDiffPreview } from "@/components/bulk-edit/bulk-edit-diff-preview";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  ApiHttpError,
  getBulkEditOperations,
  getBulkEditPreview,
  getCategoryTree,
  getProducts,
} from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { extractErrorCode, translateError, translateJobStatus } from "@/lib/errors";
import { canEditWorkspace } from "@/lib/role-capabilities";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";
import { filterTestData } from "@/lib/test-data-filter";

export const dynamic = "force-dynamic";

interface OperationsBulkEditPageProps {
  searchParams: Promise<{
    hideTestData?: string;
    bulkEditPreview?: string;
    bulkEditCategoryId?: string;
    bulkEditStatus?: string;
    bulkEditBrandContains?: string;
    bulkEditProductIds?: string;
    bulkEditUpdates?: string;
  }>;
}

function resolveHideTestData(value: string | undefined): boolean {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) {
    return true;
  }
  if (normalized === "false" || normalized === "0" || normalized === "off") {
    return false;
  }
  return true;
}

function parseList(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  );
}

export default async function OperationsBulkEditPage({ searchParams }: OperationsBulkEditPageProps) {
  const query = await searchParams;
  const hideTestData = resolveHideTestData(query.hideTestData);
  const authHeader = await getServerAuthHeader();
  const actorRole = await getServerActorRole();
  const canWrite = canEditWorkspace(actorRole);

  const bulkEditCategoryId = String(query.bulkEditCategoryId ?? "").trim();
  const bulkEditStatus = String(query.bulkEditStatus ?? "").trim();
  const bulkEditBrandContains = String(query.bulkEditBrandContains ?? "").trim();
  const bulkEditProductIds = String(query.bulkEditProductIds ?? "").trim();
  const bulkEditUpdatesText = String(query.bulkEditUpdates ?? "").trim() || '{"status":"active"}';
  const shouldPreviewBulkEdit = String(query.bulkEditPreview ?? "") === "1";

  try {
    const [operations, categories, products] = await Promise.all([
      getBulkEditOperations(100, { role: actorRole, authHeader }),
      getCategoryTree({ all: true }, { role: actorRole, authHeader }),
      getProducts({ role: actorRole, authHeader }),
    ]);

    const filteredCategories = filterTestData(categories, hideTestData);
    const filteredProducts = filterTestData(products, hideTestData);

    const scopedProductIds = parseList(bulkEditProductIds);
    const matchedProducts = filteredProducts.filter((product) => {
      if (bulkEditCategoryId && product.categoryId !== bulkEditCategoryId) {
        return false;
      }
      if (bulkEditStatus && product.status !== bulkEditStatus) {
        return false;
      }
      if (bulkEditBrandContains) {
        const brand = String(product.brand ?? "").toLowerCase();
        if (!brand.includes(bulkEditBrandContains.toLowerCase())) {
          return false;
        }
      }
      if (scopedProductIds.length > 0 && !scopedProductIds.includes(product.id)) {
        return false;
      }
      return true;
    });

    const previewProducts = matchedProducts.map((product) => ({
      id: product.id,
      title: product.title,
      description: product.description,
      brand: product.brand,
      status: product.status,
      hsnCode: product.hsnCode,
      gstRate: product.gstRate,
      firstSku: product.variants?.[0]?.skuCode ?? product.id.slice(0, 8),
    }));

    let previewResult: Awaited<ReturnType<typeof getBulkEditPreview>> | null = null;
    let previewErrorCode: string | null = null;
    let parsedUpdates: Record<string, unknown> = {};

    if (shouldPreviewBulkEdit) {
      try {
        const parsed = JSON.parse(bulkEditUpdatesText);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("Bulk edit updates must be a JSON object.");
        }
        parsedUpdates = parsed as Record<string, unknown>;

        const scope: Record<string, unknown> = {};
        if (bulkEditCategoryId) {
          scope.categoryId = bulkEditCategoryId;
        }
        if (bulkEditStatus) {
          scope.status = bulkEditStatus;
        }
        if (bulkEditBrandContains) {
          scope.brandContains = bulkEditBrandContains;
        }
        if (scopedProductIds.length > 0) {
          scope.productIds = scopedProductIds;
        }

        previewResult = await getBulkEditPreview(scope, parsedUpdates, { role: actorRole, authHeader });
      } catch (error: unknown) {
        previewErrorCode = extractErrorCode(error instanceof Error ? error.message : String(error ?? ""));
      }
    }

    return (
      <div className="space-y-5">
        <header className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-xs text-slate-500">
            Dashboard / Operations / <span className="font-semibold text-slate-700">Bulk Edit</span>
          </p>
          <h1 className="text-2xl font-semibold text-slate-900">Operations Bulk Edit</h1>
          <p className="mt-1 text-sm text-slate-600">Run scoped mass updates and review historical operations.</p>
        </header>

        <Card>
          <CardTitle>Bulk Edit Products</CardTitle>
          {canWrite ? (
            <form method="get" className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              <input type="hidden" name="bulkEditPreview" value="1" />
              {!hideTestData ? <input type="hidden" name="hideTestData" value="false" /> : null}
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="bulk-edit-category-id">
                  Category
                </label>
                <Select id="bulk-edit-category-id" name="bulkEditCategoryId" defaultValue={bulkEditCategoryId}>
                  <option value="">All categories</option>
                  {filteredCategories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.path}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="bulk-edit-status">
                  Status
                </label>
                <Select id="bulk-edit-status" name="bulkEditStatus" defaultValue={bulkEditStatus}>
                  <option value="">All statuses</option>
                  <option value="draft">draft</option>
                  <option value="active">active</option>
                  <option value="archived">archived</option>
                </Select>
              </div>
              <div className="space-y-1">
                <label
                  className="text-xs font-semibold uppercase tracking-wide text-slate-600"
                  htmlFor="bulk-edit-brand-contains"
                >
                  Brand Contains
                </label>
                <Input id="bulk-edit-brand-contains" name="bulkEditBrandContains" defaultValue={bulkEditBrandContains} />
              </div>
              <div className="space-y-1 md:col-span-2 lg:col-span-3">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="bulk-edit-product-ids">
                  Product IDs
                </label>
                <Textarea
                  id="bulk-edit-product-ids"
                  name="bulkEditProductIds"
                  rows={2}
                  defaultValue={bulkEditProductIds}
                  placeholder="Optional, comma or newline separated"
                />
              </div>
              <div className="space-y-1 md:col-span-2 lg:col-span-3">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="bulk-edit-updates">
                  Updates
                </label>
                <Textarea
                  id="bulk-edit-updates"
                  name="bulkEditUpdates"
                  rows={4}
                  defaultValue={bulkEditUpdatesText}
                  placeholder='e.g. {"status":"active","gstRate":18}'
                />
              </div>
              <Button type="submit" className="w-fit">
                Preview affected products
              </Button>
            </form>
          ) : (
            <p className="mt-2 text-sm text-slate-600">Your role cannot run or apply bulk edits.</p>
          )}

          {shouldPreviewBulkEdit ? (
            <div className="mt-4 space-y-3">
              {previewErrorCode ? (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  <p className="font-medium">{translateError(previewErrorCode).title}</p>
                  <p>{translateError(previewErrorCode).description}</p>
                </div>
              ) : null}
              {previewResult && canWrite && previewResult.requestedCount > 0 ? (
                <BulkEditDiffPreview
                  actorRole={actorRole}
                  requestedCount={previewResult.requestedCount}
                  products={previewProducts}
                  updates={parsedUpdates}
                  scope={{
                    categoryId: bulkEditCategoryId,
                    status: bulkEditStatus,
                    brandContains: bulkEditBrandContains,
                    productIds: bulkEditProductIds,
                  }}
                  updatesRaw={bulkEditUpdatesText}
                  applyAction={applyBulkEditAction}
                />
              ) : null}
            </div>
          ) : null}
        </Card>

        <Card>
          <CardTitle>Bulk Edit History</CardTitle>
          {operations.length === 0 ? (
            <p className="mt-3 text-sm text-slate-600">No bulk edit operations found yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2">Operation</th>
                    <th className="py-2">Status</th>
                    <th className="py-2">Requested</th>
                    <th className="py-2">Applied</th>
                    <th className="py-2">Failed</th>
                    <th className="py-2">Updates</th>
                  </tr>
                </thead>
                <tbody>
                  {operations.slice(0, 50).map((operation) => (
                    <tr key={operation.id} className="border-t border-border align-top">
                      <td className="py-2 font-mono text-xs">{operation.id}</td>
                      <td className="py-2">{translateJobStatus(operation.status)}</td>
                      <td className="py-2">{operation.requestedCount}</td>
                      <td className="py-2">{operation.appliedCount}</td>
                      <td className="py-2">{operation.failedCount}</td>
                      <td className="py-2 text-xs">{JSON.stringify(operation.updates)}</td>
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
      redirect(buildLoginRedirect("/operations/bulk-edit", error));
    }
    throw error;
  }
}
