import { SkeletonBlock, SkeletonHeader } from "@/components/ui/skeleton";

export default function AdminConnectorsLoading() {
  return (
    <div className="space-y-5">
      <SkeletonHeader />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <SkeletonBlock key={i} className="h-24 w-full" />
        ))}
      </div>
    </div>
  );
}
