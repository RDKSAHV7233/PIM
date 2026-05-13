import { SkeletonBlock, SkeletonHeader, SkeletonTable } from "@/components/ui/skeleton";

export default function AdminAuditLoading() {
  return (
    <div className="space-y-5">
      <SkeletonHeader />
      <SkeletonBlock className="h-40 w-full" />
      <SkeletonTable rows={6} cols={6} />
    </div>
  );
}
