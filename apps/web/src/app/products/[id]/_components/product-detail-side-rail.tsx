import Link from "next/link";
import { SideRailCard } from "@/components/ui/side-rail-card";
import { StatusChip } from "@/components/ui/status-chip";
import type { ProductDetailPageData } from "./product-detail-types";

export function ProductDetailSideRail({ data }: { data: ProductDetailPageData }) {
  return (
    <aside className="space-y-3 xl:sticky xl:top-24 xl:h-fit">
      <SideRailCard title="Completeness">
        <p className="text-2xl font-semibold text-slate-900">{data.product.completenessScore ?? 0}%</p>
        <p className="text-xs text-slate-500">Status: {data.product.status}</p>
      </SideRailCard>
      <SideRailCard title="Blocking Issues">
        <p>{data.blockingIssueCount} blocking</p>
        <p>{data.warningIssueCount} warnings</p>
        <Link href={data.tabHref("quality")} className="text-sm font-medium text-blue-700 hover:underline">
          Open quality tab
        </Link>
      </SideRailCard>
      <SideRailCard title="Channel Readiness">
        <StatusChip
          label={data.simulation.exportReady ? "Ready" : "Blocked"}
          tone={data.simulation.exportReady ? "success" : "danger"}
        />
        <p className="text-xs text-slate-500">{data.simulation.missingFields.length} required fields missing</p>
      </SideRailCard>
      <SideRailCard title="Next actions">
        <div className="space-y-2 text-sm">
          <Link href={data.tabHref("content")} className="block font-medium text-blue-700 hover:underline">
            Update product content
          </Link>
          <Link href={data.tabHref("quality")} className="block font-medium text-blue-700 hover:underline">
            Fix quality blockers
          </Link>
          <Link href={data.tabHref("channels")} className="block font-medium text-blue-700 hover:underline">
            Review channel readiness
          </Link>
        </div>
      </SideRailCard>
    </aside>
  );
}
