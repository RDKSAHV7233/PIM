import Link from "next/link";
import { redirect } from "next/navigation";
import { applyBulkEditAction } from "@/app/actions";
import { BulkEditDiffPreview } from "@/components/bulk-edit/bulk-edit-diff-preview";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { DataGrid, type Column } from "@/components/ui/data-grid";
import { Input } from "@/components/ui/input";
import { JsonPreview } from "@/components/ui/json-preview";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  ApiHttpError,
  getBulkEditOperations,
  getBulkEditPreview,
  getCategoryTree,
  getProducts,
  getBillingPlanProfile,
} from "@/lib/api";
import { PageHeader } from "@/components/ui/page-header";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { extractErrorCode, translateError, translateJobStatus } from "@/lib/errors";
import { canEditWorkspace } from "@/lib/role-capabilities";
import { getServerSession } from "@/lib/server-session";
import { filterTestData } from "@/lib/test-data-filter";

export const dynamic = "force-dynamic";

interface OperationsBulkEditPageProps {
  searchParams: Promise<{
    hideTestData?: string;
    bulkEditPreview?: string;
    bulkEditMode?: string;
    bulkEditCategoryId?: string;
    bulkEditStatus?: string;
    bulkEditBrandContains?: string;
    bulkEditProductIds?: string;
    bulkEditField?: string;
    bulkEditOperation?: string;
    bulkEditValue?: string;
    bulkEditUpdates?: string;
  }>;
}

const STRUCTURED_BULK_EDIT_FIELDS = [
  { value: "status", label: "Status", placeholder: "Choose the next catalog status." },
  { value: "brand", label: "Brand", placeholder: "Set the product brand." },
  { value: "title", label: "Title", placeholder: "Set the product title." },
  { value: "description", label: "Description", placeholder: "Set the product description." },
  { value: "hsnCode", label: "HSN Code", placeholder: "Set or clear the HSN code." },
  { value: "gstRate", label: "GST Rate", placeholder: "Set or clear the GST rate." },
] as const;

type StructuredBulkEditField = (typeof STRUCTURED_BULK_EDIT_FIELDS)[number]["value"];
type StructuredBulkEditOperation = "set" | "clear";

function isStructuredBulkEditField(value: string): value is StructuredBulkEditField {
  return STRUCTURED_BULK_EDIT_FIELDS.some((field) => field.value === value);
}

function resolveStructuredBulkEditField(value: string | undefined): StructuredBulkEditField {
  const normalized = String(value ?? "").trim();
  return isStructuredBulkEditField(normalized) ? normalized : "status";
}

function resolveStructuredBulkEditOperation(value: string | undefined): StructuredBulkEditOperation {
  return String(value ?? "").trim().toLowerCase() === "clear" ? "clear" : "set";
}

function fieldLabel(field: StructuredBulkEditField): string {
  return STRUCTURED_BULK_EDIT_FIELDS.find((item) => item.value === field)?.label ?? field;
}

function buildStructuredBulkEditUpdates(
  field: StructuredBulkEditField,
  operation: StructuredBulkEditOperation,
  value: string,
): Record<string, unknown> {
  if (operation === "clear") {
    if (field !== "hsnCode" && field !== "gstRate") {
      throw new Error("Clear is only available for HSN Code and GST Rate.");
    }
    return { [field]: null };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${fieldLabel(field)} is required for a set operation.`);
  }

  if (field === "status") {
    const normalized = trimmed.toLowerCase();
    if (!["draft", "in_review", "approved", "rejected", "active", "archived"].includes(normalized)) {
      throw new Error("Status must be draft, in_review, approved, rejected, active, or archived.");
    }
    return { status: normalized };
  }

  if (field === "gstRate") {
    const numericValue = Number(trimmed);
    if (!Number.isFinite(numericValue) || numericValue < 0) {
      throw new Error("GST Rate must be a non-negative number.");
    }
    return { gstRate: numericValue };
  }

  return { [field]: trimmed };
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
  const { authHeader, actorRole } = await getServerSession();
  const canWrite = canEditWorkspace(actorRole);

  const bulkEditCategoryId = String(query.bulkEditCategoryId ?? "").trim();
  const bulkEditStatus = String(query.bulkEditStatus ?? "").trim();
  const bulkEditBrandContains = String(query.bulkEditBrandContains ?? "").trim();
  const bulkEditProductIds = String(query.bulkEditProductIds ?? "").trim();
  const bulkEditMode = String(query.bulkEditMode ?? "").trim().toLowerCase() === "advanced" ? "advanced" : "structured";
  const bulkEditField = resolveStructuredBulkEditField(query.bulkEditField);
  const bulkEditOperation = resolveStructuredBulkEditOperation(query.bulkEditOperation);
  const bulkEditValue = String(query.bulkEditValue ?? "").trim() || (bulkEditField === "status" ? "active" : "");
  const advancedBulkEditUpdatesText = String(query.bulkEditUpdates ?? "").trim() || '{"status":"active"}';
  const shouldPreviewBulkEdit = String(query.bulkEditPreview ?? "") === "1";
  let structuredUpdatesText = '{"status":"active"}';

  try {
    structuredUpdatesText = JSON.stringify(
      buildStructuredBulkEditUpdates(bulkEditField, bulkEditOperation, bulkEditValue),
      null,
      2,
    );
  } catch {
    if (bulkEditField === "status" && bulkEditOperation === "set" && !bulkEditValue) {
      structuredUpdatesText = JSON.stringify({ status: "active" }, null, 2);
    }
  }

  const bulkEditUpdatesText = bulkEditMode === "advanced" ? advancedBulkEditUpdatesText : structuredUpdatesText;

  try {
    const planProfile = await getBillingPlanProfile({ role: actorRole, authHeader });
    const planTier = String(planProfile.planTier ?? "TRIAL").toUpperCase();

    if (planTier === "TRIAL" || planTier === "STARTER") {
      return (
        <div className="space-y-5">
          <PageHeader
            title="Bulk Edit"
            description="Apply a single field change across many products at once."
            breadcrumb={
              <>
                Dashboard / Operations / <span className="font-semibold text-slate-700">Bulk Edit</span>
              </>
            }
          />
          <Card>
            <CardTitle>Plan Upgrade Required</CardTitle>
            <p className="mt-2 text-sm text-slate-600">
              Bulk edit is available on the Growth plan and above. Upgrade to apply field changes across
              hundreds of products at once with full history and rollback support.
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

    const [operations, categories, products] = await Promise.all([
      getBulkEditOperations(100, { role: actorRole, authHeader }),
      getCategoryTree({ all: true }, { role: actorRole, authHeader, revalidateSeconds: 60 }),
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
    let previewErrorMessage: string | null = null;
    let parsedUpdates: Record<string, unknown> = {};
    const operationColumns: Column<(typeof operations)[number]>[] = [
      { key: "operation", header: "Operation", render: (operation) => <span className="font-mono text-xs">{operation.id}</span> },
      { key: "status", header: "Status", render: (operation) => translateJobStatus(operation.status) },
      { key: "requested", header: "Requested", render: (operation) => operation.requestedCount },
      { key: "applied", header: "Applied", render: (operation) => operation.appliedCount },
      { key: "failed", header: "Failed", render: (operation) => operation.failedCount },
      { key: "updates", header: "Updates", render: (operation) => <span className="text-xs">{JSON.stringify(operation.updates)}</span> },
    ];

    if (shouldPreviewBulkEdit) {
      try {
        if (bulkEditMode === "advanced") {
          const parsed = JSON.parse(bulkEditUpdatesText);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("Bulk edit updates must be a JSON object.");
          }
          parsedUpdates = parsed as Record<string, unknown>;
        } else {
          parsedUpdates = buildStructuredBulkEditUpdates(bulkEditField, bulkEditOperation, bulkEditValue);
        }

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
        previewErrorMessage = error instanceof Error ? error.message : String(error ?? "");
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
              <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4 md:col-span-2 lg:col-span-3">
                <div>
                  <p className="text-sm font-semibold text-slate-900">Structured change builder</p>
                  <p className="mt-1 text-xs text-slate-500">
                    Default to field + operation changes here. Advanced JSON stays secondary for uncommon edits.
                  </p>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="space-y-1">
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="bulk-edit-field">
                      Field
                    </label>
                    <Select id="bulk-edit-field" name="bulkEditField" defaultValue={bulkEditField}>
                      {STRUCTURED_BULK_EDIT_FIELDS.map((field) => (
                        <option key={field.value} value={field.value}>
                          {field.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="bulk-edit-operation">
                      Operation
                    </label>
                    <Select id="bulk-edit-operation" name="bulkEditOperation" defaultValue={bulkEditOperation}>
                      <option value="set">Set value</option>
                      <option value="clear">Clear value</option>
                    </Select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="bulk-edit-value">
                      New value
                    </label>
                    {bulkEditField === "status" && bulkEditOperation === "set" ? (
                      <Select id="bulk-edit-value" name="bulkEditValue" defaultValue={bulkEditValue}>
                        <option value="draft">draft</option>
                        <option value="in_review">in_review</option>
                        <option value="approved">approved</option>
                        <option value="rejected">rejected</option>
                        <option value="active">active</option>
                        <option value="archived">archived</option>
                      </Select>
                    ) : (
                      <Input
                        id="bulk-edit-value"
                        name="bulkEditValue"
                        defaultValue={bulkEditOperation === "clear" ? "" : bulkEditValue}
                        disabled={bulkEditOperation === "clear"}
                        placeholder={
                          bulkEditOperation === "clear"
                            ? "Clear sets the field to blank/null."
                            : STRUCTURED_BULK_EDIT_FIELDS.find((field) => field.value === bulkEditField)?.placeholder
                        }
                      />
                    )}
                  </div>
                </div>
                <div className="rounded-md border border-slate-200 bg-white p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Generated update payload</p>
                  <JsonPreview value={structuredUpdatesText} className="mt-2 border-0 bg-transparent p-0" />
                </div>
                <Button type="submit" className="w-fit" name="bulkEditMode" value="structured">
                  Preview affected products
                </Button>
              </div>
              <div className="space-y-1 md:col-span-2 lg:col-span-3">
                <details className="rounded-lg border border-slate-200 bg-white">
                  <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-slate-800">
                    Advanced JSON mode
                  </summary>
                  <div className="space-y-3 border-t border-slate-200 px-4 py-4">
                    <p className="text-xs text-slate-500">
                      Use raw JSON only when the structured builder does not fit the change you need.
                    </p>
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="bulk-edit-updates">
                      Updates JSON
                    </label>
                    <Textarea
                      id="bulk-edit-updates"
                      name="bulkEditUpdates"
                      rows={4}
                      defaultValue={advancedBulkEditUpdatesText}
                      placeholder='e.g. {"status":"active","gstRate":18}'
                    />
                    <Button type="submit" variant="secondary" className="w-fit" name="bulkEditMode" value="advanced">
                      Preview advanced JSON changes
                    </Button>
                  </div>
                </details>
              </div>
            </form>
          ) : (
            <p className="mt-2 text-sm text-slate-600">Your role cannot run or apply bulk edits.</p>
          )}

          {shouldPreviewBulkEdit ? (
            <div className="mt-4 space-y-3">
              {previewErrorCode || previewErrorMessage ? (
                <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  <p className="font-medium">
                    {previewErrorCode ? translateError(previewErrorCode).title : "Bulk edit preview could not run"}
                  </p>
                  <p>{previewErrorCode ? translateError(previewErrorCode).description : previewErrorMessage}</p>
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
            <DataGrid
              columns={operationColumns}
              rows={operations.slice(0, 50)}
              getRowKey={(operation) => operation.id}
              rowClassName="align-top"
            />
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
