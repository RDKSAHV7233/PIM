"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { ApiKeyCreateActionState } from "./actions";
import { createApiAccessKeyAction } from "./actions";
import type { ApiClientScope, AppRole } from "@/lib/api";

const INITIAL_STATE: ApiKeyCreateActionState = {
  status: "idle",
  message: null,
  createdKey: null,
};

const ROLE_OPTIONS: ReadonlyArray<{ value: AppRole; label: string }> = [
  { value: "admin",           label: "Admin" },
  { value: "editor",          label: "Editor" },
  { value: "publisher",       label: "Publisher" },
  { value: "approver",        label: "Approver" },
  { value: "channel_manager", label: "Channel Manager" },
  { value: "connector_admin", label: "Connector Admin" },
  { value: "reviewer",        label: "Reviewer" },
  { value: "viewer",          label: "Viewer" },
];

const SCOPES: ReadonlyArray<{ value: ApiClientScope; label: string; description: string }> = [
  { value: "catalog.read", label: "Catalog read", description: "Allow list and detail reads for catalog products." },
  { value: "catalog.write", label: "Catalog write", description: "Allow create and update actions for catalog products." },
];

const DEFAULT_SCOPES_BY_ROLE: Record<AppRole, ApiClientScope[]> = {
  admin:           ["catalog.read", "catalog.write"],
  editor:          ["catalog.read", "catalog.write"],
  publisher:       ["catalog.read"],
  approver:        ["catalog.read"],
  channel_manager: ["catalog.read"],
  connector_admin: ["catalog.read"],
  reviewer:        ["catalog.read"],
  viewer:          ["catalog.read"],
};

function resolveApiKeyFieldErrors(message: string | null) {
  const normalized = String(message ?? "").toLowerCase();
  return {
    label: normalized.includes("label"),
    role: normalized.includes("role"),
    scopes: normalized.includes("scope"),
  };
}

export function ApiKeyCreatePanel() {
  const router = useRouter();
  const [state, formAction, pending] = useActionState(createApiAccessKeyAction, INITIAL_STATE);
  const [role, setRole] = useState<AppRole>("editor");
  const [selectedScopes, setSelectedScopes] = useState<ApiClientScope[]>(DEFAULT_SCOPES_BY_ROLE.editor);

  useEffect(() => {
    if (state.status === "success") {
      router.refresh();
    }
  }, [router, state.status]);
  const fieldErrors = resolveApiKeyFieldErrors(state.message);

  function handleRoleChange(nextRole: AppRole) {
    setRole(nextRole);
    setSelectedScopes(DEFAULT_SCOPES_BY_ROLE[nextRole]);
  }

  function toggleScope(scope: ApiClientScope) {
    setSelectedScopes((current) =>
      current.includes(scope) ? current.filter((value) => value !== scope) : [...current, scope],
    );
  }

  return (
    <div className="space-y-3 rounded-md border border-slate-200 bg-white p-4">
      <div>
        <h3 className="text-base font-semibold text-slate-900">Create API key</h3>
        <p className="mt-1 text-sm text-slate-600">
          Use tenant-scoped machine credentials for integrations. We only show the raw key once.
        </p>
      </div>

      {state.status === "success" && state.createdKey ? (
        <div className="space-y-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
          <div>{state.message}</div>
          <textarea
            readOnly
            value={state.createdKey}
            rows={3}
            className="w-full rounded-md border border-emerald-200 bg-white px-3 py-2 font-mono text-xs text-slate-900"
          />
        </div>
      ) : null}

      {state.status === "error" && state.message ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
          {state.message}
        </div>
      ) : null}

      <form action={formAction} className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <label className="space-y-1 text-sm">
          <span className="text-slate-600">Label</span>
          <input
            type="text"
            name="label"
            required
            placeholder="Warehouse sync"
            className="w-full rounded-md border border-slate-200 px-3 py-2"
            aria-invalid={state.status === "error" && fieldErrors.label ? "true" : undefined}
            aria-describedby={state.status === "error" && fieldErrors.label ? "api-key-label-error" : undefined}
          />
          {state.status === "error" && fieldErrors.label ? (
            <p id="api-key-label-error" className="text-xs text-rose-700">{state.message}</p>
          ) : null}
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-slate-600">Role</span>
          <select
            name="role"
            value={role}
            onChange={(event) => handleRoleChange(event.target.value as AppRole)}
            className="w-full rounded-md border border-slate-200 px-3 py-2"
            aria-invalid={state.status === "error" && fieldErrors.role ? "true" : undefined}
            aria-describedby={state.status === "error" && fieldErrors.role ? "api-key-role-error" : undefined}
          >
            {ROLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {state.status === "error" && fieldErrors.role ? (
            <p id="api-key-role-error" className="text-xs text-rose-700">{state.message}</p>
          ) : null}
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-slate-600">Expires at</span>
          <input type="datetime-local" name="expiresAt" className="w-full rounded-md border border-slate-200 px-3 py-2" />
        </label>
        <fieldset
          className="space-y-2 rounded-md border border-slate-200 p-3 md:col-span-2 xl:col-span-3"
          aria-invalid={state.status === "error" && fieldErrors.scopes ? "true" : undefined}
          aria-describedby={state.status === "error" && fieldErrors.scopes ? "api-key-scopes-error" : undefined}
        >
          <legend className="px-1 text-sm font-medium text-slate-700">Scopes</legend>
          <p className="text-xs text-slate-500">
            Editor keys default to read and write. Reviewer and viewer keys default to read-only.
          </p>
          <div className="grid gap-2 md:grid-cols-2">
            {SCOPES.map((scope) => {
              const checked = selectedScopes.includes(scope.value);
              return (
                <label key={scope.value} className="flex items-start gap-2 rounded-md border border-slate-200 p-2 text-sm">
                  <input
                    type="checkbox"
                    name="scopes"
                    value={scope.value}
                    checked={checked}
                    onChange={() => toggleScope(scope.value)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block font-medium text-slate-900">{scope.label}</span>
                    <span className="block text-xs text-slate-500">{scope.description}</span>
                  </span>
                </label>
              );
            })}
          </div>
          {state.status === "error" && fieldErrors.scopes ? (
            <p id="api-key-scopes-error" className="text-xs text-rose-700">{state.message}</p>
          ) : null}
        </fieldset>
        <div className="flex items-end">
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {pending ? "Creating..." : "Create API key"}
          </button>
        </div>
      </form>
    </div>
  );
}
