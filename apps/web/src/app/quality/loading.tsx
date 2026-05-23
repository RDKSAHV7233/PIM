import { SkeletonBlock, SkeletonHeader, SkeletonTable } from "@/components/ui/skeleton";

export default function QualityLoading() {
  return (
    <div className="space-y-5">
      <SkeletonHeader />
      <div className="flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonBlock key={i} className="h-9 w-28" />
        ))}
      </div>
      <SkeletonTable rows={6} cols={4} />
    </div>
  );
}
