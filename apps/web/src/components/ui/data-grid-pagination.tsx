// CTO review remediation (UX-004): DataGrid itself has no sort/search/
// pagination — every consumer that needs pagination hand-rolls it. This
// extracts the page-number pagination UI that apps/web/src/components/
// product/products-tab.tsx built for offset-based catalog pagination
// (added in f39faefc) so other DataGrid consumers can reuse the same
// look/behavior instead of re-implementing page-number math and ellipsis
// truncation from scratch.
//
// This component is presentational only — it does not own URL state. The
// caller passes `onNavigate(page)` and decides how "page" maps to a URL
// (query param name, other params to preserve, router vs Link). That part
// is genuinely page-specific and isn't worth abstracting away.

interface DataGridPaginationProps {
  totalCount: number;
  currentPage: number;
  pageSize: number;
  onNavigate: (page: number) => void;
}

export function DataGridPagination({ totalCount, currentPage, pageSize, onNavigate }: DataGridPaginationProps) {
  const totalPages = totalCount > 0 ? Math.ceil(totalCount / pageSize) : 0;
  if (totalPages <= 1) {
    return null;
  }

  const pages: (number | "...")[] = [1];
  if (currentPage > 3) pages.push("...");
  for (let i = Math.max(2, currentPage - 1); i <= Math.min(totalPages - 1, currentPage + 1); i++) {
    pages.push(i);
  }
  if (currentPage < totalPages - 2) pages.push("...");
  if (totalPages > 1) pages.push(totalPages);

  return (
    <div className="flex items-center justify-between border-t border-slate-200 px-4 py-3">
      <button
        type="button"
        disabled={currentPage <= 1}
        onClick={() => onNavigate(currentPage - 1)}
        className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Previous
      </button>
      <div className="flex items-center gap-1">
        {pages.map((p, i) =>
          p === "..." ? (
            <span key={`ellipsis-${i}`} className="px-2 text-sm text-slate-400">...</span>
          ) : p === currentPage ? (
            <span key={p} className="inline-flex h-8 w-8 items-center justify-center rounded-md bg-slate-900 text-sm font-medium text-white">
              {p}
            </span>
          ) : (
            <button
              key={p}
              type="button"
              onClick={() => onNavigate(p)}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-sm text-slate-700 hover:bg-slate-100"
            >
              {p}
            </button>
          ),
        )}
        <span className="ml-2 text-xs text-slate-400">of {totalPages}</span>
      </div>
      <button
        type="button"
        disabled={currentPage >= totalPages}
        onClick={() => onNavigate(currentPage + 1)}
        className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        Next
      </button>
    </div>
  );
}
