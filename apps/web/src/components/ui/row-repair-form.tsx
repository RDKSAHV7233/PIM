"use client";

import { useMemo, useState } from "react";
import { processBulkImportRowAction, repairBulkImportRowAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { BulkImportRow } from "@/lib/api";
import { extractErrorCode, translateError } from "@/lib/errors";

interface RowRepairFormProps {
  row: BulkImportRow;
  jobId: string;
}

const KNOWN_IMPORT_FIELDS = [
  "title", "description", "brand", "hsnCode", "gstRate", "status", "attributes",
  // International tax code fields — stored as flat CSV columns or as JSON taxCodes array
  "taxCodes", "gb_commodity_code", "ae_hs_code", "us_tax_category", "au_commodity_code",
] as const;

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

function parseEditedFieldValue(key: string, raw: string): unknown {
  const trimmed = raw.trim();
  if (key === "gstRate") {
    if (!trimmed) {
      return null;
    }
    const numeric = Number(trimmed);
    return Number.isFinite(numeric) ? numeric : trimmed;
  }
  if (key === "attributes") {
    if (!trimmed) {
      return {};
    }
    try {
      const parsed = JSON.parse(trimmed);
      return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : trimmed;
    } catch {
      return trimmed;
    }
  }
  if (key === "taxCodes") {
    if (!trimmed) {
      return [];
    }
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed : trimmed;
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

function detectErrorFields(errorMessage: string | null, payloadKeys: string[]): string[] {
  const normalized = String(errorMessage ?? "").toLowerCase();
  const matched = payloadKeys.filter((key) => normalized.includes(key.toLowerCase()));
  if (matched.length > 0) {
    return matched;
  }
  const inferredMissingFields = KNOWN_IMPORT_FIELDS.filter((key) => normalized.includes(key.toLowerCase()));
  if (inferredMissingFields.length > 0) {
    return [...new Set(inferredMissingFields)];
  }
  return payloadKeys.length > 0 ? [payloadKeys[0]] : [];
}

export function RowRepairForm({ row, jobId }: RowRepairFormProps) {
  const payloadEntries = useMemo(() => Object.entries(row.payload), [row.payload]);
  const payloadKeys = payloadEntries.map(([key]) => key);
  const editableFields = detectErrorFields(row.errorMessage, payloadKeys);
  const payloadRecord = useMemo(() => Object.fromEntries(payloadEntries), [payloadEntries]);
  const [values, setValues] = useState<Record<string, string>>(() => {
    const initialValues = Object.fromEntries(payloadEntries.map(([key, value]) => [key, toEditableString(value)]));
    editableFields.forEach((key) => {
      if (!(key in initialValues)) {
        initialValues[key] = "";
      }
    });
    return initialValues;
  });
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const translated = translateError(extractErrorCode(row.errorMessage));

  const readonlyFields = payloadEntries.filter(([key]) => !editableFields.includes(key));
  const editableEntries = editableFields.map((key) => [key, payloadRecord[key]] as const);

  async function saveAndRetry() {
    setSaving(true);
    setStatusMessage("");
    try {
      const correctedPayload: Record<string, unknown> = Object.fromEntries(payloadEntries);
      for (const key of editableFields) {
        correctedPayload[key] = parseEditedFieldValue(key, values[key] ?? "");
      }

      const repairFormData = new FormData();
      repairFormData.set("jobId", jobId);
      repairFormData.set("rowId", row.id);
      repairFormData.set("payload", JSON.stringify(correctedPayload));
      repairFormData.set("requeue", "true");
      await repairBulkImportRowAction(repairFormData);

      const processFormData = new FormData();
      processFormData.set("jobId", jobId);
      processFormData.set("rowId", row.id);
      await processBulkImportRowAction(processFormData);
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

