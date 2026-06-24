export default function SearchLoading() {
  return (
    <div className="space-y-5">
      <div className="space-y-1">
        <div className="h-7 w-24 animate-pulse rounded bg-slate-200" />
        <div className="h-4 w-72 animate-pulse rounded bg-slate-100" />
      </div>
      <div className="h-12 w-full animate-pulse rounded-lg bg-slate-100" />
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-start gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="h-10 w-10 shrink-0 animate-pulse rounded-lg bg-slate-200" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-48 animate-pulse rounded bg-slate-200" />
              <div className="h-3 w-32 animate-pulse rounded bg-slate-100" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
