import { SkeletonBlock, SkeletonHeader, SkeletonTable } from "@/components/ui/skeleton";

export default function ChannelsMappingsLoading() {
  return (
    <div className="space-y-5">
      <SkeletonHeader />
      <SkeletonBlock className="h-24 w-full" />
      <SkeletonBlock className="h-32 w-full" />
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_380px]">
        <div className="space-y-4">
          <SkeletonTable rows={5} cols={4} />
          <SkeletonBlock className="h-40 w-full" />
        </div>
        <div className="space-y-4">
          <SkeletonBlock className="h-40 w-full" />
          <SkeletonBlock className="h-40 w-full" />
          <SkeletonBlock className="h-40 w-full" />
        </div>
      </div>
    </div>
  );
}
