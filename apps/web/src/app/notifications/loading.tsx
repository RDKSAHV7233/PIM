import { SkeletonBlock, SkeletonHeader, SkeletonTable } from "@/components/ui/skeleton";

export default function NotificationsLoading() {
  return (
    <div className="space-y-5">
      <SkeletonHeader />
      <SkeletonTable rows={6} cols={3} />
    </div>
  );
}
