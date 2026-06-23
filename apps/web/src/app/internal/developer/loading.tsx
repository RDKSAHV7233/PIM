import { SkeletonBlock, SkeletonHeader } from "@/components/ui/skeleton";

export default function InternalDeveloperLoading() {
  return (
    <div className="space-y-5">
      <SkeletonHeader />
      <SkeletonBlock className="h-32 w-full" />
      <SkeletonBlock className="h-48 w-full" />
      <SkeletonBlock className="h-32 w-full" />
    </div>
  );
}
