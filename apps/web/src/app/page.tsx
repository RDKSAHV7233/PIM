import Link from "next/link";
import {
  applyBulkEditAction,
  createAttributeDefinitionAction,
  createBulkImportJobAction,
  createCategoryAction,
  createProductAction,
  processBulkImportRowAction,
  processBulkImportJobAction,
  repairBulkImportRowAction,
  requeueBulkImportDlqAction,
} from "./actions";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  getBulkEditOperations,
  getBulkEditPreview,
  getBulkImportJobRows,
  getBulkImportJobs,
  getCategories,
  getProducts,
  getStats,
} from "@/lib/api";

export const dynamic = "force-dynamic";

interface HomePageProps {
  searchParams: Promise<{
    bulkJobId?: string;
    bulkEditPreview?: string;
    bulkEditCategoryId?: string;
    bulkEditStatus?: string;
    bulkEditBrandContains?: string;
    bulkEditProductIds?: string;
    bulkEditUpdates?: string;
  }>;
}

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

export default async function HomePage({ searchParams }: HomePageProps) {
  const query = await searchParams;
  const [stats, categories, products, bulkImportJobs, bulkEditOperations] = await Promise.all([
    getStats(),
    getCategories(),
    getProducts(),
    getBulkImportJobs(),
    getBulkEditOperations(),
  ]);

  const selectedBulkJobId =
    String(query.bulkJobId ?? "").trim() ||
    bulkImportJobs.find((job) => job.status === "dead_letter" || job.status === "retrying")?.id ||
    "";
  const selectedBulkRows = selectedBulkJobId
    ? await getBulkImportJobRows(selectedBulkJobId, undefined, 200)
    : [];

  const bulkEditCategoryId = String(query.bulkEditCategoryId ?? "").trim();
  const bulkEditStatus = String(query.bulkEditStatus ?? "").trim();
  const bulkEditBrandContains = String(query.bulkEditBrandContains ?? "").trim();
  const bulkEditProductIds = String(query.bulkEditProductIds ?? "").trim();
  const bulkEditUpdatesText =
    String(query.bulkEditUpdates ?? "").trim() || '{"status":"active"}';
  const shouldPreviewBulkEdit = String(query.bulkEditPreview ?? "") === "1";

  let bulkEditPreview: Awaited<ReturnType<typeof getBulkEditPreview>> | null = null;
  let bulkEditPreviewError: string | null = null;

  if (shouldPreviewBulkEdit) {
    try {
      const parsedUpdates = JSON.parse(bulkEditUpdatesText);
      if (!parsedUpdates || typeof parsedUpdates !== "object" || Array.isArray(parsedUpdates)) {
        throw new Error("Bulk edit updates must be a JSON object.");
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
      const productIds = parseList(bulkEditProductIds);
      if (productIds.length > 0) {
        scope.productIds = productIds;
      }

      bulkEditPreview = await getBulkEditPreview(scope, parsedUpdates as Record<string, unknown>);
    } catch (error: unknown) {
      bulkEditPreviewError = error instanceof Error ? error.message : "Bulk edit preview failed.";
    }
  }

  const defaultCsvContent = `Title,Brand,Description,HSN,GSTRate,Attributes
Cotton Shirt,PIM1,Sample row,62046200,18,"{""color"":""black"",""size"":""M""}"`;

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">PIM1 Phase 1-4 Console</h1>
        <p className="text-sm text-slate-600">
          Catalog source of truth with compliance, marketplace intelligence, and bulk import operations.
        </p>
      </header>

      <section className="grid gap-3 md:grid-cols-3">
        <Card>
          <p className="text-xs uppercase text-slate-500">Categories</p>
          <p className="text-2xl font-semibold">{stats.categories}</p>
        </Card>
        <Card>
          <p className="text-xs uppercase text-slate-500">Products</p>
          <p className="text-2xl font-semibold">{stats.products}</p>
        </Card>
        <Card>
          <p className="text-xs uppercase text-slate-500">Variants</p>
          <p className="text-2xl font-semibold">{stats.variants}</p>
        </Card>
      </section>

      <section className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardTitle>Create Category</CardTitle>
          <form action={createCategoryAction} className="space-y-3">
            <Input name="name" placeholder="Category name" required />
            <Select name="parentId" defaultValue="">
              <option value="">No parent</option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.path}
                </option>
              ))}
            </Select>
            <Button type="submit">Create category</Button>
          </form>
        </Card>

        <Card>
          <CardTitle>Create Product</CardTitle>
          <form action={createProductAction} className="space-y-3">
            <Input name="title" placeholder="Product title" required />
            <Input name="brand" placeholder="Brand" />
            <Textarea name="description" rows={3} placeholder="Description" />
            <Input name="hsnCode" placeholder="HSN code (4/6/8 digits)" />
            <Input name="gstRate" type="number" min={0} step="0.01" placeholder="GST rate (e.g. 18)" />
            <Textarea
              name="attributes"
              rows={3}
              placeholder='Product attributes JSON, e.g. {"material":"cotton","fit":"regular"}'
            />
            <Select name="categoryId" required defaultValue="">
              <option value="" disabled>
                Select category
              </option>
              {categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.path}
                </option>
              ))}
            </Select>
            <Select name="status" defaultValue="draft">
              <option value="draft">draft</option>
              <option value="active">active</option>
              <option value="archived">archived</option>
            </Select>
            <Button type="submit">Create product</Button>
          </form>
        </Card>
      </section>

      <Card>
        <CardTitle>Create Category Attribute Definition</CardTitle>
        <form action={createAttributeDefinitionAction} className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <Select name="categoryId" required defaultValue="">
            <option value="" disabled>
              Select category
            </option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.path}
              </option>
            ))}
          </Select>
          <Input name="name" placeholder="Display name (e.g. Fabric Type)" required />
          <Input name="key" placeholder="Key (e.g. fabric_type)" required />
          <Select name="dataType" defaultValue="text">
            <option value="text">text</option>
            <option value="number">number</option>
            <option value="boolean">boolean</option>
            <option value="select">select</option>
            <option value="json">json</option>
          </Select>
          <Select name="required" defaultValue="true">
            <option value="true">required</option>
            <option value="false">optional</option>
          </Select>
          <Select name="appliesTo" defaultValue="product">
            <option value="product">product</option>
            <option value="variant">variant</option>
          </Select>
          <Textarea
            name="allowedValues"
            rows={2}
            className="md:col-span-2 lg:col-span-3"
            placeholder='Allowed values JSON array, e.g. ["cotton","silk"]'
          />
          <Button type="submit" className="w-fit">
            Add attribute definition
          </Button>
        </form>
      </Card>

      <Card>
        <CardTitle>Bulk Edit Products (Phase 4)</CardTitle>
        <form method="get" className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <input type="hidden" name="bulkEditPreview" value="1" />
          {selectedBulkJobId && <input type="hidden" name="bulkJobId" value={selectedBulkJobId} />}
          <Select name="bulkEditCategoryId" defaultValue={bulkEditCategoryId}>
            <option value="">All categories</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.path}
              </option>
            ))}
          </Select>
          <Select name="bulkEditStatus" defaultValue={bulkEditStatus}>
            <option value="">All statuses</option>
            <option value="draft">draft</option>
            <option value="active">active</option>
            <option value="archived">archived</option>
          </Select>
          <Input
            name="bulkEditBrandContains"
            defaultValue={bulkEditBrandContains}
            placeholder="Brand contains (optional)"
          />
          <Textarea
            name="bulkEditProductIds"
            rows={2}
            className="md:col-span-2 lg:col-span-3"
            defaultValue={bulkEditProductIds}
            placeholder="Optional product ids (comma or newline separated)"
          />
          <Textarea
            name="bulkEditUpdates"
            rows={4}
            className="md:col-span-2 lg:col-span-3"
            defaultValue={bulkEditUpdatesText}
            placeholder='Updates JSON, e.g. {"status":"active","gstRate":18}'
          />
          <Button type="submit" className="w-fit">
            Preview affected products
          </Button>
        </form>

        {shouldPreviewBulkEdit && (
          <div className="mt-4 space-y-3">
            {bulkEditPreviewError && <p className="text-sm text-red-600">{bulkEditPreviewError}</p>}
            {bulkEditPreview && (
              <>
                <p className="text-sm text-slate-600">
                  Preview matched <strong>{bulkEditPreview.requestedCount}</strong> products.
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-sm">
                    <thead className="text-xs uppercase text-slate-500">
                      <tr>
                        <th className="py-2">Product</th>
                        <th className="py-2">Brand</th>
                        <th className="py-2">Status</th>
                        <th className="py-2">HSN</th>
                        <th className="py-2">GST</th>
                      </tr>
                    </thead>
                    <tbody>
                      {bulkEditPreview.sample.map((product) => (
                        <tr key={product.id} className="border-t border-border">
                          <td className="py-2">
                            <Link href={`/products/${product.id}`}>{product.title}</Link>
                          </td>
                          <td className="py-2">{product.brand || "-"}</td>
                          <td className="py-2">{product.status}</td>
                          <td className="py-2">{product.hsnCode || "-"}</td>
                          <td className="py-2">{product.gstRate ?? "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {bulkEditPreview.requestedCount > 0 && (
                  <form action={applyBulkEditAction} className="space-y-2">
                    <input type="hidden" name="categoryId" value={bulkEditCategoryId} />
                    <input type="hidden" name="status" value={bulkEditStatus} />
                    <input type="hidden" name="brandContains" value={bulkEditBrandContains} />
                    <input type="hidden" name="productIds" value={bulkEditProductIds} />
                    <input type="hidden" name="updates" value={bulkEditUpdatesText} />
                    <Button type="submit">Apply bulk edit</Button>
                  </form>
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
                  <td className="py-2 capitalize">{operation.status}</td>
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

      <Card>
        <CardTitle>Bulk Import Job (Phase 4)</CardTitle>
        <form action={createBulkImportJobAction} className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <Select name="categoryId" required defaultValue="">
            <option value="" disabled>
              Select category
            </option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.path}
              </option>
            ))}
          </Select>
          <Select name="sourceFormat" defaultValue="csv">
            <option value="csv">csv</option>
            <option value="json">json</option>
          </Select>
          <Input name="sourceName" placeholder="Source file name (optional)" />
          <Input name="chunkSize" type="number" min={1} max={500} defaultValue={100} placeholder="Chunk size" />
          <Input name="maxRetries" type="number" min={1} max={10} defaultValue={3} placeholder="Max retries" />
          <div />
          <Textarea
            name="mapping"
            rows={6}
            className="md:col-span-2 lg:col-span-3"
            placeholder="Optional JSON mapping. Leave empty for smart auto-suggest by headers."
          />
          <Textarea
            name="csvContent"
            rows={6}
            className="md:col-span-2 lg:col-span-3"
            defaultValue={defaultCsvContent}
            placeholder="CSV content for sourceFormat=csv"
          />
          <Textarea
            name="rowsJson"
            rows={4}
            className="md:col-span-2 lg:col-span-3"
            placeholder='JSON rows for sourceFormat=json, e.g. [{"title":"Item 1","brand":"PIM1"}]'
          />
          <Button type="submit" className="w-fit">
            Create bulk import job
          </Button>
        </form>
      </Card>

      <Card>
        <CardTitle>Bulk Import Jobs</CardTitle>
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
                <th className="py-2">DLQ</th>
                <th className="py-2">Chunk</th>
                <th className="py-2">Actions</th>
              </tr>
            </thead>
            <tbody>
              {bulkImportJobs.map((job) => (
                <tr key={job.id} className="border-t border-border">
                  <td className="py-2 font-mono text-xs">{job.id}</td>
                  <td className="py-2">{job.sourceFormat}</td>
                  <td className="py-2">{job.category?.path ?? job.categoryId}</td>
                  <td className="py-2 capitalize">{job.status}</td>
                  <td className="py-2">
                    {job.processedRows}/{job.totalRows}
                  </td>
                  <td className="py-2">{job.successRows}</td>
                  <td className="py-2">{job.deadLetterRows}</td>
                  <td className="py-2">{job.chunkSize}</td>
                  <td className="py-2">
                    <div className="flex gap-2">
                      <Link href={`/?bulkJobId=${job.id}`} className="inline-flex items-center rounded-md border border-border px-3 py-2">
                        View rows
                      </Link>
                      <form action={processBulkImportJobAction}>
                        <input type="hidden" name="jobId" value={job.id} />
                        <input type="hidden" name="chunkSize" value={job.chunkSize} />
                        <Button type="submit">Process chunk</Button>
                      </form>
                      {job.status === "dead_letter" && (
                        <form action={requeueBulkImportDlqAction}>
                          <input type="hidden" name="jobId" value={job.id} />
                          <input type="hidden" name="limit" value={100} />
                          <Button type="submit">Requeue DLQ</Button>
                        </form>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {selectedBulkJobId && (
        <Card>
          <CardTitle>Bulk Import Row Repair Console ({selectedBulkJobId})</CardTitle>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px] text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2">Row</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Retry</th>
                  <th className="py-2">Error</th>
                  <th className="py-2">Payload Repair</th>
                  <th className="py-2">Actions</th>
                </tr>
              </thead>
              <tbody>
                {selectedBulkRows.map((row) => (
                  <tr key={row.id} className="border-t border-border align-top">
                    <td className="py-2">{row.rowNumber}</td>
                    <td className="py-2 capitalize">{row.status}</td>
                    <td className="py-2">{row.retryCount}</td>
                    <td className="py-2">{row.errorMessage ?? "-"}</td>
                    <td className="py-2">
                      <form action={repairBulkImportRowAction} className="space-y-2">
                        <input type="hidden" name="jobId" value={selectedBulkJobId} />
                        <input type="hidden" name="rowId" value={row.id} />
                        <Textarea name="payload" rows={4} defaultValue={JSON.stringify(row.payload, null, 2)} />
                        <Select name="requeue" defaultValue="true">
                          <option value="true">repair + requeue</option>
                          <option value="false">repair only</option>
                        </Select>
                        <Button type="submit">Save repair</Button>
                      </form>
                    </td>
                    <td className="py-2">
                      <form action={processBulkImportRowAction}>
                        <input type="hidden" name="jobId" value={selectedBulkJobId} />
                        <input type="hidden" name="rowId" value={row.id} />
                        <Button type="submit">Process row now</Button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <Card>
        <CardTitle>Categories</CardTitle>
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
              {categories.map((category) => (
                <tr key={category.id} className="border-t border-border">
                  <td className="py-2">{category.name}</td>
                  <td className="py-2">{category.path}</td>
                  <td className="py-2">{category.slug}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardTitle>Products</CardTitle>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2">Title</th>
                <th className="py-2">Brand</th>
                <th className="py-2">HSN</th>
                <th className="py-2">GST %</th>
                <th className="py-2">Category</th>
                <th className="py-2">Status</th>
                <th className="py-2">Variants</th>
                <th className="py-2">Validation Issues</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id} className="border-t border-border">
                  <td className="py-2">
                    <Link href={`/products/${product.id}`}>{product.title}</Link>
                  </td>
                  <td className="py-2">{product.brand || "-"}</td>
                  <td className="py-2">{product.hsnCode || "-"}</td>
                  <td className="py-2">{product.gstRate ?? "-"}</td>
                  <td className="py-2">{product.category?.path ?? product.categoryId}</td>
                  <td className="py-2">{product.status}</td>
                  <td className="py-2">{product.variants?.length ?? 0}</td>
                  <td className="py-2">{product.validationIssues?.length ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
