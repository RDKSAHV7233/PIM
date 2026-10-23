import Link from "@/components/ui/app-link";
import { redirect } from "next/navigation";
import { createCategoryAction } from "@/app/actions";
import { CategoryDeleteButton } from "@/components/catalog/category-delete-button";
import { Card, CardTitle } from "@/components/ui/card";
import { DataGrid, type Column } from "@/components/ui/data-grid";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { Select } from "@/components/ui/select";
import { ApiHttpError, getCategoryTree } from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { filterTestData } from "@/lib/test-data-filter";
import { getServerSession } from "@/lib/server-session";
import { getCategoryCounts } from "@/lib/api/catalog";

export const dynamic = "force-dynamic";

interface CatalogCategoriesPageProps {
  searchParams: Promise<{
    hideTestData?: string;
    categoryLimit?: string;
    deleteStatus?: string;
    deleteError?: string;
    deletedCategory?: string;
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

function parseLimit(value: string | undefined, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? "").trim(), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

export default async function CatalogCategoriesPage({ searchParams }: CatalogCategoriesPageProps) {
  const query = await searchParams;
  const hideTestData = resolveHideTestData(query.hideTestData);
  const categoryLimit = parseLimit(query.categoryLimit, 100, 25, 2000);
  const deleteStatus = String(query.deleteStatus ?? "").trim();
  const deleteError = String(query.deleteError ?? "").trim();
  const { authHeader, actorRole } = await getServerSession();
  const canAdmin = actorRole === "admin";

  try {
    const [categories, categoryCounts] = await Promise.all([
      getCategoryTree({ all: true }, { role: actorRole, authHeader, revalidateSeconds: 60 }),
      getCategoryCounts({ role: actorRole, authHeader }),
    ]);
    const filteredCategories = filterTestData(categories, hideTestData);
    const visibleCategories = filteredCategories.slice(0, categoryLimit);
    const toggleHref = hideTestData ? "/catalog/categories?hideTestData=false" : "/catalog/categories";
    const showMoreHref = `/catalog/categories?categoryLimit=${categoryLimit + 100}${hideTestData ? "" : "&hideTestData=false"}`;
    const showAllHref = `/catalog/categories?categoryLimit=${filteredCategories.length}${hideTestData ? "" : "&hideTestData=false"}`;

    const countsByCategoryId = new Map(categoryCounts.map((count) => [count.categoryId, count]));

    const returnParams = new URLSearchParams();
    if (query.hideTestData) {
      returnParams.set("hideTestData", query.hideTestData);
    }
    if (query.categoryLimit) {
      returnParams.set("categoryLimit", query.categoryLimit);
    }
    const returnTo = returnParams.toString()
      ? `/catalog/categories?${returnParams.toString()}`
      : "/catalog/categories";
    const categoryColumns: Column<(typeof visibleCategories)[number]>[] = [
      { key: "name", header: "Name", render: (category) => category.name },
      { key: "path", header: "Path", render: (category) => category.path },
      { key: "slug", header: "Slug", render: (category) => category.slug },
      {
        key: "children",
        header: "Children",
        render: (category) => countsByCategoryId.get(category.id)?.childCount ?? 0,
      },
      {
        key: "products",
        header: "Products",
        render: (category) => countsByCategoryId.get(category.id)?.productCount ?? 0,
      },
      ...(canAdmin
        ? [
            {
              key: "actions",
              header: "Actions",
              headerClassName: "text-right",
              cellClassName: "text-right",
              render: (category) => {
                const childCount = countsByCategoryId.get(category.id)?.childCount ?? 0;
                const productCount = countsByCategoryId.get(category.id)?.productCount ?? 0;
                const disabledReason =
                  childCount > 0
                    ? `This category has ${childCount} child ${childCount === 1 ? "category" : "categories"}.`
                    : productCount > 0
                      ? `This category has ${productCount} ${productCount === 1 ? "product" : "products"} assigned.`
                      : null;
                return (
                  <CategoryDeleteButton
                    categoryId={category.id}
                    categoryPath={category.path}
                    disabledReason={disabledReason}
                    returnTo={returnTo}
                  />
                );
              },
            } satisfies Column<(typeof visibleCategories)[number]>,
          ]
        : []),
    ];

    return (
      <div className="space-y-5">
        <PageHeader
          title="Catalog Categories"
          description="Review taxonomy structure and manage category hierarchy."
          breadcrumb={
            <><Link href="/dashboard" className="hover:underline">Dashboard</Link>{" / "}<Link href="/catalog/products" className="hover:underline">Catalog</Link>{" / "}<span className="font-semibold text-slate-700">Categories</span></>
          }
          actions={
            <Link href={toggleHref} className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
              {hideTestData ? "Show test data" : "Hide test data"}
            </Link>
          }
        />

        {deleteStatus === "deleted" ? (
          <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
            Category deleted successfully.
          </div>
        ) : null}
        {deleteError ? (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900">
            Category delete failed: {deleteError}
          </div>
        ) : null}

        <Card>
          <CardTitle>Categories</CardTitle>
          {filteredCategories.length > visibleCategories.length ? (
            <div className="mb-2 flex items-center justify-between text-xs text-slate-600">
              <p>
                Showing {visibleCategories.length} of {filteredCategories.length} categories.
              </p>
              <div className="flex gap-2">
                <Link href={showMoreHref} className="inline-flex items-center rounded-md border border-border px-3 py-2 text-sm">
                  Show 100 more
                </Link>
                <Link href={showAllHref} className="inline-flex items-center rounded-md border border-border px-3 py-2 text-sm">
                  Show all
                </Link>
              </div>
            </div>
          ) : null}
          <DataGrid columns={categoryColumns} rows={visibleCategories} getRowKey={(category) => category.id} />
          {!canAdmin ? <p className="mt-3 text-xs text-slate-400">Category management requires admin access.</p> : null}
        </Card>

        {canAdmin ? (
          <Card>
            <CardTitle>Create Category</CardTitle>
            <form action={createCategoryAction} className="space-y-3" suppressHydrationWarning>
              <div className="space-y-1">
                <label
                  htmlFor="create-category-name"
                  className="text-xs font-semibold uppercase tracking-wide text-slate-600"
                >
                  Category Name
                </label>
                <Input id="create-category-name" name="name" placeholder="e.g. Men's Shirts" required minLength={1} maxLength={120} />
                <p className="text-xs text-slate-500">1–120 characters.</p>
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
              <PendingSubmitButton
                type="submit"
                idleLabel="Create category"
                pendingLabel="Creating category..."
              />
            </form>
          </Card>
        ) : null}
      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/catalog/categories", error));
    }
    throw error;
  }
}
