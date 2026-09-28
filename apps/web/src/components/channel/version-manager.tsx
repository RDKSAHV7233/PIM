import type { ReactNode } from "react";
import {
  archiveConnectorMappingVersionAction,
  publishConnectorMappingVersionAction,
  rollbackConnectorMappingVersionAction,
  setMappingFallbackAcknowledgementAction,
  validateConnectorMappingVersionAction,
} from "@/app/actions";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { StatusChip } from "@/components/ui/status-chip";
import type { AppRole, ConnectorMappingVersion } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import {
  isDefaultMappingLevel,
  presentCompatibilityState,
  presentLifecycleState,
  presentMappingLevel,
  type ProtectedMappingActionKind,
} from "@/lib/channel-mappings";
import { DataGrid, type Column } from "@/components/ui/data-grid";
import { computeVersionOrdinals } from "@/lib/mapping-version-label";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function fallbackAckMessage(version: ConnectorMappingVersion): string | null {
  const ackMessage = asRecord(version.fallbackPolicy).ack_message;
  return typeof ackMessage === "string" && ackMessage.trim().length > 0 ? ackMessage.trim() : null;
}

function describePublishedVersion(version: ConnectorMappingVersion): string {
  return version.id.slice(0, 8);
}

function presentPublishedAt(value: string | null, fallbackValue: string): string {
  const source = value ?? fallbackValue;
  return formatDateTime(source);
}

function presentActor(actorId: string | null | undefined): string {
  const normalized = String(actorId ?? "").trim();
  return normalized.length > 0 ? normalized : "system";
}

function describeRollbackSource(version: ConnectorMappingVersion): string | null {
  const sourceVersionId = String(version.history?.rollback?.metadata?.rollback_source_version_id ?? "").trim();
  return sourceVersionId.length > 0 ? sourceVersionId.slice(0, 8) : null;
}

function VersionHistoryMetadata({ version }: { version: ConnectorMappingVersion }) {
  const entries: string[] = [];
  entries.push(`Saved by ${presentActor(version.history?.created?.actorId ?? version.createdBy)} on ${formatDateTime(version.createdAt)}`);
  if (version.history?.validated) {
    entries.push(`Validated by ${presentActor(version.history.validated.actorId)} on ${formatDateTime(version.history.validated.createdAt)}`);
  }
  if (version.history?.published) {
    entries.push(`Published by ${presentActor(version.history.published.actorId)} on ${formatDateTime(version.history.published.createdAt)}`);
  }
  if (version.history?.archived) {
    entries.push(`Archived by ${presentActor(version.history.archived.actorId)} on ${formatDateTime(version.history.archived.createdAt)}`);
  }
  if (version.history?.rollback) {
    const rollbackSource = describeRollbackSource(version);
    entries.push(
      rollbackSource
        ? `Rolled back from ${rollbackSource} by ${presentActor(version.history.rollback.actorId)} on ${formatDateTime(version.history.rollback.createdAt)}`
        : `Published via rollback by ${presentActor(version.history.rollback.actorId)} on ${formatDateTime(version.history.rollback.createdAt)}`,
    );
  }

  return (
    <div className="mt-2 space-y-1">
      {entries.map((entry) => (
        <p key={entry} className="text-xs text-slate-500">
          {entry}
        </p>
      ))}
    </div>
  );
}

function ProtectedMappingActionForm({
  action,
  actorRole,
  connectorSlug,
  description,
  disabled,
  installationId,
  label,
  open,
  pendingLabel,
  redirectTo,
  versionId,
  children,
}: {
  action: (formData: FormData) => Promise<void>;
  actorRole: AppRole;
  connectorSlug: string;
  description: string;
  disabled: boolean;
  installationId?: string;
  label: string;
  open?: boolean;
  pendingLabel: string;
  redirectTo: string;
  versionId: string;
  children?: ReactNode;
}) {
  if (disabled) {
    return (
      <PendingSubmitButton type="button" variant="secondary" className="text-xs" disabled idleLabel={label} pendingLabel={pendingLabel} />
    );
  }

  return (
    <details className="rounded-md border border-slate-200 bg-slate-50" open={open}>
      <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100">
        {label}
      </summary>
      <form action={action} className="space-y-3 border-t border-slate-200 p-3">
        <input type="hidden" name="connectorSlug" value={connectorSlug} />
        <input type="hidden" name="versionId" value={versionId} />
        <input type="hidden" name="redirectTo" value={redirectTo} />
        {installationId ? <input type="hidden" name="installationId" value={installationId} /> : null}
        <div className="space-y-1">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor={`${label}-${versionId}`}>
            Step-up re-authentication
          </label>
          <Input
            id={`${label}-${versionId}`}
            name="stepUpPassword"
            type="password"
            autoComplete="current-password"
            placeholder="Enter your password"
            required
          />
          <p className="text-xs text-slate-500">{description}</p>
        </div>
        {children}
        <PendingSubmitButton type="submit" className="text-xs" idleLabel={label} pendingLabel={pendingLabel} />
      </form>
    </details>
  );
}

export function VersionManagerCard({
  actorRole,
  canWrite,
  connectorSlug,
  installationId,
  versions,
  redirectTo,
  stepUpAction,
  stepUpVersionId,
  fallbackAcknowledged,
  fallbackAckVersionId,
  fallbackAckError,
}: {
  actorRole: AppRole;
  canWrite: boolean;
  connectorSlug: string;
  installationId?: string;
  versions: ConnectorMappingVersion[];
  redirectTo: string;
  stepUpAction: ProtectedMappingActionKind | "";
  stepUpVersionId: string;
  fallbackAcknowledged: boolean;
  fallbackAckVersionId: string;
  fallbackAckError: string;
}) {
  const draftCount = versions.filter((version) => version.lifecycleState === "draft").length;
  const validatedCount = versions.filter((version) => version.lifecycleState === "validated").length;
  const liveCount = versions.filter((version) => version.lifecycleState === "published").length;
  const publishedVersions = versions
    .filter((version) => version.lifecycleState === "published")
    .sort((left, right) => {
      const leftTime = new Date(left.publishedAt ?? left.updatedAt).getTime();
      const rightTime = new Date(right.publishedAt ?? right.updatedAt).getTime();
      return rightTime - leftTime;
    });
  const activeVersion = publishedVersions[0] ?? null;
  const versionOrdinals = computeVersionOrdinals(versions);
  const columns: Column<ConnectorMappingVersion>[] = [
    {
      key: "version",
      header: "Version",
      cellClassName: "align-top",
      render: (version) => (
        <>
          <p className="font-medium text-slate-900">Version {versionOrdinals.get(version.id) ?? "?"}</p>
          <p className="text-xs text-slate-500">Connector schema {version.connectorDefinitionVersion} · {version.id}</p>
          <p className="text-xs text-slate-500">{presentMappingLevel(version.mappingLevel)}</p>
          <p className="text-xs text-slate-500 md:hidden">Updated {formatDateTime(version.updatedAt)}</p>
          <div className="mt-2 flex flex-wrap gap-2 md:hidden">
            <StatusChip
              label={presentLifecycleState(version.lifecycleState)}
              tone={
                version.lifecycleState === "published"
                  ? "success"
                  : version.lifecycleState === "archived" || version.lifecycleState === "superseded"
                    ? "neutral"
                    : "info"
              }
            />
            <StatusChip
              label={presentCompatibilityState(version.compatibilityState)}
              tone={
                version.compatibilityState === "blocked"
                  ? "danger"
                  : version.compatibilityState === "deprecated" || version.compatibilityState === "remap_required"
                    ? "warning"
                    : "success"
              }
            />
          </div>
          <VersionHistoryMetadata version={version} />
        </>
      ),
    },
    {
      key: "scope",
      header: "Scope",
      cellClassName: "align-top",
      render: (version) => version.categoryScope,
    },
    {
      key: "lifecycle",
      header: "Lifecycle",
      cellClassName: "align-top",
      mobileHide: true,
      render: (version) => (
        <StatusChip
          label={presentLifecycleState(version.lifecycleState)}
          tone={
            version.lifecycleState === "published"
              ? "success"
              : version.lifecycleState === "archived" || version.lifecycleState === "superseded"
                ? "neutral"
                : "info"
          }
        />
      ),
    },
    {
      key: "compatibility",
      header: "Compatibility",
      cellClassName: "align-top",
      mobileHide: true,
      render: (version) => (
        <StatusChip
          label={presentCompatibilityState(version.compatibilityState)}
          tone={
            version.compatibilityState === "blocked"
              ? "danger"
              : version.compatibilityState === "deprecated" || version.compatibilityState === "remap_required"
                ? "warning"
                : "success"
          }
        />
      ),
    },
    {
      key: "updatedAt",
      header: "Updated",
      cellClassName: "align-top text-slate-600",
      mobileHide: true,
      render: (version) => formatDateTime(version.updatedAt),
    },
    {
      key: "actions",
      header: "Actions",
      cellClassName: "align-top",
      render: (version) =>
        canWrite ? (
          <div className="flex flex-wrap gap-2">
            <form action={validateConnectorMappingVersionAction}>
              <input type="hidden" name="connectorSlug" value={connectorSlug} />
              <input type="hidden" name="versionId" value={version.id} />
              <input type="hidden" name="redirectTo" value={redirectTo} />
              <PendingSubmitButton
                type="submit"
                variant="secondary"
                className="text-xs"
                disabled={version.lifecycleState !== "draft"}
                idleLabel="Validate"
                pendingLabel="Validating..."
              />
            </form>
            {version.fallbackAckRequired ? (
              <form action={setMappingFallbackAcknowledgementAction} className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                <input type="hidden" name="redirectTo" value={redirectTo} />
                <input type="hidden" name="versionId" value={version.id} />
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    name="fallbackAcknowledged"
                    value="true"
                    defaultChecked={fallbackAcknowledged && fallbackAckVersionId === version.id}
                  />
                  <span>
                    <span className="font-medium">Acknowledge fallback</span>
                    <span className="mt-1 block text-[11px] text-amber-800">
                      {fallbackAckMessage(version) ?? "Fallback category will be used for publish if no explicit mapping exists."}
                    </span>
                  </span>
                </label>
                <div className="mt-2 flex flex-wrap gap-2">
                  <PendingSubmitButton
                    type="submit"
                    variant="secondary"
                    className="text-xs"
                    idleLabel="Save acknowledgement"
                    pendingLabel="Saving..."
                  />
                </div>
                {fallbackAckError === "required" && fallbackAckVersionId === version.id ? (
                  <p className="mt-2 text-[11px] font-medium text-amber-900">
                    Save fallback acknowledgement before publishing this version.
                  </p>
                ) : null}
              </form>
            ) : null}
            <p className="w-full text-[11px] text-slate-500 md:hidden">
              Mobile view keeps validate, publish, archive, and rollback controls stacked here so no version action depends on horizontal scroll.
            </p>
            {version.fallbackAckRequired && fallbackAcknowledged && fallbackAckVersionId === version.id ? (
              <form action={setMappingFallbackAcknowledgementAction}>
                <input type="hidden" name="redirectTo" value={redirectTo} />
                <input type="hidden" name="versionId" value={version.id} />
                <input type="hidden" name="fallbackAcknowledged" value="false" />
                <PendingSubmitButton
                  type="submit"
                  variant="secondary"
                  className="text-xs"
                  idleLabel="Clear acknowledgement"
                  pendingLabel="Clearing..."
                />
              </form>
            ) : null}
            <ProtectedMappingActionForm
              action={publishConnectorMappingVersionAction}
              actorRole={actorRole}
              connectorSlug={connectorSlug}
              description={isDefaultMappingLevel(version.mappingLevel)
                ? "Publishing this default mapping will affect all categories that do not have a category-specific override. Confirm your password to proceed."
                : "Publishing is a high-risk action. Confirm your password before promoting this version."}
              disabled={version.lifecycleState !== "validated" || (version.fallbackAckRequired && !(fallbackAcknowledged && fallbackAckVersionId === version.id))}
              installationId={installationId}
              label="Publish"
              open={stepUpAction === "publish" && stepUpVersionId === version.id}
              pendingLabel="Publishing..."
              redirectTo={redirectTo}
              versionId={version.id}
            >
              <input type="hidden" name="confirm" value="true" />
              <input type="hidden" name="fallbackAckRequired" value={version.fallbackAckRequired ? "true" : "false"} />
              <input type="hidden" name="fallbackAcknowledged" value={fallbackAcknowledged && fallbackAckVersionId === version.id ? "true" : "false"} />
              {isDefaultMappingLevel(version.mappingLevel) ? (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
                  <p className="font-semibold">Default mapping — wide impact</p>
                  <p className="mt-1">This mapping applies to every category for this connector unless a category-specific override exists.</p>
                </div>
              ) : null}
              {version.fallbackAckRequired ? (
                <p className="text-xs text-slate-500">
                  {fallbackAcknowledged && fallbackAckVersionId === version.id
                    ? "Fallback acknowledgement is already recorded for this version in the current workflow."
                    : "Fallback acknowledgement must be saved for this version before publish can continue."}
                </p>
              ) : null}
            </ProtectedMappingActionForm>
            <ProtectedMappingActionForm
              action={archiveConnectorMappingVersionAction}
              actorRole={actorRole}
              connectorSlug={connectorSlug}
              description="Archiving changes the active mapping history. Confirm your password before continuing."
              disabled={version.lifecycleState === "archived"}
              installationId={installationId}
              label="Archive"
              open={stepUpAction === "archive" && stepUpVersionId === version.id}
              pendingLabel="Archiving..."
              redirectTo={redirectTo}
              versionId={version.id}
            >
              <div className="space-y-1">
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor={`archive-reason-${version.id}`}>
                  Archive reason
                </label>
                <Input id={`archive-reason-${version.id}`} name="reason" defaultValue="archived_from_mapping_manager" required />
              </div>
            </ProtectedMappingActionForm>
            {(version.lifecycleState === "superseded" || version.lifecycleState === "archived") && (
              <ProtectedMappingActionForm
                action={rollbackConnectorMappingVersionAction}
                actorRole={actorRole}
                connectorSlug={connectorSlug}
                description="Rollback restores this prior published mapping as a new published version."
                disabled={false}
                installationId={installationId}
                label="Rollback"
                open={stepUpAction === "rollback" && stepUpVersionId === version.id}
                pendingLabel="Rolling back..."
                redirectTo={redirectTo}
                versionId={version.id}
              >
                <input type="hidden" name="confirm" value="true" />
                <div className="space-y-1">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor={`rollback-reason-${version.id}`}>
                    Rollback reason
                  </label>
                  <Input id={`rollback-reason-${version.id}`} name="reason" defaultValue="restore_prior_known_good_mapping" required />
                </div>
              </ProtectedMappingActionForm>
            )}
          </div>
        ) : (
          <span className="text-xs text-slate-500">Read-only</span>
        ),
    },
  ];

  return (
    <Card id="mapping-history">
      <CardTitle>Step 3: Validate and publish</CardTitle>
      <div className="mt-2 flex flex-wrap gap-2">
        <StatusChip label={`${draftCount} draft`} tone="info" />
        <StatusChip label={`${validatedCount} ready to publish`} tone={validatedCount > 0 ? "warning" : "neutral"} />
        <StatusChip label={`${liveCount} live`} tone={liveCount > 0 ? "success" : "neutral"} />
      </div>
      <p className="mt-2 text-xs text-slate-500">
        After you save a draft, validate it here. Publish becomes available only for validated versions.
      </p>
      {activeVersion ? (
        <div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-950">
          <p className="font-semibold">Active promoted version</p>
          <p className="mt-1">
            Version {describePublishedVersion(activeVersion)} is currently live for this mapping scope.
          </p>
          <p className="mt-1 text-xs text-emerald-900">
            Published {presentPublishedAt(activeVersion.publishedAt, activeVersion.updatedAt)} from connector definition version{" "}
            {activeVersion.connectorDefinitionVersion}.
          </p>
          {publishedVersions.length > 1 ? (
            <p className="mt-1 text-xs text-emerald-900">
              {publishedVersions.length - 1} prior published version{publishedVersions.length - 1 === 1 ? "" : "s"} remain in history for rollback.
            </p>
          ) : null}
        </div>
      ) : (
        <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
          <p className="font-semibold">No active promoted version yet</p>
          <p className="mt-1 text-xs text-amber-900">
            Validate the current draft, then publish it here to create the first live mapping version for this scope.
          </p>
        </div>
      )}
      {/*
        PIM#622: this section used to be visible only above the 640px breakpoint, with a
        separate hand-written fallback below it for narrower widths — but that fallback only
        rendered read-only fields, omitting every action (Validate/Publish/Archive/Rollback)
        from the "actions" column. Below 640px, customers had no way to validate or publish a
        mapping draft at all. DataGrid already renders responsively on its own (a desktop
        table down to 768px, its own mobile card list below that, actions column included in
        both) — render it unconditionally and let that handle every viewport width instead of
        duplicating (and under-implementing) a third layout here.
      */}
      <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
        <DataGrid
          className=""
          columns={columns}
          rows={versions}
          getRowKey={(version) => version.id}
          rowClassName="align-top"
          caption="Mapping version history"
          emptyState={<p className="rounded-lg border border-slate-200 px-3 py-6 text-sm text-slate-500">No mapping versions found for this connector/category scope.</p>}
        />
      </div>
    </Card>
  );
}
