import { SkeletonBlock, SkeletonHeader } from "@/components/ui/skeleton";

export default function CatalogMediaLoading() {
  return (
    <div className="space-y-5">
      <SkeletonHeader />
      <div className="grid gap-4 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        {Array.from({ length: 15 }).map((_, i) => (
          <SkeletonBlock key={i} className="aspect-square w-full" />
        ))}
      </div>
    </div>
  );
}
