import { SkeletonBlock, SkeletonHeader, SkeletonTable } from "@/components/ui/skeleton";

export default function CompletenessLoading() {
  return (
    <div className="space-y-5">
      <SkeletonHeader />
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonBlock key={i} className="h-20 w-full" />
        ))}
      </div>
      <SkeletonTable rows={8} cols={4} />
    </div>
  );
}
