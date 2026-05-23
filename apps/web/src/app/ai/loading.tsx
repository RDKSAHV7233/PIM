import { SkeletonBlock, SkeletonHeader } from "@/components/ui/skeleton";

export default function AiLoading() {
  return (
    <div className="space-y-5">
      <SkeletonHeader />
      <SkeletonBlock className="h-48 w-full" />
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonBlock key={i} className="h-12 w-full" />
        ))}
      </div>
    </div>
  );
}
