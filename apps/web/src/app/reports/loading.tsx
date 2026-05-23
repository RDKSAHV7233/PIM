import { SkeletonBlock, SkeletonHeader } from "@/components/ui/skeleton";

export default function ReportsLoading() {
  return (
    <div className="space-y-6">
      <SkeletonHeader />
      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonBlock key={i} className="h-32 w-full" />
        ))}
      </div>
    </div>
  );
}
