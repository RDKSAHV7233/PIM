import Link from "next/link";
import {
  createExportJobAction,
  createMappingTemplateAction,
  processExportJobAction,
  requeueExportJobAction,
} from "@/app/actions";
import { Card, CardTitle } from "@/components/ui/card";
import { DataGrid, type Column } from "@/components/ui/data-grid";
import { Input } from "@/components/ui/input";
import { JsonPreview } from "@/components/ui/json-preview";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { Select } from "@/components/ui/select";
import { StatusChip } from "@/components/ui/status-chip";
import { Textarea } from "@/components/ui/textarea";
import { translateExportStatus } from "@/lib/errors";
import type { ConnectorSubmission } from "@/lib/api";
import {
  lifecycleStatusTone,
  RoleHiddenInput,
  translateReadinessBlocker,
} from "./product-detail-shared";
import type { ProductDetailPageData } from "./product-detail-types";

function submissionStatusTone(status: string): "neutral" | "success" | "warning" | "danger" | "info" {
  const s = String(status ?? "").trim().toUpperCase();
  if (s === "SUCCESS") return "success";
  if (s === "PENDING" || s === "RETRYING") return "warning";
  if (s === "REJECTED" || s === "ERROR" || s === "DEAD_LETTER") return "danger";
  return "neutral";
}

export function ChannelsTab({ data }: { data: ProductDetailPageData }) {
  const latestExportJob = data.exportJobs[0] ?? null;
  const selectedChannelOption =
    data.channels.find((channel) => channel.channel === data.selectedChannel) ?? null;
  type TemplateRow = ProductDetailPageData["templates"][number];
  type ExportJobRow = ProductDetailPageData["exportJobs"][number];
  const templateColumns: Column<TemplateRow>[] = [
    {
      key: "name",
      header: "Template",
      render: (template) => template.name,
    },
    {
      key: "channel",
      header: "Channel",
      render: (template) => <span className="capitalize">{template.channel}</span>,
    },
    {
      key: "default",
      header: "Default",
      render: (template) => (
        <StatusChip
          label={template.isDefault ? "Default" : "Custom"}
          tone={template.isDefault ? "success" : "neutral"}
        />
      ),
    },
    {
      key: "requiredFields",
      header: "Required Fields",
      render: (template) => template.requiredFields.length,
    },
    {
      key: "updatedAt",
      header: "Updated",
      cellClassName: "text-slate-600",
      render: (template) => new Date(template.updatedAt).toLocaleString(),
    },
  ];
  const exportJobColumns: Column<ExportJobRow>[] = [
    {
      key: "id",
      header: "Job",
      cellClassName: "font-mono text-xs text-slate-700",
      render: (job) => job.id,
    },
    {
      key: "channel",
      header: "Channel",
      render: (job) => <span className="capitalize">{job.channel}</span>,
    },
    {
      key: "template",
      header: "Template",
      render: (job) => job.template?.name ?? "-",
    },
    {
      key: "status",
      header: "Status",
      render: (job) => <StatusChip label={translateExportStatus(job.status)} tone={lifecycleStatusTone(job.status)} />,
    },
    {
      key: "retry",
      header: "Retry",
      render: (job) => `${job.retryCount}/${job.maxRetries}`,
    },
    {
      key: "failureReason",
      header: "Failure",
      cellClassName: "text-slate-600",
      render: (job) => job.failureReason ?? "-",
    },
    {
      key: "actions",
      header: "Actions",
      render: (job) => (
        <div className="flex flex-wrap gap-2">
          {data.canWrite ? (
            <form action={processExportJobAction}>
              <RoleHiddenInput role={data.actorRole} />
              <input type="hidden" name="jobId" value={job.id} />
              <input type="hidden" name="productId" value={data.productId} />
              <PendingSubmitButton
                type="submit"
                className="px-2.5 py-1.5 text-xs"
                idleLabel="Process"
                pendingLabel="Processing..."
              />
            </form>
          ) : null}
          {data.canWrite &&
          (job.status === "dead_letter" || job.status === "retrying" || job.status === "failed") ? (
            <form action={requeueExportJobAction}>
              <RoleHiddenInput role={data.actorRole} />
              <input type="hidden" name="jobId" value={job.id} />
              <input type="hidden" name="productId" value={data.productId} />
              <PendingSubmitButton
                type="submit"
                variant="secondary"
                className="px-2.5 py-1.5 text-xs"
                idleLabel="Requeue"
                pendingLabel="Requeueing..."
              />
            </form>
          ) : null}
        </div>
      ),
    },
  ];

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
                  <li key={`readiness-blocker-${blocker}`}>{translateReadinessBlocker(blocker)}</li>
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
          <div className="grid gap-3 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]">
            <div className="rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-700">
              <p className="font-medium text-slate-900">Export confirmation</p>
              <p className="mt-1">
                Queue the export only after mapping, quality, and connector readiness are clear for the selected channel.
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600">
                <li>Channel target: {selectedChannelOption?.displayName ?? data.selectedChannel}</li>
                <li>Installed publish lanes: {data.publishableChannels.length}</li>
                <li>Fallback acknowledgement required: {data.fallbackAckRequired ? "Yes" : "No"}</li>
              </ul>
            </div>
            <div className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
              <p className="font-medium text-slate-900">Latest export result summary</p>
              {latestExportJob ? (
                <div className="mt-2 space-y-2">
                  <StatusChip
                    label={translateExportStatus(latestExportJob.status)}
                    tone={lifecycleStatusTone(latestExportJob.status)}
                  />
                  <p>
                    Most recent channel: <span className="capitalize">{latestExportJob.channel}</span>
                  </p>
                  <p>
                    Retry position: {latestExportJob.retryCount}/{latestExportJob.maxRetries}
                  </p>
                  <p className="text-slate-600">
                    {latestExportJob.failureReason
                      ? `Latest failure: ${latestExportJob.failureReason}`
                      : "No failure recorded on the latest queued export."}
                  </p>
                </div>
              ) : (
                <p className="mt-2 text-slate-600">
                  No export result summary yet. Queue the first export to establish channel history for this product.
                </p>
              )}
            </div>
          </div>
          {data.canWrite && data.publishableChannels.length > 0 ? (
            <form action={createExportJobAction} className="grid gap-3 md:grid-cols-4">
              <RoleHiddenInput role={data.actorRole} />
              <input type="hidden" name="productId" value={data.productId} />
              <input
                type="hidden"
                name="installationId"
                value={data.mappingManagerInstallation?.id ?? ""}
              />
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
                {data.fallbackAckRequired ? (
                  <Select
                    id="export-fallback-ack"
                    name="fallbackAcknowledged"
                    defaultValue="false"
                  >
                    <option value="false">Not acknowledged</option>
                    <option value="true">Acknowledge fallback usage</option>
                  </Select>
                ) : (
                  <>
                    <input type="hidden" name="fallbackAcknowledged" value="true" />
                    <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                      No fallback acknowledgement is required for this export.
                    </p>
                  </>
                )}
              </div>
              <PendingSubmitButton
                type="submit"
                disabled={!data.canQueueExportWithAck}
                idleLabel="Queue channel export"
                pendingLabel="Queueing export..."
              />
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
                <PendingSubmitButton type="submit" idleLabel="Run simulator" pendingLabel="Running simulator..." />
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
                  <JsonPreview value={JSON.stringify(data.simulation.mappedPayload, null, 2)} className="max-h-64 border-border" />
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
              <PendingSubmitButton
                type="submit"
                className="w-fit"
                idleLabel="Save template"
                pendingLabel="Saving template..."
              />
            </form>
          ) : !data.mappingManagerInstallation ? (
            <p className="text-sm text-slate-600">Your role cannot save mapping templates.</p>
          ) : null}

          <details className="rounded-lg border border-slate-200 bg-white">
            <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-slate-800">
              Legacy template inventory (transition only)
            </summary>
            <div className="border-t border-slate-200 rounded-b-lg">
              <div className="p-4">
                <DataGrid
                  columns={templateColumns}
                  rows={data.templates}
                  getRowKey={(template) => template.id}
                  caption="Legacy template inventory"
                  emptyState={
                    <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
                      No mapping templates found for this category and channel.
                    </div>
                  }
                />
              </div>
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
            <div className="border-t border-slate-200 rounded-b-lg">
              <div className="p-4">
                <DataGrid
                  columns={exportJobColumns}
                  rows={data.exportJobs}
                  getRowKey={(job) => job.id}
                  caption="Queued export attempts and recovery"
                  rowClassName="align-top"
                  emptyState={
                    <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
                      No submission jobs created yet. Queue an export job to start channel processing.
                    </div>
                  }
                />
              </div>
            </div>
          </details>
        </div>
      </Card>

      <Card hidden={data.activeTab !== "channels"}>
        <CardTitle>Connector submission history</CardTitle>
        <p className="mb-3 text-sm text-slate-600">
          Connector submissions record the lifecycle of each publish attempt from queue to channel resolution. Use this table to confirm a product reached SUCCESS or to trace retry evidence.
        </p>
        <DataGrid
          columns={
            [
              {
                key: "id",
                header: "Submission",
                cellClassName: "font-mono text-xs text-slate-700",
                render: (s: ConnectorSubmission) => s.id,
              },
              {
                key: "connectorDisplayName",
                header: "Connector",
                render: (s: ConnectorSubmission) => s.connectorDisplayName,
              },
              {
                key: "status",
                header: "Status",
                render: (s: ConnectorSubmission) => (
                  <StatusChip label={String(s.status ?? "").toUpperCase()} tone={submissionStatusTone(s.status)} />
                ),
              },
              {
                key: "attemptNumber",
                header: "Attempt",
                render: (s: ConnectorSubmission) => s.attemptNumber,
              },
              {
                key: "submittedAt",
                header: "Submitted",
                cellClassName: "text-xs text-slate-600",
                render: (s: ConnectorSubmission) => new Date(s.submittedAt).toLocaleString(),
              },
              {
                key: "resolvedAt",
                header: "Resolved",
                cellClassName: "text-xs text-slate-600",
                render: (s: ConnectorSubmission) =>
                  s.resolvedAt ? new Date(s.resolvedAt).toLocaleString() : "—",
              },
            ] as Column<ConnectorSubmission>[]
          }
          rows={data.connectorSubmissions}
          getRowKey={(s) => s.id}
          caption="Connector submission history for this product"
          emptyState={
            <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm text-slate-500">
              No connector submissions yet for this product. Queue a channel export to create the first submission.
            </div>
          }
        />
        {data.connectorSubmissions.length > 0 ? (
          <div className="mt-3">
            <Link
              href="/channels/submissions"
              className="text-sm font-medium text-blue-700 hover:underline"
            >
              View all submissions →
            </Link>
          </div>
        ) : null}
      </Card>
    </>
  );
}
