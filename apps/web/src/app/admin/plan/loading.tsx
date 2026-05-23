import { SkeletonBlock, SkeletonHeader } from "@/components/ui/skeleton";

export default function AdminPlanLoading() {
  return (
    <div className="space-y-6">
      <SkeletonHeader />
      <div className="grid gap-4 md:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonBlock key={i} className="h-40 w-full" />
        ))}
      </div>
    </div>
  );
}
