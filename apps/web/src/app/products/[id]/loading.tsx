import { SkeletonBlock, SkeletonHeader, SkeletonTable } from "@/components/ui/skeleton";

export default function ProductDetailLoading() {
  return (
    <div className="space-y-5">
      <SkeletonHeader />
      <SkeletonTable rows={1} cols={8} />
      <SkeletonBlock className="h-72 w-full" />
    </div>
  );
}
