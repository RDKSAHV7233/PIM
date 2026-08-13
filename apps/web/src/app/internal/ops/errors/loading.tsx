import { SkeletonBlock, SkeletonHeader, SkeletonTable } from "@/components/ui/skeleton";

export default function InternalOpsErrorsLoading() {
  return (
    <div className="space-y-5">
      <SkeletonHeader />
      <SkeletonBlock className="h-28 w-full" />
      <SkeletonTable rows={8} cols={7} />
    </div>
  );
}
