import { SkeletonBlock, SkeletonHeader, SkeletonTable } from "@/components/ui/skeleton";

export default function AdminApiKeysLoading() {
  return (
    <div className="space-y-5">
      <SkeletonHeader />
      <SkeletonBlock className="h-44 w-full" />
      <SkeletonBlock className="h-40 w-full" />
      <SkeletonTable rows={5} cols={5} />
    </div>
  );
}
