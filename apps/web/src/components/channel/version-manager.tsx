import type { ReactNode } from "react";
import {
  archiveConnectorMappingVersionAction,
  publishConnectorMappingVersionAction,
  rollbackConnectorMappingVersionAction,
  validateConnectorMappingVersionAction,
} from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StatusChip } from "@/components/ui/status-chip";
import type { AppRole, ConnectorMappingVersion } from "@/lib/api";
import {
  presentCompatibilityState,
  presentLifecycleState,
  presentMappingLevel,
  type ProtectedMappingActionKind,
} from "@/lib/channel-mappings";

function RoleHiddenInput({ role }: { role: AppRole }) {
  return <input type="hidden" name="actorRole" value={role} />;
}

function ProtectedMappingActionForm({
  action,
  actorRole,
  connectorSlug,
  description,
  disabled,
  label,
  open,
  redirectTo,
  versionId,
  children,
}: {
  action: (formData: FormData) => Promise<void>;
  actorRole: AppRole;
  connectorSlug: string;
  description: string;
  disabled: boolean;
  label: string;
  open?: boolean;
  redirectTo: string;
  versionId: string;
  children?: ReactNode;
}) {
  if (disabled) {
    return (
      <Button type="button" variant="secondary" className="text-xs" disabled>
        {label}
      </Button>
    );
  }

  return (
    <details className="rounded-md border border-slate-200 bg-slate-50" open={open}>
      <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100">
        {label}
      </summary>
      <form action={action} className="space-y-3 border-t border-slate-200 p-3">
        <RoleHiddenInput role={actorRole} />
        <input type="hidden" name="connectorSlug" value={connectorSlug} />
        <input type="hidden" name="versionId" value={versionId} />
        <input type="hidden" name="redirectTo" value={redirectTo} />
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
        <Button type="submit" className="text-xs">
          {label}
        </Button>
      </form>
    </details>
  );
}

export function VersionManagerCard({
  actorRole,
  canWrite,
  connectorSlug,
  versions,
  redirectTo,
  stepUpAction,
  stepUpVersionId,
}: {
  actorRole: AppRole;
  canWrite: boolean;
  connectorSlug: string;
  versions: ConnectorMappingVersion[];
  redirectTo: string;
  stepUpAction: ProtectedMappingActionKind | "";
  stepUpVersionId: string;
}) {
  return (
    <Card>
      <CardTitle>Mapping History</CardTitle>
      <div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full min-w-[980px] text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="px-3 py-2">Version</th>
              <th className="px-3 py-2">Scope</th>
              <th className="px-3 py-2">Lifecycle</th>
              <th className="px-3 py-2">Compatibility</th>
              <th className="px-3 py-2">Updated</th>
              <th className="px-3 py-2">Actions</th>
            </tr>
          </thead>
          <tbody>
            {versions.length > 0 ? (
              versions.map((version) => (
                <tr key={version.id} className="border-t border-slate-200 hover:bg-slate-50/50">
                  <td className="px-3 py-2.5">
                    <p className="font-medium text-slate-900">{version.connectorDefinitionVersion}</p>
                    <p className="text-xs text-slate-500">{version.id}</p>
                    <p className="text-xs text-slate-500">{presentMappingLevel(version.mappingLevel)}</p>
                  </td>
                  <td className="px-3 py-2.5">{version.categoryScope}</td>
                  <td className="px-3 py-2.5">
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
                  </td>
                  <td className="px-3 py-2.5">
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
                  </td>
                  <td className="px-3 py-2.5 text-slate-600">{new Date(version.updatedAt).toLocaleString()}</td>
                  <td className="px-3 py-2.5">
                    {canWrite ? (
                      <div className="flex flex-wrap gap-2">
                        <form action={validateConnectorMappingVersionAction}>
                          <RoleHiddenInput role={actorRole} />
                          <input type="hidden" name="connectorSlug" value={connectorSlug} />
                          <input type="hidden" name="versionId" value={version.id} />
                          <input type="hidden" name="redirectTo" value={redirectTo} />
                          <Button type="submit" variant="secondary" className="text-xs" disabled={version.lifecycleState !== "draft"}>
                            Validate
                          </Button>
                        </form>
                        <ProtectedMappingActionForm
                          action={publishConnectorMappingVersionAction}
                          actorRole={actorRole}
                          connectorSlug={connectorSlug}
                          description="Publishing is a high-risk action. Confirm your password before promoting this version."
                          disabled={version.lifecycleState !== "validated"}
                          label="Publish"
                          open={stepUpAction === "publish" && stepUpVersionId === version.id}
                          redirectTo={redirectTo}
                          versionId={version.id}
                        >
                          <input type="hidden" name="confirm" value="true" />
                        </ProtectedMappingActionForm>
                        <ProtectedMappingActionForm
                          action={archiveConnectorMappingVersionAction}
                          actorRole={actorRole}
                          connectorSlug={connectorSlug}
                          description="Archiving changes the active mapping history. Confirm your password before continuing."
                          disabled={version.lifecycleState === "archived"}
                          label="Archive"
                          open={stepUpAction === "archive" && stepUpVersionId === version.id}
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
                            label="Rollback"
                            open={stepUpAction === "rollback" && stepUpVersionId === version.id}
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
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <tr className="border-t border-slate-200">
                <td className="px-3 py-6 text-sm text-slate-500" colSpan={6}>
                  No mapping versions found for this connector/category scope.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
