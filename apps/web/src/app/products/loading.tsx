import { SkeletonBlock, SkeletonHeader, SkeletonTable } from "@/components/ui/skeleton";

export default function ProductsLoading() {
  return (
    <div className="space-y-5">
      <SkeletonHeader />
      <SkeletonTable rows={8} cols={5} />
      <SkeletonBlock className="h-8 w-48" />
    </div>
  );
}
