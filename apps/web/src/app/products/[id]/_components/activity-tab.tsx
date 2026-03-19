import { Card, CardTitle } from "@/components/ui/card";
import { translateExportStatus } from "@/lib/errors";
import type { ProductDetailPageData } from "./product-detail-types";

export function ActivityTab({ data }: { data: ProductDetailPageData }) {
  return (
    <Card hidden={data.activeTab !== "activity"}>
      <CardTitle>Activity</CardTitle>
      {data.recentJobs.length === 0 ? (
        <p className="text-sm text-slate-600">No submission activity yet.</p>
      ) : (
        <ul className="space-y-2">
          {data.recentJobs.map((job) => (
            <li key={job.id} className="rounded-md border border-slate-200 px-3 py-2 text-sm">
              <p className="font-mono text-xs text-slate-700">{job.id}</p>
              <p className="text-slate-600">
                {job.channel} | {translateExportStatus(job.status)} | {new Date(job.updatedAt).toLocaleString()}
              </p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
