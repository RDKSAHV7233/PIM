import { redirect } from "next/navigation";
import { createCategoryAction } from "@/app/actions";
import { CategoryDeleteButton } from "@/components/catalog/category-delete-button";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ApiHttpError, getCategories, getProducts } from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { filterTestData } from "@/lib/test-data-filter";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";

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
  const authHeader = await getServerAuthHeader();
  const actorRole = await getServerActorRole();
  const canAdmin = actorRole === "admin";

  try {
    const [categories, products] = await Promise.all([
      getCategories({ role: actorRole, authHeader }),
      getProducts({ role: actorRole, authHeader }),
    ]);
    const filteredCategories = filterTestData(categories, hideTestData);
    const filteredProducts = filterTestData(products, hideTestData);
    const visibleCategories = filteredCategories.slice(0, categoryLimit);
    const toggleHref = hideTestData ? "/catalog/categories?hideTestData=false" : "/catalog/categories";
    const showMoreHref = `/catalog/categories?categoryLimit=${categoryLimit + 100}${hideTestData ? "" : "&hideTestData=false"}`;
    const showAllHref = `/catalog/categories?categoryLimit=${filteredCategories.length}${hideTestData ? "" : "&hideTestData=false"}`;

    const childCounts = filteredCategories.reduce<Record<string, number>>((acc, category) => {
      if (category.parentId) {
        acc[category.parentId] = (acc[category.parentId] ?? 0) + 1;
      }
      return acc;
    }, {});
    const productCounts = filteredProducts.reduce<Record<string, number>>((acc, product) => {
      acc[product.categoryId] = (acc[product.categoryId] ?? 0) + 1;
      return acc;
    }, {});

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

    return (
      <div className="space-y-5">
        <header className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">Catalog Categories</h1>
              <p className="mt-1 text-sm text-slate-600">
                Review taxonomy structure and manage category hierarchy.
              </p>
            </div>
            <a href={toggleHref} className="rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-700">
              {hideTestData ? "Show test data" : "Hide test data"}
            </a>
          </div>
        </header>

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
                <a href={showMoreHref} className="inline-flex items-center rounded-md border border-border px-3 py-2 text-sm">
                  Show 100 more
                </a>
                <a href={showAllHref} className="inline-flex items-center rounded-md border border-border px-3 py-2 text-sm">
                  Show all
                </a>
              </div>
            </div>
          ) : null}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="py-2">Name</th>
                  <th className="py-2">Path</th>
                  <th className="py-2">Slug</th>
                  <th className="py-2">Children</th>
                  <th className="py-2">Products</th>
                  {canAdmin ? <th className="py-2 text-right">Actions</th> : null}
                </tr>
              </thead>
              <tbody>
                {visibleCategories.map((category) => {
                  const childCount = childCounts[category.id] ?? 0;
                  const productCount = productCounts[category.id] ?? 0;
                  const disabledReason =
                    childCount > 0
                      ? `This category has ${childCount} child ${childCount === 1 ? "category" : "categories"}.`
                      : productCount > 0
                        ? `This category has ${productCount} ${productCount === 1 ? "product" : "products"} assigned.`
                        : null;
                  return (
                  <tr key={category.id} className="border-t border-border">
                    <td className="py-2">{category.name}</td>
                    <td className="py-2">{category.path}</td>
                    <td className="py-2">{category.slug}</td>
                    <td className="py-2">{childCount}</td>
                    <td className="py-2">{productCount}</td>
                    {canAdmin ? (
                      <td className="py-2 text-right">
                        <CategoryDeleteButton
                          categoryId={category.id}
                          categoryPath={category.path}
                          disabledReason={disabledReason}
                          returnTo={returnTo}
                        />
                      </td>
                    ) : null}
                  </tr>
                )})}
              </tbody>
            </table>
          </div>
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
        ) : null}
      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/catalog/categories", error.status));
    }
    throw error;
  }
}
