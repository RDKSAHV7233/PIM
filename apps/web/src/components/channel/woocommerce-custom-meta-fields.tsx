"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

export function WooCommerceCustomMetaFields({
  fieldInputPrefix,
  sourceFieldOptions,
  existingMetaTargets,
}: {
  fieldInputPrefix: string;
  sourceFieldOptions: Array<{ value: string; label: string; preview: string | null }>;
  existingMetaTargets: Array<{ target: string; source: string }>;
}) {
  const [metaRows, setMetaRows] = useState<Array<{ target: string; source: string }>>(existingMetaTargets);
  const [newKey, setNewKey] = useState("");

  function addMetaTarget() {
    const key = newKey.trim();
    if (!key) return;
    const target = key.startsWith("meta_data.") ? key : `meta_data.${key}`;
    if (metaRows.some((r) => r.target === target)) return;
    setMetaRows((prev) => [...prev, { target, source: "" }]);
    setNewKey("");
  }

  function removeMetaTarget(target: string) {
    setMetaRows((prev) => prev.filter((r) => r.target !== target));
  }

  function updateSource(target: string, source: string) {
    setMetaRows((prev) => prev.map((r) => (r.target === target ? { ...r, source } : r)));
  }

  return (
    <details className="rounded-lg border border-indigo-200 bg-indigo-50 p-3">
      <summary className="cursor-pointer text-sm font-medium text-indigo-900">
        WooCommerce custom meta fields
      </summary>
      <p className="mt-2 text-xs text-slate-600">
        Add custom <code className="rounded bg-white px-1 py-0.5 text-xs font-mono">meta_data</code> targets
        to map PIM fields to WooCommerce product meta. The key becomes the meta_key in WooCommerce.
      </p>

      <div className="mt-3 flex gap-2">
        <Input
          type="text"
          value={newKey}
          onChange={(e) => setNewKey(e.target.value)}
          placeholder="meta_data.your_key_name"
          className="flex-1 text-sm"
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addMetaTarget();
            }
          }}
        />
        <Button type="button" variant="secondary" size="sm" onClick={addMetaTarget}>
          Add
        </Button>
      </div>

      {metaRows.length > 0 && (
        <div className="mt-3 space-y-2">
          {metaRows.map((row) => (
            <div key={row.target} className="flex items-center gap-2 rounded border border-slate-200 bg-white px-3 py-2">
              <code className="shrink-0 text-xs font-mono text-slate-700">{row.target}</code>
              <span className="text-xs text-slate-400">&rarr;</span>
              <Select
                name={`${fieldInputPrefix}${row.target}`}
                value={row.source}
                onChange={(e) => updateSource(row.target, e.target.value)}
                className="flex-1 text-sm"
              >
                <option value="">Select PIM field</option>
                {sourceFieldOptions.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </Select>
              <button
                type="button"
                onClick={() => removeMetaTarget(row.target)}
                className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                aria-label={`Remove ${row.target}`}
              >
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M3.5 3.5L10.5 10.5M10.5 3.5L3.5 10.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
              <input type="hidden" name="customMetaTarget" value={row.target} />
            </div>
          ))}
        </div>
      )}
    </details>
  );
}
