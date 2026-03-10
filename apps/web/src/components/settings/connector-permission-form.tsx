"use client";

import { useMemo, useState } from "react";
import type { AppRole, ConnectorDefinition } from "@/lib/api";

const ROLE_OPTIONS: readonly AppRole[] = ["admin", "editor", "reviewer", "viewer"];

interface ConnectorPermissionFormProps {
  definitions: ConnectorDefinition[];
  grantAction: (formData: FormData) => Promise<void>;
}

export function ConnectorPermissionForm({ definitions, grantAction }: ConnectorPermissionFormProps) {
  const [principalType, setPrincipalType] = useState<"role" | "user">("role");
  const roleDescription = useMemo(
    () => "Choose one role. Add another row if the same connector action should apply to more than one role.",
    [],
  );

  return (
    <form action={grantAction} className="mt-3 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
      <div className="space-y-1">
        <label htmlFor="connector-slug" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          Connector
        </label>
        <select id="connector-slug" name="connectorSlug" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" required>
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
          onChange={(event) => setPrincipalType(event.currentTarget.value === "user" ? "user" : "role")}
        >
          <option value="role">role</option>
          <option value="user">user</option>
        </select>
        <p className="text-xs text-slate-500">One permission row applies to one role or one user.</p>
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
              defaultValue="editor"
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
            />
            <p className="text-xs text-slate-500">Grant access to one specific user in this workspace.</p>
          </>
        )}
      </div>
      <div className="space-y-1">
        <label htmlFor="permission-action" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          Action
        </label>
        <select id="permission-action" name="action" className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" defaultValue="install">
          <option value="install">install</option>
          <option value="reconnect">reconnect</option>
          <option value="uninstall">uninstall</option>
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="account-alias" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          Account Alias (optional)
        </label>
        <input
          id="account-alias"
          name="accountAlias"
          className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          placeholder="Leave blank for all aliases"
        />
        <p className="text-xs text-slate-500">Leave blank to apply this permission to all aliases for the selected connector.</p>
      </div>
      <div className="flex items-end">
        <button type="submit" className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white">
          Grant
        </button>
      </div>
    </form>
  );
}
