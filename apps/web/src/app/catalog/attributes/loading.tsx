import { SkeletonBlock, SkeletonHeader, SkeletonTable } from "@/components/ui/skeleton";

export default function AttributesLoading() {
  return (
    <div className="space-y-5">
      <SkeletonHeader />
      <SkeletonBlock className="h-10 w-full max-w-sm" />
      <SkeletonTable rows={6} cols={4} />
    </div>
  );
}
