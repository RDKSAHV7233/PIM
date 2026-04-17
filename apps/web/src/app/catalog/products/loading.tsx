export default function CatalogProductsLoading() {
  return (
    <div className="space-y-3">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="h-10 w-full animate-pulse rounded bg-slate-100" />
      ))}
    </div>
  );
}
