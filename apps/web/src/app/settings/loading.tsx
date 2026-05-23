import { SkeletonBlock, SkeletonHeader } from "@/components/ui/skeleton";

export default function SettingsLoading() {
  return (
    <div className="space-y-6">
      <SkeletonHeader />
      <div className="space-y-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <SkeletonBlock key={i} className="h-16 w-full" />
        ))}
      </div>
    </div>
  );
}
