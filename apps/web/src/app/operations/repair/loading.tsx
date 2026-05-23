import { SkeletonBlock, SkeletonHeader, SkeletonTable } from "@/components/ui/skeleton";

export default function RepairLoading() {
  return (
    <div className="space-y-5">
      <SkeletonHeader />
      <SkeletonTable rows={6} cols={4} />
    </div>
  );
}
