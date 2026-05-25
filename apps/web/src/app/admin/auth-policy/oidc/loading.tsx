import { SkeletonBlock, SkeletonHeader } from "@/components/ui/skeleton";

export default function AdminAuthPolicyOidcLoading() {
  return (
    <div className="space-y-6">
      <SkeletonHeader />
      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <SkeletonBlock key={i} className="h-16 w-full" />
        ))}
      </div>
    </div>
  );
}
