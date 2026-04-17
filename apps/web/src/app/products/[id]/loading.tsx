export default function ProductDetailLoading() {
  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div className="h-8 w-64 animate-pulse rounded bg-slate-100" />
        <div className="h-4 w-96 animate-pulse rounded bg-slate-100" />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        {Array.from({ length: 8 }).map((_, index) => (
          <div key={index} className="h-9 w-full animate-pulse rounded bg-slate-100" />
        ))}
      </div>
      <div className="h-72 w-full animate-pulse rounded bg-slate-100" />
    </div>
  );
}
