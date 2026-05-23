import { SkeletonBlock, SkeletonHeader, SkeletonTable } from "@/components/ui/skeleton";

export default function BulkEditLoading() {
  return (
    <div className="space-y-5">
      <SkeletonHeader />
      <SkeletonBlock className="h-10 w-full max-w-sm" />
      <SkeletonTable rows={10} cols={6} />
      <SkeletonBlock className="h-10 w-36" />
    </div>
  );
}
