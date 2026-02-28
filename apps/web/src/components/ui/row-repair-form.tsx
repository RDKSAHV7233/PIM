"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AppRole, BulkImportRow } from "@/lib/api";
import { postJson } from "@/lib/api";
import { extractErrorCode, translateError } from "@/lib/errors";

interface RowRepairFormProps {
  row: BulkImportRow;
  jobId: string;
  role: AppRole;
}

function toEditableString(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

function parseEditedValue(raw: string): unknown {
  const trimmed = raw.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed === "true") {
    return true;
  }
  if (trimmed === "false") {
    return false;
  }
  const numeric = Number(trimmed);
  if (Number.isFinite(numeric) && /^-?\d+(\.\d+)?$/.test(trimmed)) {
    return numeric;
  }
  return trimmed;
}

function detectErrorFields(errorMessage: string | null, payloadKeys: string[]): string[] {
  const normalized = String(errorMessage ?? "").toLowerCase();
  const matched = payloadKeys.filter((key) => normalized.includes(key.toLowerCase()));
  if (matched.length > 0) {
    return matched;
  }
  return payloadKeys.length > 0 ? [payloadKeys[0]] : [];
}

export function RowRepairForm({ row, jobId, role }: RowRepairFormProps) {
  const payloadEntries = useMemo(() => Object.entries(row.payload), [row.payload]);
  const payloadKeys = payloadEntries.map(([key]) => key);
  const editableFields = detectErrorFields(row.errorMessage, payloadKeys);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(payloadEntries.map(([key, value]) => [key, toEditableString(value)])),
  );
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const translated = translateError(extractErrorCode(row.errorMessage));

  const readonlyFields = payloadEntries.filter(([key]) => !editableFields.includes(key));
  const editableEntries = payloadEntries.filter(([key]) => editableFields.includes(key));

  async function saveAndRetry() {
    setSaving(true);
    setStatusMessage("");
    try {
      const correctedPayload: Record<string, unknown> = {};
      for (const [key] of payloadEntries) {
        correctedPayload[key] = parseEditedValue(values[key] ?? "");
      }

      await postJson(`/bulk-import/jobs/${encodeURIComponent(jobId)}/rows/${encodeURIComponent(row.id)}/repair`, {
        payload: correctedPayload,
        requeue: true,
      }, { role });

      await postJson(
        `/bulk-import/jobs/${encodeURIComponent(jobId)}/rows/${encodeURIComponent(row.id)}/process`,
        {},
        { role },
      );
      setStatusMessage("Saved and retried successfully.");
    } catch {
      setStatusMessage("Could not save this row. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
      <p className="text-sm font-medium text-red-700">{translated.title}</p>
      <p className="text-xs text-slate-600">{row.errorMessage || translated.description}</p>

      {editableEntries.map(([key]) => (
        <label key={key} className="block space-y-1">
          <span className="text-xs font-medium text-slate-700">{key}</span>
          <Input
            value={values[key] ?? ""}
            onChange={(event) => setValues((previous) => ({ ...previous, [key]: event.target.value }))}
          />
        </label>
      ))}

      {readonlyFields.length > 0 && (
        <div className="space-y-1 rounded-md border border-slate-200 bg-white p-2">
          <p className="text-xs font-medium text-slate-600">Context</p>
          {readonlyFields.map(([key, value]) => (
            <p key={key} className="text-xs text-slate-600">
              <span className="font-medium">{key}:</span> {toEditableString(value)}
            </p>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2">
        <Button type="button" onClick={saveAndRetry} disabled={saving}>
          {saving ? "Saving..." : "Save and retry this row"}
        </Button>
        {statusMessage && <p className="text-xs text-slate-600">{statusMessage}</p>}
      </div>
    </div>
  );
}

