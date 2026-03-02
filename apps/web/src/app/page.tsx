import Link from "next/link";
import {
  applyBulkEditAction,
  createBulkImportJobAction,
  createBulkImportTemplateAction,
  createCategoryAction,
  processBulkImportJobAction,
  requeueBulkImportDlqAction,
} from "./actions";
import { BulkEditDiffPreview } from "@/components/bulk-edit/bulk-edit-diff-preview";
import type { HomeTab } from "@/components/nav/PageTabs";
import { PageTabs } from "@/components/nav/PageTabs";
import { ProductsTab } from "@/components/product/products-tab";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { ImportProgress } from "@/components/ui/import-progress";
import { Input } from "@/components/ui/input";
import { RowRepairForm } from "@/components/ui/row-repair-form";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  AppRole,
  getBulkEditOperations,
  getBulkEditPreview,
  getBulkImportJobRows,
  getBulkImportJobs,
  getBulkImportTemplates,
  getCategories,
  getProducts,
  getStats,
  normalizeAppRole,
} from "@/lib/api";
import { extractErrorCode, translateError, translateJobStatus } from "@/lib/errors";
import { filterTestData } from "@/lib/test-data-filter";

export const dynamic = "force-dynamic";

interface HomePageProps {
  searchParams: Promise<{
    role?: string;
    tab?: string;
    bulkJobId?: string;
    bulkEditPreview?: string;
    bulkEditCategoryId?: string;
    bulkEditStatus?: string;
    bulkEditBrandContains?: string;
    bulkEditProductIds?: string;
    bulkEditUpdates?: string;
    tenantKey?: string;
    bulkTemplateId?: string;
    bulkTemplateCategoryId?: string;
    bulkJobStatus?: string;
    categoryLimit?: string;
    importLimit?: string;
    debug?: string;
    hideTestData?: string;
  }>;
}

const HOME_TABS: HomeTab[] = ["products", "import", "bulk-edit", "categories", "developer"];

function parseList(value: string) {
  return Array.from(
    new Set(
      value
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  );
}

function parseLimit(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

function resolveTab(value: string | undefined): HomeTab {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (HOME_TABS.includes(normalized as HomeTab)) {
    return normalized as HomeTab;
  }
  return "products";
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

function RoleHiddenInput({ role }: { role: AppRole }) {
  return <input type="hidden" name="actorRole" value={role} />;
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const apiBaseUrl = process.env.PIM_API_BASE_URL ?? "http://localhost:4000/api";
  const query = await searchParams;
  const actorRole = normalizeAppRole(query.role);
  const activeTab = resolveTab(query.tab);
  const hideTestData = resolveHideTestData(query.hideTestData);
  const debugMode = String(query.debug ?? "").trim() === "true";
  const canWrite = actorRole !== "viewer";
  const canAdmin = actorRole === "admin";

  const bulkJobStatus = String(query.bulkJobStatus ?? "").trim();
  const categoryLimit = parseLimit(query.categoryLimit, 100, 25, 1000);
  const importLimit = parseLimit(query.importLimit, 50, 10, 500);
  const tenantKey = String(query.tenantKey ?? "").trim() || "default";
  const bulkTemplateCategoryId = String(query.bulkTemplateCategoryId ?? "").trim();

  const [stats, categories, products, bulkImportJobs, bulkEditOperations, bulkImportTemplates] = await Promise.all([
    getStats({ role: actorRole }),
    getCategories({ role: actorRole }),
    getProducts({ role: actorRole }),
    getBulkImportJobs({ role: actorRole }),
    getBulkEditOperations(20, { role: actorRole }),
    getBulkImportTemplates(tenantKey, bulkTemplateCategoryId || undefined, { role: actorRole }),
  ]);

  const filteredCategories = filterTestData(categories, hideTestData);
  const filteredProducts = filterTestData(products, hideTestData);
  const filteredBulkImportTemplates = filterTestData(bulkImportTemplates, hideTestData);
  const filteredBulkImportJobs = filterTestData(bulkImportJobs, hideTestData);
  const filteredStats = hideTestData
    ? {
        ...stats,
        categories: filteredCategories.length,
        products: filteredProducts.length,
        variants: filteredProducts.reduce((sum, product) => sum + (product.variants?.length ?? 0), 0),
      }
    : stats;

  const selectedBulkTemplateId = String(query.bulkTemplateId ?? "").trim();
  const selectedBulkTemplate =
    filteredBulkImportTemplates.find((template) => template.id === selectedBulkTemplateId) ?? null;
  const defaultBulkCategoryId = selectedBulkTemplate?.categoryId ?? "";
  const defaultBulkSourceFormat = selectedBulkTemplate?.sourceFormat ?? "csv";
  const defaultBulkChunkSize = selectedBulkTemplate?.chunkSize ?? 100;
  const defaultBulkMaxRetries = selectedBulkTemplate?.maxRetries ?? 3;
  const defaultTemplateMapping = selectedBulkTemplate
    ? JSON.stringify(selectedBulkTemplate.mapping, null, 2)
    : "";

  const selectedBulkJobId =
    String(query.bulkJobId ?? "").trim() ||
    filteredBulkImportJobs.find((job) => job.status === "dead_letter" || job.status === "retrying")?.id ||
    "";
  const selectedBulkRows = selectedBulkJobId
    ? await getBulkImportJobRows(selectedBulkJobId, undefined, 200)
    : [];

  const selectedBulkJob = selectedBulkJobId
    ? filteredBulkImportJobs.find((job) => job.id === selectedBulkJobId) ?? null
    : null;

  const visibleBulkImportJobs =
    bulkJobStatus.length > 0
      ? filteredBulkImportJobs.filter((job) => job.status === bulkJobStatus)
      : filteredBulkImportJobs;
  const visibleBulkImportJobsLimited = visibleBulkImportJobs.slice(0, importLimit);
  const visibleCategoriesLimited = filteredCategories.slice(0, categoryLimit);

  const bulkEditCategoryId = String(query.bulkEditCategoryId ?? "").trim();
  const bulkEditStatus = String(query.bulkEditStatus ?? "").trim();
  const bulkEditBrandContains = String(query.bulkEditBrandContains ?? "").trim();
  const bulkEditProductIds = String(query.bulkEditProductIds ?? "").trim();
  const bulkEditUpdatesText =
    String(query.bulkEditUpdates ?? "").trim() || '{"status":"active"}';
  const shouldPreviewBulkEdit = String(query.bulkEditPreview ?? "") === "1";

  let bulkEditPreview: Awaited<ReturnType<typeof getBulkEditPreview>> | null = null;
  let bulkEditPreviewErrorCode: string | null = null;
  let parsedBulkEditUpdates: Record<string, unknown> = {};

  if (shouldPreviewBulkEdit) {
    try {
      const parsedUpdates = JSON.parse(bulkEditUpdatesText);
      if (!parsedUpdates || typeof parsedUpdates !== "object" || Array.isArray(parsedUpdates)) {
        throw new Error("Bulk edit updates must be a JSON object.");
      }
      parsedBulkEditUpdates = parsedUpdates as Record<string, unknown>;

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
      const productIds = parseList(bulkEditProductIds);
      if (productIds.length > 0) {
        scope.productIds = productIds;
      }

      bulkEditPreview = await getBulkEditPreview(scope, parsedBulkEditUpdates, {
        role: actorRole,
      });
    } catch (error: unknown) {
      bulkEditPreviewErrorCode = extractErrorCode(error instanceof Error ? error.message : String(error ?? ""));
    }
  }

  const scopedBulkEditProductIds = parseList(bulkEditProductIds);

  const filteredBulkEditProducts = filteredProducts.filter((product) => {
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
    if (scopedBulkEditProductIds.length > 0 && !scopedBulkEditProductIds.includes(product.id)) {
      return false;
    }
    return true;
  });

  const bulkEditDiffProducts = filteredBulkEditProducts.map((product) => ({
    id: product.id,
    title: product.title,
    description: product.description,
    brand: product.brand,
    status: product.status,
    hsnCode: product.hsnCode,
    gstRate: product.gstRate,
    firstSku: product.variants?.[0]?.skuCode ?? product.id.slice(0, 8),
  }));

  const defaultCsvContent = `Title,Brand,Description,HSN,GSTRate,Attributes
Cotton Shirt,PIM1,Sample row,62046200,18,"{""color"":""black"",""size"":""M""}"`;

  const buildHref = (overrides: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    params.set("role", actorRole);
    params.set("tab", activeTab);
    Object.entries(query).forEach(([key, raw]) => {
      const value = String(raw ?? "").trim();
      if (value.length > 0) {
        params.set(key, value);
      }
    });
    Object.entries(overrides).forEach(([key, raw]) => {
      const value = String(raw ?? "").trim();
      if (value.length > 0) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
    });
    const encoded = params.toString();
    return encoded ? `/?${encoded}` : "/";
  };

  const tabItems = [
    { id: "products" as const, label: "Products", href: buildHref({ tab: "products" }) },
    { id: "import" as const, label: "Import", href: buildHref({ tab: "import" }) },
    { id: "bulk-edit" as const, label: "Bulk Edit", href: buildHref({ tab: "bulk-edit" }) },
    { id: "categories" as const, label: "Categories", href: buildHref({ tab: "categories" }) },
    { id: "developer" as const, label: "Developer", href: buildHref({ tab: "developer" }) },
  ];

  return (
    <div className="space-y-5">
      <PageTabs activeTab={activeTab} tabs={tabItems} />

      {activeTab === "products" && (
        <ProductsTab
          role={actorRole}
          products={filteredProducts}
          categories={filteredCategories}
          stats={filteredStats}
          hideTestData={hideTestData}
        />
      )}

      {activeTab === "import" && (
        <div className="space-y-5">
          <Card>
            <CardTitle>Bulk Import Templates</CardTitle>
            <form method="get" className="grid gap-3 md:grid-cols-2 lg:grid-cols-4">
              <input type="hidden" name="role" value={actorRole} />
              <input type="hidden" name="tab" value="import" />
              {selectedBulkJobId && <input type="hidden" name="bulkJobId" value={selectedBulkJobId} />}
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="import-template-tenant-key">
                  Tenant Key
                </label>
                <Input
                  id="import-template-tenant-key"
                  name="tenantKey"
                  defaultValue={tenantKey}
                  placeholder="default"
                  aria-label="Tenant key"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="import-template-category-filter">
                  Category
                </label>
                <Select id="import-template-category-filter" name="bulkTemplateCategoryId" defaultValue={bulkTemplateCategoryId}>
                  <option value="">All categories</option>
                  {filteredCategories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.path}
                    </option>
                  ))}
                </Select>
              </div>
              <Button type="submit" className="w-fit" variant="secondary">
                Filter templates
              </Button>
            </form>

            {canWrite ? (
              <form action={createBulkImportTemplateAction} className="mt-4 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                <RoleHiddenInput role={actorRole} />
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="template-tenant-key">
                    Tenant Key
                  </label>
                  <Input id="template-tenant-key" name="tenantKey" defaultValue={tenantKey} placeholder="default" required />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="template-category-id">
                    Category
                  </label>
                  <Select id="template-category-id" name="categoryId" required defaultValue={defaultBulkCategoryId || bulkTemplateCategoryId || ""}>
                    <option value="" disabled>
                      Select category
                    </option>
                    {filteredCategories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.path}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="template-name">
                    Template Name
                  </label>
                  <Input
                    id="template-name"
                    name="name"
                    defaultValue={selectedBulkTemplate?.name ?? ""}
                    placeholder="e.g. Apparel CSV v2"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="template-source-format">
                    Source Format
                  </label>
                  <Select id="template-source-format" name="sourceFormat" defaultValue={defaultBulkSourceFormat}>
                    <option value="csv">csv</option>
                    <option value="json">json</option>
                    <option value="xlsx">xlsx</option>
                    <option value="xls">xls</option>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="template-chunk-size">
                    Chunk Size
                  </label>
                  <Input
                    id="template-chunk-size"
                    name="chunkSize"
                    type="number"
                    min={1}
                    max={500}
                    defaultValue={defaultBulkChunkSize}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="template-max-retries">
                    Max Retries
                  </label>
                  <Input
                    id="template-max-retries"
                    name="maxRetries"
                    type="number"
                    min={1}
                    max={10}
                    defaultValue={defaultBulkMaxRetries}
                  />
                </div>
                <div className="space-y-1 md:col-span-2 lg:col-span-3">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="template-mapping">
                    Template Mapping
                  </label>
                  <Textarea
                    id="template-mapping"
                    name="mapping"
                    rows={4}
                    className="md:col-span-2 lg:col-span-3"
                    defaultValue={defaultTemplateMapping}
                    placeholder='{"title":"product_name","brand":"brand_name"}'
                  />
                </div>
                <Button type="submit" className="w-fit">
                  Save template
                </Button>
              </form>
            ) : (
              <p className="mt-4 text-sm text-slate-600">Viewer role cannot create templates.</p>
            )}

            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[980px] text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2">Template</th>
                    <th className="py-2">Tenant</th>
                    <th className="py-2">Category</th>
                    <th className="py-2">Format</th>
                    <th className="py-2">Version</th>
                    <th className="py-2">Compatibility</th>
                    <th className="py-2">Chunk</th>
                    <th className="py-2">Retries</th>
                    <th className="py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredBulkImportTemplates.map((template) => (
                    <tr key={template.id} className="border-t border-border">
                      <td className="py-2">{template.name}</td>
                      <td className="py-2">{template.tenantKey}</td>
                      <td className="py-2">{template.category?.path ?? template.categoryId}</td>
                      <td className="py-2">{template.sourceFormat}</td>
                      <td className="py-2">v{template.version}</td>
                      <td className="py-2 text-xs">
                        {template.compatibility?.compatible
                          ? "Compatible"
                          : `${template.compatibility?.warnings.length ?? 0} warning(s)`}
                      </td>
                      <td className="py-2">{template.chunkSize}</td>
                      <td className="py-2">{template.maxRetries}</td>
                      <td className="py-2">
                        <Link
                          href={buildHref({
                            tab: "import",
                            tenantKey,
                            bulkTemplateCategoryId: bulkTemplateCategoryId || "",
                            bulkTemplateId: template.id,
                          })}
                          className="inline-flex items-center rounded-md border border-border px-3 py-2"
                        >
                          Load in import form
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <CardTitle>Bulk Import Job</CardTitle>
            {selectedBulkTemplate && (
              <div className="mb-3 space-y-2">
                <p className="text-sm text-slate-600">
                  Loaded template: <strong>{selectedBulkTemplate.name}</strong> v{selectedBulkTemplate.version} (
                  {selectedBulkTemplate.tenantKey})
                </p>
                {selectedBulkTemplate.compatibility &&
                  !selectedBulkTemplate.compatibility.compatible && (
                    <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
                      <p className="font-medium">Compatibility warnings:</p>
                      {selectedBulkTemplate.compatibility.warnings.map((warning, index) => (
                        <p key={`${selectedBulkTemplate.id}-warning-${index}`}>{warning}</p>
                      ))}
                    </div>
                  )}
              </div>
            )}
            {canWrite ? (
              <form action={createBulkImportJobAction} className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                <RoleHiddenInput role={actorRole} />
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="import-job-category-id">
                    Category
                  </label>
                  <Select id="import-job-category-id" name="categoryId" required defaultValue={defaultBulkCategoryId || ""}>
                    <option value="" disabled>
                      Select category
                    </option>
                    {filteredCategories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.path}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="import-job-source-format">
                    Source Format
                  </label>
                  <Select id="import-job-source-format" name="sourceFormat" defaultValue={defaultBulkSourceFormat}>
                    <option value="csv">csv</option>
                    <option value="json">json</option>
                    <option value="xlsx">xlsx</option>
                    <option value="xls">xls</option>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="import-job-source-name">
                    Source File Name
                  </label>
                  <Input
                    id="import-job-source-name"
                    name="sourceName"
                    defaultValue={selectedBulkTemplate?.name ?? ""}
                    placeholder="Optional"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="import-job-chunk-size">
                    Chunk Size
                  </label>
                  <Input
                    id="import-job-chunk-size"
                    name="chunkSize"
                    type="number"
                    min={1}
                    max={500}
                    defaultValue={defaultBulkChunkSize}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="import-job-max-retries">
                    Max Retries
                  </label>
                  <Input
                    id="import-job-max-retries"
                    name="maxRetries"
                    type="number"
                    min={1}
                    max={10}
                    defaultValue={defaultBulkMaxRetries}
                  />
                </div>
                <div className="space-y-1 md:col-span-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="import-job-source-file">
                    Upload File
                  </label>
                  <Input
                    id="import-job-source-file"
                    name="sourceFile"
                    type="file"
                    accept=".csv,.xlsx,.xls,.json"
                    className="md:col-span-2"
                  />
                </div>
                <p className="text-xs text-slate-500">
                  Upload file supports csv/xlsx/xls/json. Uploaded file takes precedence over text inputs.
                </p>
                <div className="space-y-1 md:col-span-2 lg:col-span-3">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="import-job-mapping">
                    Mapping (Optional)
                  </label>
                  <Textarea
                    id="import-job-mapping"
                    name="mapping"
                    rows={6}
                    className="md:col-span-2 lg:col-span-3"
                    defaultValue={defaultTemplateMapping}
                    placeholder="Leave empty for smart auto-suggest by headers."
                  />
                </div>
                <div className="space-y-1 md:col-span-2 lg:col-span-3">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="import-job-csv-content">
                    CSV Content
                  </label>
                  <Textarea
                    id="import-job-csv-content"
                    name="csvContent"
                    rows={6}
                    className="md:col-span-2 lg:col-span-3"
                    defaultValue={defaultCsvContent}
                  />
                </div>
                <div className="space-y-1 md:col-span-2 lg:col-span-3">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="import-job-rows-json">
                    JSON Rows
                  </label>
                  <Textarea
                    id="import-job-rows-json"
                    name="rowsJson"
                    rows={4}
                    className="md:col-span-2 lg:col-span-3"
                    placeholder='e.g. [{"title":"Item 1","brand":"PIM1"}]'
                  />
                </div>
                <Button type="submit" className="w-fit">
                  Create bulk import job
                </Button>
              </form>
            ) : (
              <p className="text-sm text-slate-600">Viewer role cannot create or process bulk import jobs.</p>
            )}
          </Card>

          <Card>
            <CardTitle>Bulk Import Jobs</CardTitle>
            <form method="get" className="mb-3 flex flex-wrap items-end gap-2">
              <input type="hidden" name="role" value={actorRole} />
              <input type="hidden" name="tab" value="import" />
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="import-job-status-filter">
                  Status
                </label>
                <Select id="import-job-status-filter" name="bulkJobStatus" defaultValue={bulkJobStatus}>
                  <option value="">All import statuses</option>
                  <option value="queued">Waiting to start</option>
                  <option value="processing">Importing</option>
                  <option value="retrying">Retrying failed rows</option>
                  <option value="completed">Import complete</option>
                  <option value="dead_letter">Needs attention</option>
                  <option value="failed">Import failed</option>
                </Select>
              </div>
              <Button type="submit" variant="secondary">
                Apply filter
              </Button>
              <Link
                href={buildHref({ tab: "import", bulkJobStatus: "", bulkJobId: "" })}
                className="inline-flex items-center rounded-md border border-border px-3 py-2 text-sm"
              >
                Show all imports
              </Link>
            </form>

            {selectedBulkJob &&
              (selectedBulkJob.status === "queued" ||
                selectedBulkJob.status === "processing" ||
                selectedBulkJob.status === "retrying") && (
                <div className="mb-4">
                  <ImportProgress initialJob={selectedBulkJob} role={actorRole} />
                </div>
              )}

            {filteredBulkImportJobs.length === 0 ? (
              <EmptyState
                icon="📁"
                title="No imports yet"
                description="Upload an Excel or CSV file to import up to 1,000 products at once."
                action={{ label: "Upload your first file", href: buildHref({ tab: "import" }) }}
              />
            ) : visibleBulkImportJobs.length === 0 ? (
              <EmptyState
                icon="✓"
                title="No imports match this filter"
                description=""
                action={{ label: "Show all imports", href: buildHref({ tab: "import", bulkJobStatus: "" }) }}
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] text-left text-sm">
                  <thead className="text-xs uppercase text-slate-500">
                    <tr>
                      <th className="py-2">Job</th>
                      <th className="py-2">Format</th>
                      <th className="py-2">Category</th>
                      <th className="py-2">Status</th>
                      <th className="py-2">Rows</th>
                      <th className="py-2">Success</th>
                      <th className="py-2">Needs Attention</th>
                      <th className="py-2">Chunk</th>
                      <th className="py-2">Checkpoint</th>
                      <th className="py-2">Retries</th>
                      <th className="py-2">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleBulkImportJobsLimited.map((job) => (
                      <tr key={job.id} className="border-t border-border">
                        <td className="py-2 font-mono text-xs">{job.id}</td>
                        <td className="py-2">{job.sourceFormat}</td>
                        <td className="py-2">{job.category?.path ?? job.categoryId}</td>
                        <td className="py-2">{translateJobStatus(job.status)}</td>
                        <td className="py-2">
                          {job.processedRows}/{job.totalRows}
                        </td>
                        <td className="py-2">{job.successRows}</td>
                        <td className="py-2">{job.deadLetterRows}</td>
                        <td className="py-2">{job.chunkSize}</td>
                        <td className="py-2 text-xs">
                          {job.metrics
                            ? `row ${job.metrics.checkpointRow} (${job.metrics.completedChunks}/${job.metrics.estimatedChunks} chunks)`
                            : "-"}
                        </td>
                        <td className="py-2 text-xs">
                          {job.metrics
                            ? `${job.metrics.totalRetryAttempts} attempts (${job.metrics.retryingRows} in retry)`
                            : "-"}
                        </td>
                        <td className="py-2">
                          <div className="flex flex-wrap gap-2">
                            <Link
                              href={buildHref({ tab: "import", bulkJobId: job.id })}
                              className="inline-flex items-center rounded-md border border-border px-3 py-2"
                            >
                              View rows
                            </Link>
                            {debugMode && canWrite && (
                              <form action={processBulkImportJobAction}>
                                <RoleHiddenInput role={actorRole} />
                                <input type="hidden" name="jobId" value={job.id} />
                                <input type="hidden" name="chunkSize" value={job.chunkSize} />
                                <Button type="submit" variant="secondary">
                                  Process next chunk (debug)
                                </Button>
                              </form>
                            )}
                            {canWrite && job.status === "dead_letter" && (
                              <form action={requeueBulkImportDlqAction}>
                                <RoleHiddenInput role={actorRole} />
                                <input type="hidden" name="jobId" value={job.id} />
                                <input type="hidden" name="limit" value={100} />
                                <Button type="submit">Retry failed rows</Button>
                              </form>
                            )}
                            {(job.deadLetterRows > 0 || job.failedRows > 0 || job.status === "retrying") && (
                              <a
                                href={`${apiBaseUrl}/bulk-import/jobs/${job.id}/error-report`}
                                className="inline-flex items-center rounded-md border border-border px-3 py-2 text-sm"
                                target="_blank"
                                rel="noreferrer"
                              >
                                Export errors
                              </a>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {visibleBulkImportJobs.length > visibleBulkImportJobsLimited.length && (
                  <div className="mt-3 flex items-center justify-between text-xs text-slate-600">
                    <p>
                      Showing {visibleBulkImportJobsLimited.length} of {visibleBulkImportJobs.length} import jobs.
                    </p>
                    <div className="flex gap-2">
                      <Link
                        href={buildHref({ tab: "import", importLimit: String(importLimit + 50) })}
                        className="inline-flex items-center rounded-md border border-border px-3 py-2 text-sm"
                      >
                        Show 50 more
                      </Link>
                      <Link
                        href={buildHref({ tab: "import", importLimit: String(visibleBulkImportJobs.length) })}
                        className="inline-flex items-center rounded-md border border-border px-3 py-2 text-sm"
                      >
                        Show all
                      </Link>
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>

          {selectedBulkJobId && (
            <Card>
              <CardTitle>Bulk Import Row Repair ({selectedBulkJobId})</CardTitle>
              {selectedBulkRows.filter((row) => row.status !== "success").length === 0 ? (
                <EmptyState
                  icon="✓"
                  title="No imports match this filter"
                  description=""
                  action={{ label: "Show all imports", href: buildHref({ tab: "import", bulkJobId: "" }) }}
                />
              ) : (
                <div className="space-y-3">
                  {selectedBulkRows
                    .filter((row) => row.status !== "success")
                    .map((row) => {
                      const translatedError = translateError(extractErrorCode(row.errorMessage));
                      return (
                        <div key={row.id} className="rounded-lg border border-slate-200 p-3">
                          <p className="text-sm font-medium text-slate-900">
                            Row {row.rowNumber} | {translateJobStatus(row.status)}
                          </p>
                          <p className="mt-1 text-xs text-slate-600">
                            {translatedError.title} - {translatedError.description}
                          </p>
                          {canWrite ? (
                            <div className="mt-3">
                              <RowRepairForm row={row} jobId={selectedBulkJobId} role={actorRole} />
                            </div>
                          ) : (
                            <p className="mt-2 text-xs text-slate-500">Read-only in viewer role.</p>
                          )}
                        </div>
                      );
                    })}
                </div>
              )}
            </Card>
          )}
        </div>
      )}
      {activeTab === "bulk-edit" && (
        <div className="space-y-5">
          <Card>
            <CardTitle>Bulk Edit Products</CardTitle>
            {canWrite ? (
              <form method="get" className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                <input type="hidden" name="role" value={actorRole} />
                <input type="hidden" name="tab" value="bulk-edit" />
                <input type="hidden" name="bulkEditPreview" value="1" />
                {selectedBulkJobId && <input type="hidden" name="bulkJobId" value={selectedBulkJobId} />}
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
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="bulk-edit-brand-contains">
                    Brand Contains
                  </label>
                  <Input
                    id="bulk-edit-brand-contains"
                    name="bulkEditBrandContains"
                    defaultValue={bulkEditBrandContains}
                    placeholder="Optional"
                  />
                </div>
                <div className="space-y-1 md:col-span-2 lg:col-span-3">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="bulk-edit-product-ids">
                    Product IDs
                  </label>
                  <Textarea
                    id="bulk-edit-product-ids"
                    name="bulkEditProductIds"
                    rows={2}
                    className="md:col-span-2 lg:col-span-3"
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
                    className="md:col-span-2 lg:col-span-3"
                    defaultValue={bulkEditUpdatesText}
                    placeholder='e.g. {"status":"active","gstRate":18}'
                  />
                </div>
                <Button type="submit" className="w-fit">
                  Preview affected products
                </Button>
              </form>
            ) : (
              <p className="text-sm text-slate-600">Viewer role cannot run bulk edit preview or apply.</p>
            )}

            {shouldPreviewBulkEdit && (
              <div className="mt-4 space-y-3">
                {bulkEditPreviewErrorCode && (
                  <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                    <p className="font-medium">{translateError(bulkEditPreviewErrorCode).title}</p>
                    <p>{translateError(bulkEditPreviewErrorCode).description}</p>
                    {translateError(bulkEditPreviewErrorCode).action && (
                      <p>{translateError(bulkEditPreviewErrorCode).action}</p>
                    )}
                  </div>
                )}
                {bulkEditPreview && (
                  <>
                    <p className="text-sm text-slate-600">
                      Preview matched <strong>{bulkEditPreview.requestedCount}</strong> products.
                    </p>
                    {canWrite && bulkEditPreview.requestedCount > 0 && (
                      <BulkEditDiffPreview
                        actorRole={actorRole}
                        requestedCount={bulkEditPreview.requestedCount}
                        products={bulkEditDiffProducts}
                        updates={parsedBulkEditUpdates}
                        scope={{
                          categoryId: bulkEditCategoryId,
                          status: bulkEditStatus,
                          brandContains: bulkEditBrandContains,
                          productIds: bulkEditProductIds,
                        }}
                        updatesRaw={bulkEditUpdatesText}
                        applyAction={applyBulkEditAction}
                      />
                    )}
                  </>
                )}
              </div>
            )}
          </Card>

          <Card>
            <CardTitle>Bulk Edit History</CardTitle>
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
                  {bulkEditOperations.map((operation) => (
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
          </Card>
        </div>
      )}

      {activeTab === "categories" && (
        <div className="space-y-5">
          <Card>
            <CardTitle>Categories</CardTitle>
            {filteredCategories.length > visibleCategoriesLimited.length && (
              <div className="mb-2 flex items-center justify-between text-xs text-slate-600">
                <p>
                  Showing {visibleCategoriesLimited.length} of {filteredCategories.length} categories.
                </p>
                <div className="flex gap-2">
                  <Link
                    href={buildHref({ tab: "categories", categoryLimit: String(categoryLimit + 100) })}
                    className="inline-flex items-center rounded-md border border-border px-3 py-2 text-sm"
                  >
                    Show 100 more
                  </Link>
                  <Link
                    href={buildHref({ tab: "categories", categoryLimit: String(filteredCategories.length) })}
                    className="inline-flex items-center rounded-md border border-border px-3 py-2 text-sm"
                  >
                    Show all
                  </Link>
                </div>
              </div>
            )}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="py-2">Name</th>
                    <th className="py-2">Path</th>
                    <th className="py-2">Slug</th>
                  </tr>
                </thead>
                <tbody>
                  {visibleCategoriesLimited.map((category) => (
                    <tr key={category.id} className="border-t border-border">
                      <td className="py-2">{category.name}</td>
                      <td className="py-2">{category.path}</td>
                      <td className="py-2">{category.slug}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!canAdmin && (
              <p className="mt-3 text-xs text-slate-400">Category management requires admin access.</p>
            )}
          </Card>

          {canAdmin && (
            <Card>
              <CardTitle>Create Category</CardTitle>
              <form action={createCategoryAction} className="space-y-3">
                <RoleHiddenInput role={actorRole} />
                <div className="space-y-1">
                  <label
                    htmlFor="create-category-name"
                    className="text-xs font-semibold uppercase tracking-wide text-slate-600"
                  >
                    Category Name
                  </label>
                  <Input id="create-category-name" name="name" placeholder="e.g. Men's Shirts" required />
                </div>
                <div className="space-y-1">
                  <label
                    htmlFor="create-category-parent"
                    className="text-xs font-semibold uppercase tracking-wide text-slate-600"
                  >
                    Parent Category
                  </label>
                  <Select id="create-category-parent" name="parentId" defaultValue="">
                    <option value="">No parent</option>
                    {filteredCategories.map((category) => (
                      <option key={category.id} value={category.id}>
                        {category.path}
                      </option>
                    ))}
                  </Select>
                </div>
                <Button type="submit">Create category</Button>
              </form>
            </Card>
          )}
        </div>
      )}

      {activeTab === "developer" && (
        <Card>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-slate-500">Internal Tools</p>
          <CardTitle>Internal phase navigation</CardTitle>
          <div className="flex flex-wrap gap-2 text-sm">
            <Link className="rounded-md border border-border px-3 py-2" href={`/media?role=${encodeURIComponent(actorRole)}`}>
              Phase 5 DAM
            </Link>
            <Link className="rounded-md border border-border px-3 py-2" href={`/rejection?role=${encodeURIComponent(actorRole)}`}>
              Phase 6 Intelligence
            </Link>
            <Link className="rounded-md border border-border px-3 py-2" href={`/ondc?role=${encodeURIComponent(actorRole)}`}>
              Phase 7 ONDC
            </Link>
            <Link className="rounded-md border border-border px-3 py-2" href={`/ai?role=${encodeURIComponent(actorRole)}`}>
              Phase 8 AI
            </Link>
          </div>
        </Card>
      )}
    </div>
  );
}
