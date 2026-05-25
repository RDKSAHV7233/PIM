import { SkeletonBlock, SkeletonHeader } from "@/components/ui/skeleton";

export default function AdminPrivacyLoading() {
  return (
    <div className="space-y-6">
      <SkeletonHeader />
      <SkeletonBlock className="h-48 w-full" />
    </div>
  );
}
