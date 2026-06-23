import { SkeletonBlock, SkeletonHeader } from "@/components/ui/skeleton";

export default function AdminCommercialLoading() {
  return (
    <div className="space-y-5">
      <SkeletonHeader />
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonBlock key={i} className="h-24 w-full" />
        ))}
      </div>
      <SkeletonBlock className="h-64 w-full" />
      <SkeletonBlock className="h-48 w-full" />
    </div>
  );
}
