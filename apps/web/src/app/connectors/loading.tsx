import { SkeletonBlock, SkeletonHeader } from "@/components/ui/skeleton";

export default function ConnectorsLoading() {
  return (
    <div className="space-y-5">
      <SkeletonHeader />
      <div className="grid gap-4 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <SkeletonBlock key={index} className="h-64 w-full" />
        ))}
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <SkeletonBlock key={index} className="h-72 w-full" />
        ))}
      </div>
    </div>
  );
}
