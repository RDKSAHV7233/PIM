import { redirect } from "next/navigation";
import { createCategoryAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ApiHttpError, getCategories } from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { filterTestData } from "@/lib/test-data-filter";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";

export const dynamic = "force-dynamic";

interface CatalogCategoriesPageProps {
  searchParams: Promise<{
    hideTestData?: string;
    categoryLimit?: string;
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
  const authHeader = await getServerAuthHeader();
  const actorRole = await getServerActorRole();
  const canAdmin = actorRole === "admin";

  try {
    const categories = await getCategories({ role: actorRole, authHeader });
    const filteredCategories = filterTestData(categories, hideTestData);
    const visibleCategories = filteredCategories.slice(0, categoryLimit);
    const toggleHref = hideTestData ? "/catalog/categories?hideTestData=false" : "/catalog/categories";
    const showMoreHref = `/catalog/categories?categoryLimit=${categoryLimit + 100}${hideTestData ? "" : "&hideTestData=false"}`;
    const showAllHref = `/catalog/categories?categoryLimit=${filteredCategories.length}${hideTestData ? "" : "&hideTestData=false"}`;

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
                </tr>
              </thead>
              <tbody>
                {visibleCategories.map((category) => (
                  <tr key={category.id} className="border-t border-border">
                    <td className="py-2">{category.name}</td>
                    <td className="py-2">{category.path}</td>
                    <td className="py-2">{category.slug}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!canAdmin ? <p className="mt-3 text-xs text-slate-400">Category management requires admin access.</p> : null}
        </Card>

        {canAdmin ? (
          <Card>
            <CardTitle>Create Category</CardTitle>
            <form action={createCategoryAction} className="space-y-3">
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
