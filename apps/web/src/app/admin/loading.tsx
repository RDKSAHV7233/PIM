import { SkeletonBlock, SkeletonHeader } from "@/components/ui/skeleton";

export default function AdminLoading() {
  return (
    <div className="space-y-5">
      <SkeletonHeader />
      <SkeletonBlock className="h-16 w-full" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonBlock key={i} className="h-28 w-full" />
        ))}
      </div>
    </div>
  );
}
