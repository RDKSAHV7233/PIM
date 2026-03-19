import Link from "next/link";
import { Card, CardTitle } from "@/components/ui/card";
import type { ProductDetailPageData } from "./product-detail-types";

export function MediaTab({ data }: { data: ProductDetailPageData }) {
  return (
    <Card hidden={data.activeTab !== "media"}>
      <CardTitle>Media</CardTitle>
      <p className="text-sm text-slate-600">Use the Media library for uploads, validation checks, and asset linkage.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <Link
          href={`/catalog/media?productId=${encodeURIComponent(data.productId)}`}
          className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Open Media Library
        </Link>
        <Link
          href="/channels/health"
          className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Channel Media Health
        </Link>
      </div>
    </Card>
  );
}
