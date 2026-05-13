import { SkeletonTable } from "@/components/ui/skeleton";

export default function CatalogProductsLoading() {
  return <SkeletonTable rows={8} cols={1} />;
}
