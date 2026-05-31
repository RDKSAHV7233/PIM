"use client";

import { useState } from "react";
import { createAccessScopeAssignmentAction } from "@/app/admin/users/actions";

const SCOPE_TYPES = [
  { value: "category", label: "Category", field: "categoryId", placeholder: "Category UUID" },
  { value: "brand", label: "Brand", field: "scopeValue", placeholder: "Brand name or slug" },
  { value: "channel", label: "Channel", field: "scopeValue", placeholder: "Channel slug (e.g. amazon-in)" },
  { value: "connector_account", label: "Connector Account", field: "connectorInstallationId", placeholder: "Connector installation UUID" },
] as const;

type ScopeType = (typeof SCOPE_TYPES)[number]["value"];

export function AccessScopeForm() {
  const [scopeType, setScopeType] = useState<ScopeType>("category");
  const active = SCOPE_TYPES.find((s) => s.value === scopeType)!;

  return (
    <form action={createAccessScopeAssignmentAction} className="mt-4 space-y-4 rounded-md border border-slate-200 bg-slate-50 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          <span className="font-semibold text-slate-700">Subject type</span>
          <select
            name="subjectType"
            defaultValue="user"
            className="rounded-md border border-slate-300 bg-white px-3 py-2 focus:border-slate-500 focus:outline-none"
          >
            <option value="user">User</option>
            <option value="role">Role</option>
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-semibold text-slate-700">Subject ID</span>
          <input
            type="text"
            name="subjectId"
            placeholder="user@example.com or 'editor'"
            required
            className="rounded-md border border-slate-300 bg-white px-3 py-2 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none"
          />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1 text-sm">
          <span className="font-semibold text-slate-700">Scope type</span>
          <select
            name="scopeType"
            value={scopeType}
            onChange={(e) => setScopeType(e.target.value as ScopeType)}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 focus:border-slate-500 focus:outline-none"
          >
            {SCOPE_TYPES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-slate-500">
            {scopeType === "category" && "Restrict access to products in a specific category tree."}
            {scopeType === "brand" && "Restrict access to products under a specific brand."}
            {scopeType === "channel" && "Restrict access to a specific marketplace channel."}
            {scopeType === "connector_account" && "Restrict connector operations to one account."}
          </p>
        </label>

        <label className="grid gap-1 text-sm">
          <span className="font-semibold text-slate-700">{active.label}</span>
          <input
            key={active.field}
            type="text"
            name={active.field}
            placeholder={active.placeholder}
            className="rounded-md border border-slate-300 bg-white px-3 py-2 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none"
          />
          {/* Hidden no-ops for unused fields so the server action receives consistent keys */}
          {SCOPE_TYPES.filter((s) => s.value !== scopeType).map((s) => (
            <input key={s.field + s.value} type="hidden" name={s.field} value="" />
          ))}
        </label>
      </div>

      <label className="grid gap-1 text-sm">
        <span className="font-semibold text-slate-700">Actions <span className="font-normal text-slate-400">(optional)</span></span>
        <input
          type="text"
          name="actions"
          placeholder="Comma-separated action list — leave blank for all scoped actions"
          className="rounded-md border border-slate-300 bg-white px-3 py-2 placeholder:text-slate-400 focus:border-slate-500 focus:outline-none"
        />
      </label>

      <button
        type="submit"
        className="rounded-md bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
      >
        Assign scope
      </button>
    </form>
  );
}
