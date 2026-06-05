export default function Loading() {
  return (
    <div className="space-y-5">
      <div className="h-10 w-48 animate-pulse rounded bg-slate-200" />
      <div className="grid grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg bg-slate-100" />
        ))}
      </div>
      <div className="h-48 animate-pulse rounded-lg bg-slate-100" />
    </div>
  );
}
