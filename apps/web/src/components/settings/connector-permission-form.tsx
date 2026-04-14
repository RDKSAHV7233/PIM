"use client";

import { useMemo, useState } from "react";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import type { AppRole, ConnectorDefinition } from "@/lib/api";

const ROLE_OPTIONS: readonly AppRole[] = ["admin", "editor", "reviewer", "viewer"];

interface ConnectorPermissionFormProps {
  definitions: ConnectorDefinition[];
  grantAction: (formData: FormData) => Promise<void>;
}

export function ConnectorPermissionForm({ definitions, grantAction }: ConnectorPermissionFormProps) {
  const [principalType, setPrincipalType] = useState<"role" | "user">("role");
  const [connectorSlug, setConnectorSlug] = useState(definitions[0]?.slug ?? "");
  const [principalId, setPrincipalId] = useState("editor");
  const [action, setAction] = useState<"install" | "reconnect" | "uninstall">("install");
  const [accountAlias, setAccountAlias] = useState("");
  const roleDescription = useMemo(
    () => "Choose one role. Add another row if the same connector action should apply to more than one role.",
    [],
  );
  const connectorLabel = useMemo(() => {
    const definition = definitions.find((item) => item.slug === connectorSlug);
    return definition?.displayName ?? connectorSlug ?? "selected connector";
  }, [connectorSlug, definitions]);
  const policyPreview = useMemo(() => {
    const target =
      principalType === "role"
        ? `${principalId || "selected"} role holders`
        : `user ${principalId || "in this workspace"}`;
    const scope = accountAlias.trim() ? `account alias "${accountAlias.trim()}"` : "all account aliases";
    const actionLabel =
      action === "install" ? "install" : action === "reconnect" ? "reconnect" : "disable";
    return `${target} can ${actionLabel} ${connectorLabel} for ${scope}.`;
  }, [accountAlias, action, connectorLabel, principalId, principalType]);

  return (
    <form action={grantAction} className="mt-3 grid gap-4">
      <div className="rounded-xl border border-slate-200 bg-slate-50 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Policy preview</p>
        <p className="mt-2 text-sm text-slate-700">{policyPreview}</p>
        <p className="mt-2 text-xs text-slate-500">
          Use role rules for broad access. Use user-specific rules only when someone needs an exception.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      <div className="space-y-1">
        <label htmlFor="connector-slug" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          Connector
        </label>
        <select
          id="connector-slug"
          name="connectorSlug"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          required
          value={connectorSlug}
          onChange={(event) => setConnectorSlug(event.currentTarget.value)}
        >
          {definitions.map((definition) => (
            <option key={definition.id} value={definition.slug}>
              {definition.displayName} ({definition.slug})
            </option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="principal-type" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          Principal Type
        </label>
        <select
          id="principal-type"
          name="principalType"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          value={principalType}
          onChange={(event) => {
            const nextType = event.currentTarget.value === "user" ? "user" : "role";
            setPrincipalType(nextType);
            setPrincipalId(nextType === "user" ? "" : "editor");
          }}
        >
          <option value="role">role</option>
          <option value="user">user</option>
        </select>
        <p className="text-xs text-slate-500">Decide whether this rule applies broadly by role or narrowly to one user.</p>
      </div>
      <div className="space-y-1">
        <label htmlFor="principal-id" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          {principalType === "role" ? "Role" : "User ID"}
        </label>
        {principalType === "role" ? (
          <>
            <select
              id="principal-id"
              name="principalId"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              value={principalId}
              onChange={(event) => setPrincipalId(event.currentTarget.value)}
            >
              {ROLE_OPTIONS.map((role) => (
                <option key={role} value={role}>
                  {role}
                </option>
              ))}
            </select>
            <p className="text-xs text-slate-500">{roleDescription}</p>
          </>
        ) : (
          <>
            <input
              id="principal-id"
              name="principalId"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
              placeholder="user@tenant"
              required
              value={principalId}
              onChange={(event) => setPrincipalId(event.currentTarget.value)}
            />
            <p className="text-xs text-slate-500">Grant access to one specific user in this workspace.</p>
          </>
        )}
      </div>
      <div className="space-y-1">
        <label htmlFor="permission-action" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          Action
        </label>
        <select
          id="permission-action"
          name="action"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          value={action}
          onChange={(event) => setAction(event.currentTarget.value as "install" | "reconnect" | "uninstall")}
        >
          <option value="install">install</option>
          <option value="reconnect">reconnect</option>
          <option value="uninstall">uninstall</option>
        </select>
        <p className="text-xs text-slate-500">Choose the exact action this rule unlocks.</p>
      </div>
      <div className="space-y-1">
        <label htmlFor="account-alias" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          Account Scope
        </label>
        <input
          id="account-alias"
          name="accountAlias"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          placeholder="Leave blank for all aliases"
          value={accountAlias}
          onChange={(event) => setAccountAlias(event.currentTarget.value)}
        />
        <p className="text-xs text-slate-500">Leave blank to apply this permission to all aliases for the selected connector.</p>
      </div>
      <div className="flex items-end">
        <PendingSubmitButton type="submit" idleLabel="Save permission" pendingLabel="Saving..." />
      </div>
      </div>
    </form>
  );
}
