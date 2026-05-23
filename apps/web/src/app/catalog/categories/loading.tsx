import { SkeletonBlock, SkeletonHeader, SkeletonTable } from "@/components/ui/skeleton";

export default function CategoriesLoading() {
  return (
    <div className="space-y-5">
      <SkeletonHeader />
      <SkeletonTable rows={6} cols={3} />
      <SkeletonBlock className="h-8 w-36" />
    </div>
  );
}
