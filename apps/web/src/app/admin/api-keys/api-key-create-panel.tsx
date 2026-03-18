"use client";

import { useActionState } from "react";
import type { ApiKeyCreateActionState } from "./actions";
import { createApiAccessKeyAction } from "./actions";

const INITIAL_STATE: ApiKeyCreateActionState = {
  status: "idle",
  message: null,
  createdKey: null,
};

export function ApiKeyCreatePanel() {
  const [state, formAction, pending] = useActionState(createApiAccessKeyAction, INITIAL_STATE);

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
          />
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-slate-600">Role</span>
          <select name="role" defaultValue="editor" className="w-full rounded-md border border-slate-200 px-3 py-2">
            <option value="editor">Editor</option>
            <option value="reviewer">Reviewer</option>
            <option value="viewer">Viewer</option>
          </select>
        </label>
        <label className="space-y-1 text-sm">
          <span className="text-slate-600">Expires at</span>
          <input type="datetime-local" name="expiresAt" className="w-full rounded-md border border-slate-200 px-3 py-2" />
        </label>
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
