import { SkeletonBlock, SkeletonHeader, SkeletonTable } from "@/components/ui/skeleton";

export default function ChannelConnectorDetailLoading() {
  return (
    <div className="space-y-5">
      <SkeletonHeader />
      <SkeletonBlock className="h-12 w-full" />
      <SkeletonTable rows={5} cols={3} />
    </div>
  );
}
