import Link from "next/link";
import {
  createExportJobAction,
  createMappingTemplateAction,
  processExportJobAction,
  requeueExportJobAction,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { StatusChip } from "@/components/ui/status-chip";
import { Textarea } from "@/components/ui/textarea";
import { translateExportStatus } from "@/lib/errors";
import { lifecycleStatusTone, RoleHiddenInput } from "./product-detail-shared";
import type { ProductDetailPageData } from "./product-detail-types";

export function ChannelsTab({ data }: { data: ProductDetailPageData }) {
  return (
    <>
      <Card hidden={data.activeTab !== "channels"}>
        <CardTitle>Channel readiness and queued exports</CardTitle>
        <div className="space-y-4">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <p className="font-medium text-slate-900">Queue readiness</p>
            <p className="mt-1">
              <span className={data.readiness.ok ? "text-emerald-700" : "text-red-700"}>
                {data.readiness.ok ? "Ready to queue export" : "Blocked until fixes are complete"}
              </span>
            </p>
            {data.readinessBlockers.length > 0 ? (
              <ul className="mt-2 list-disc pl-5">
                {data.readinessBlockers.map((blocker) => (
                  <li key={`readiness-blocker-${blocker}`}>{blocker}</li>
                ))}
              </ul>
            ) : (
              <p className="mt-2 text-xs text-slate-500">No preflight blockers for queued export.</p>
            )}
            {data.readinessWarnings.length > 0 ? (
              <ul className="mt-2 list-disc pl-5 text-xs text-slate-600">
                {data.readinessWarnings.map((warning) => (
                  <li key={`readiness-warning-${warning}`}>{warning}</li>
                ))}
              </ul>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              <Link
                href={`/channels/mappings?categoryId=${encodeURIComponent(data.product.categoryId)}&channel=${encodeURIComponent(data.selectedChannel)}&productId=${encodeURIComponent(data.productId)}`}
                className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Fix mapping
              </Link>
              <Link
                href={data.tabHref("quality")}
                className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Review quality blockers
              </Link>
            </div>
          </div>
          {data.canWrite && data.publishableChannels.length > 0 ? (
            <form action={createExportJobAction} className="grid gap-3 md:grid-cols-4">
              <RoleHiddenInput role={data.actorRole} />
              <input type="hidden" name="productId" value={data.productId} />
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="export-channel">
                  Channel
                </label>
                <Select id="export-channel" name="channel" defaultValue={data.defaultExportChannel}>
                  {data.publishableChannels.map((channel) => (
                    <option key={channel.channel} value={channel.channel}>
                      {channel.displayName}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="export-template-id">
                  Mapping
                </label>
                <Select id="export-template-id" name="templateId" defaultValue={data.selectedTemplateId ?? ""}>
                  <option value="">Live mapping</option>
                  {data.templates.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                      {template.isDefault ? " (default)" : ""}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="export-max-retries">
                  Max Retries
                </label>
                <Input id="export-max-retries" name="maxRetries" type="number" min={1} max={10} defaultValue={3} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="export-fallback-ack">
                  Fallback confirmation
                </label>
                <Select
                  id="export-fallback-ack"
                  name="fallbackAcknowledged"
                  defaultValue={data.fallbackAckRequired ? "false" : "true"}
                >
                  <option value="false">Not acknowledged</option>
                  <option value="true">Acknowledge fallback usage</option>
                </Select>
              </div>
              <Button type="submit" disabled={!data.canQueueExportWithAck}>
                Queue channel export
              </Button>
            </form>
          ) : data.canWrite ? (
            <p className="text-sm text-slate-600">
              No installed connector with publish capability is available for this tenant.
            </p>
          ) : (
            <p className="text-sm text-slate-600">Your role cannot queue export jobs.</p>
          )}
          <details className="rounded-lg border border-slate-200 bg-white">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-slate-800">
              Advanced channel diagnostics
            </summary>
            <div className="space-y-3 border-t border-slate-200 px-4 py-4">
              <form method="get" className="flex max-w-xl items-end gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-xs uppercase text-slate-500" htmlFor="simulator-channel">
                    Channel
                  </label>
                  <Select id="simulator-channel" name="channel" defaultValue={data.selectedChannel}>
                    {data.channels.map((channel) => (
                      <option key={channel.channel} value={channel.channel}>
                        {channel.displayName}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-xs uppercase text-slate-500" htmlFor="simulator-template-id">
                    Mapping
                  </label>
                  <Select id="simulator-template-id" name="templateId" defaultValue={data.selectedTemplateId ?? ""}>
                    <option value="">Live mapping</option>
                    {data.templates.map((template) => (
                      <option key={template.id} value={template.id}>
                        {template.name}
                        {template.isDefault ? " (default)" : ""}
                      </option>
                    ))}
                  </Select>
                </div>
                <Button type="submit">Run simulator</Button>
              </form>

              <div className="grid gap-3 md:grid-cols-4">
                <div className="rounded-md border border-border p-3">
                  <p className="text-xs uppercase text-slate-500">Export Ready</p>
                  <p className="text-lg font-semibold">{data.simulation.exportReady ? "Yes" : "No"}</p>
                </div>
                <div className="rounded-md border border-border p-3">
                  <p className="text-xs uppercase text-slate-500">Risk Score</p>
                  <p className="text-lg font-semibold">
                    {data.simulation.riskScore} ({data.simulation.riskBand})
                  </p>
                </div>
                <div className="rounded-md border border-border p-3">
                  <p className="text-xs uppercase text-slate-500">Missing Required Fields</p>
                  <p className="text-lg font-semibold">{data.simulation.missingFields.length}</p>
                </div>
                <div className="rounded-md border border-border p-3">
                  <p className="text-xs uppercase text-slate-500">Compliance (Errors/Warnings)</p>
                  <p className="text-lg font-semibold">
                    {data.simulation.complianceSummary.errorCount}/{data.simulation.complianceSummary.warningCount}
                  </p>
                </div>
              </div>
              <p className="text-sm text-slate-600">
                Mapping source: {data.simulation.mappingSource}
                {data.simulation.templateName ? ` (${data.simulation.templateName})` : ""}
              </p>

              <div className="grid gap-3 lg:grid-cols-2">
                <div>
                  <p className="mb-2 text-xs uppercase text-slate-500">Missing Fields</p>
                  {data.simulation.missingFields.length > 0 ? (
                    <ul className="list-disc space-y-1 pl-5 text-sm">
                      {data.simulation.missingFields.map((field) => (
                        <li key={field}>{field}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-slate-600">No required field gaps for this channel.</p>
                  )}
                </div>
                <div>
                  <p className="mb-2 text-xs uppercase text-slate-500">Mapped Payload Preview</p>
                  <pre className="max-h-64 overflow-auto rounded-md border border-border bg-slate-50 p-3 text-xs">
                    {JSON.stringify(data.simulation.mappedPayload, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          </details>
        </div>
      </Card>

      <Card hidden={data.activeTab !== "channels"}>
        <CardTitle>{data.mappingManagerInstallation ? "Channel Mapping" : "Channel Mapping Templates"}</CardTitle>
        <div className="space-y-3">
          {data.mappingManagerInstallation ? (
            <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <p className="font-medium text-slate-900">Lifecycle mapping manager is the canonical edit path for this connector.</p>
              <p className="text-xs text-slate-500">
                Use the channel mapping workspace to fix live mapping blockers. Legacy templates remain below as reference-only transition inventory.
              </p>
              <Link
                href={`/channels/mappings?categoryId=${encodeURIComponent(data.product.categoryId)}&channel=${encodeURIComponent(data.selectedChannel)}&productId=${encodeURIComponent(data.productId)}`}
                className="inline-flex rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100"
              >
                Open channel mapping workspace
              </Link>
            </div>
          ) : null}
          {!data.mappingManagerInstallation && data.canWrite ? (
            <form action={createMappingTemplateAction} className="grid gap-3 md:grid-cols-2">
              <RoleHiddenInput role={data.actorRole} />
              <input type="hidden" name="productId" value={data.productId} />
              <input type="hidden" name="categoryId" value={data.product.categoryId} />
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="template-name">
                  Template Name
                </label>
                <Input id="template-name" name="name" required />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="template-channel">
                  Channel
                </label>
                <Select id="template-channel" name="channel" defaultValue={data.selectedChannel}>
                  {data.channels.map((channel) => (
                    <option key={channel.channel} value={channel.channel}>
                      {channel.displayName}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="template-required-fields">
                  Required Fields
                </label>
                <Textarea id="template-required-fields" name="requiredFields" rows={4} defaultValue={data.requiredFieldsDefault} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="template-field-map">
                  Field Mapping
                </label>
                <Textarea id="template-field-map" name="fieldMap" rows={4} defaultValue={data.fieldMapDefault} />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="template-default">
                  Default Template
                </label>
                <Select id="template-default" name="isDefault" defaultValue="false">
                  <option value="false">save as non-default</option>
                  <option value="true">save as default</option>
                </Select>
              </div>
              <div />
              <Button type="submit" className="w-fit">
                Save template
              </Button>
            </form>
          ) : !data.mappingManagerInstallation ? (
            <p className="text-sm text-slate-600">Your role cannot save mapping templates.</p>
          ) : null}

          <details className="rounded-lg border border-slate-200 bg-white">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-slate-800">
              Legacy template inventory (transition only)
            </summary>
            <div className="overflow-x-auto border-t border-slate-200 rounded-b-lg">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Template</th>
                    <th className="px-3 py-2">Channel</th>
                    <th className="px-3 py-2">Default</th>
                    <th className="px-3 py-2">Required Fields</th>
                    <th className="px-3 py-2">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {data.templates.length > 0 ? (
                    data.templates.map((template) => (
                      <tr key={template.id} className="border-t border-slate-200 hover:bg-slate-50/50">
                        <td className="px-3 py-2.5">{template.name}</td>
                        <td className="px-3 py-2.5 capitalize">{template.channel}</td>
                        <td className="px-3 py-2.5">
                          <StatusChip
                            label={template.isDefault ? "Default" : "Custom"}
                            tone={template.isDefault ? "success" : "neutral"}
                          />
                        </td>
                        <td className="px-3 py-2.5">{template.requiredFields.length}</td>
                        <td className="px-3 py-2.5 text-slate-600">{new Date(template.updatedAt).toLocaleString()}</td>
                      </tr>
                    ))
                  ) : (
                    <tr className="border-t border-slate-200">
                      <td className="px-3 py-6 text-sm text-slate-500" colSpan={5}>
                        No mapping templates found for this category and channel.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      </Card>

      <Card hidden={data.activeTab !== "channels"}>
        <CardTitle>Queued export attempts and recovery</CardTitle>
        <div className="space-y-3">
          <details className="rounded-lg border border-slate-200 bg-white">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-slate-800">
              View queued export attempts and recovery actions
            </summary>
            <div className="overflow-x-auto border-t border-slate-200 rounded-b-lg">
              <table className="w-full min-w-[960px] text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Job</th>
                    <th className="px-3 py-2">Channel</th>
                    <th className="px-3 py-2">Template</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Retry</th>
                    <th className="px-3 py-2">Failure</th>
                    <th className="px-3 py-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.exportJobs.length > 0 ? (
                    data.exportJobs.map((job) => (
                      <tr key={job.id} className="border-t border-slate-200 hover:bg-slate-50/50">
                        <td className="px-3 py-2.5 font-mono text-xs text-slate-700">{job.id}</td>
                        <td className="px-3 py-2.5 capitalize">{job.channel}</td>
                        <td className="px-3 py-2.5">{job.template?.name ?? "-"}</td>
                        <td className="px-3 py-2.5">
                          <StatusChip label={translateExportStatus(job.status)} tone={lifecycleStatusTone(job.status)} />
                        </td>
                        <td className="px-3 py-2.5">
                          {job.retryCount}/{job.maxRetries}
                        </td>
                        <td className="max-w-[260px] px-3 py-2.5 text-slate-600">{job.failureReason ?? "-"}</td>
                        <td className="px-3 py-2.5">
                          <div className="flex flex-wrap gap-2">
                            {data.canWrite ? (
                              <form action={processExportJobAction}>
                                <RoleHiddenInput role={data.actorRole} />
                                <input type="hidden" name="jobId" value={job.id} />
                                <input type="hidden" name="productId" value={data.productId} />
                                <Button type="submit" className="px-2.5 py-1.5 text-xs">
                                  Process
                                </Button>
                              </form>
                            ) : null}
                            {data.canWrite &&
                            (job.status === "dead_letter" || job.status === "retrying" || job.status === "failed") ? (
                              <form action={requeueExportJobAction}>
                                <RoleHiddenInput role={data.actorRole} />
                                <input type="hidden" name="jobId" value={job.id} />
                                <input type="hidden" name="productId" value={data.productId} />
                                <Button type="submit" variant="secondary" className="px-2.5 py-1.5 text-xs">
                                  Requeue
                                </Button>
                              </form>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr className="border-t border-slate-200">
                      <td className="px-3 py-6 text-sm text-slate-500" colSpan={7}>
                        No submission jobs created yet. Queue an export job to start channel processing.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </details>
        </div>
      </Card>
    </>
  );
}
