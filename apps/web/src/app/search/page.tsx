import Link from "next/link";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import { searchCatalogProducts } from "@/lib/api/catalog";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";

interface SearchPageProps {
  searchParams: Promise<{
    q?: string;
    page?: string;
  }>;
}

function statusTone(status: string): "success" | "warning" | "info" | "danger" | "neutral" {
  if (status === "approved" || status === "active") return "success";
  if (status === "in_review") return "warning";
  if (status === "rejected") return "danger";
  if (status === "draft") return "info";
  return "neutral";
}

function statusLabel(status: string): string {
  return status.replace(/_/g, " ");
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const { authHeader } = await getServerSession();
  if (!authHeader) redirect(buildLoginRedirect("/search"));

  const params = await searchParams;
  const query = (params.q ?? "").trim();
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);

  const PAGE_SIZE = 20;
  let results: Awaited<ReturnType<typeof searchCatalogProducts>> = [];
  let hasNextPage = false;
  if (query.length > 0) {
    try {
      const raw = await searchCatalogProducts(
        { q: query, limit: PAGE_SIZE + 1, offset: (page - 1) * PAGE_SIZE },
        { authHeader },
      );
      hasNextPage = raw.length > PAGE_SIZE;
      results = hasNextPage ? raw.slice(0, PAGE_SIZE) : raw;
    } catch {
      results = [];
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Search"
        description={
          query
            ? `${results.length} product results for "${query}"`
            : "Search products by title, SKU, category, or matched product metadata"
        }
      />

      <form action="/search" method="GET" className="relative">
        <svg
          className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Search by title, SKU, category, or attribute value…"
          className="w-full rounded-lg border border-slate-200 bg-white py-3 pl-12 pr-4 text-sm shadow-sm outline-none placeholder:text-slate-400 focus:border-blue-500 focus:ring-4 focus:ring-blue-100"
          autoFocus
        />
      </form>

      {query && (
        <>
          <div className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
            Results are product-only in this release. Category, attribute, and connector discovery stay in their dedicated workspaces.
          </div>

          <div className="space-y-3" role="list" aria-label="Search results">
            {results.length === 0 ? (
              <div className="rounded-xl border border-slate-200 bg-white p-8 text-center shadow-sm">
                <p className="text-sm text-slate-600">
                  No results found for &ldquo;{query}&rdquo;. Try a different search term.
                </p>
              </div>
            ) : (
              results.map((result) => (
                <article
                  key={result.id}
                  role="listitem"
                  className="flex items-start gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-lg">
                    {result.matchedSku ? "🔑" : "📦"}
                  </div>
                  <div className="min-w-0 flex-1 space-y-1">
                    <p className="text-sm font-semibold text-slate-900">{result.title}</p>
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="rounded bg-slate-100 px-1.5 py-0.5 font-medium text-slate-600">
                        {result.matchedSku ? "SKU" : "Product"}
                      </span>
                      <StatusChip label={statusLabel(result.status)} tone={statusTone(result.status)} />
                      {result.categoryName && (
                        <span className="text-slate-500">{result.categoryName}</span>
                      )}
                      {result.matchedSku && (
                        <span className="font-mono text-slate-500">SKU: {result.matchedSku}</span>
                      )}
                    </div>
                  </div>
                  <Link
                    href={`/products/${result.id}`}
                    className="shrink-0 text-xs font-semibold text-blue-700 hover:underline"
                  >
                    View →
                  </Link>
                </article>
              ))
            )}
          </div>

          {(page > 1 || hasNextPage) && (
            <nav className="flex items-center justify-center gap-1" aria-label="Search results pages">
              {page > 1 && (
                <Link
                  href={`/search?q=${encodeURIComponent(query)}&page=${page - 1}`}
                  className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  aria-label="Previous page"
                >
                  ← Prev
                </Link>
              )}
              <span className="px-3 py-1.5 text-xs font-medium text-slate-900">Page {page}</span>
              {hasNextPage && (
                <Link
                  href={`/search?q=${encodeURIComponent(query)}&page=${page + 1}`}
                  className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  aria-label="Next page"
                >
                  Next →
                </Link>
              )}
            </nav>
          )}
        </>
      )}
    </div>
  );
}
