import Link from "next/link";
import { SideRailCard } from "@/components/ui/side-rail-card";
import { StatusChip } from "@/components/ui/status-chip";
import type { ProductDetailPageData } from "./product-detail-types";

export function ProductDetailSideRail({ data }: { data: ProductDetailPageData }) {
  const connectorBlocked = !data.mappingManagerInstallation || data.mappingManagerInstallation.status !== "ACTIVE";
  const mediaBlocked = data.imageAssetCount === 0;

  return (
    <aside className="space-y-3 xl:sticky xl:top-24 xl:h-fit">
      <SideRailCard title="Completeness">
        <p className="text-2xl font-semibold text-slate-900">{data.product.completenessScore ?? 0}%</p>
        <p className="text-xs text-slate-500">Status: {data.product.status}</p>
      </SideRailCard>
      <SideRailCard title="Blocking Issues">
        <p>{data.blockingIssueCount} quality blockers</p>
        <p>{data.warningIssueCount} warnings</p>
        <p>{data.readinessBlockers.length} mapping blockers</p>
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
        <p className="text-xs text-slate-500">
          {connectorBlocked ? "Connector account needs attention." : "Connector account is ready."}
        </p>
      </SideRailCard>
      <SideRailCard title="Publish diagnosis">
        <div className="space-y-2 text-sm text-slate-700">
          <p>Quality: {data.blockingIssueCount > 0 ? "blocked" : "clear"}</p>
          <p>Mapping: {data.readinessBlockers.length > 0 ? "blocked" : "clear"}</p>
          <p>Media: {mediaBlocked ? "missing assets" : `${data.imageAssetCount} images linked`}</p>
          <p>Connector: {connectorBlocked ? "needs attention" : "ready"}</p>
        </div>
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
