import { SkeletonBlock, SkeletonTable } from "@/components/ui/skeleton";

export default function PricingSettingsLoading() {
  return (
    <div className="space-y-6 p-6">
      <SkeletonBlock className="h-20 w-full rounded-xl" />
      <SkeletonBlock className="h-8 w-48 rounded" />
      <div className="rounded-xl border border-slate-200 bg-white p-4">
        <SkeletonTable rows={4} cols={5} />
      </div>
    </div>
  );
}
