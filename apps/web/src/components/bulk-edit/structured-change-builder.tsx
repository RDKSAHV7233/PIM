"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { JsonPreview } from "@/components/ui/json-preview";
import { Select } from "@/components/ui/select";

const STRUCTURED_FIELDS = [
  { value: "status", label: "Status", placeholder: "Choose the next catalog status." },
  { value: "brand", label: "Brand", placeholder: "Set the product brand." },
  { value: "title", label: "Title", placeholder: "Set the product title." },
  { value: "description", label: "Description", placeholder: "Set the product description." },
  { value: "hsnCode", label: "HSN Code", placeholder: "Set or clear the HSN code." },
  { value: "gstRate", label: "GST Rate", placeholder: "Set or clear the GST rate." },
] as const;

type Field = (typeof STRUCTURED_FIELDS)[number]["value"];
type Operation = "set" | "clear";

const STATUS_OPTIONS = ["draft", "in_review", "approved", "rejected", "active", "archived"];
const CLEARABLE_FIELDS: Field[] = ["hsnCode", "gstRate"];

function buildPayload(field: Field, operation: Operation, value: string): string {
  if (operation === "clear") {
    if (!CLEARABLE_FIELDS.includes(field)) return "{}";
    return JSON.stringify({ [field]: null }, null, 2);
  }
  const trimmed = value.trim();
  if (!trimmed) return "{}";
  if (field === "status") {
    const normalized = trimmed.toLowerCase();
    if (!STATUS_OPTIONS.includes(normalized)) return "{}";
    return JSON.stringify({ status: normalized }, null, 2);
  }
  if (field === "gstRate") {
    const n = Number(trimmed);
    if (!Number.isFinite(n) || n < 0) return "{}";
    return JSON.stringify({ gstRate: n }, null, 2);
  }
  return JSON.stringify({ [field]: trimmed }, null, 2);
}

interface StructuredChangeBuilderProps {
  defaultField: string;
  defaultOperation: string;
  defaultValue: string;
}

export function StructuredChangeBuilder({ defaultField, defaultOperation, defaultValue }: StructuredChangeBuilderProps) {
  const initialField = (STRUCTURED_FIELDS.some((f) => f.value === defaultField) ? defaultField : "status") as Field;
  const initialOp = (defaultOperation === "clear" ? "clear" : "set") as Operation;
  const initialValue = initialOp === "clear" ? "" : (defaultValue || (initialField === "status" ? "active" : ""));

  const [field, setField] = useState<Field>(initialField);
  const [operation, setOperation] = useState<Operation>(initialOp);
  const [value, setValue] = useState(initialValue);

  const isClear = operation === "clear";
  const isStatus = field === "status" && !isClear;
  const placeholder = isClear
    ? "Clear sets the field to blank/null."
    : STRUCTURED_FIELDS.find((f) => f.value === field)?.placeholder;
  const payload = buildPayload(field, operation, value);

  function handleFieldChange(next: string) {
    const nextField = (STRUCTURED_FIELDS.some((f) => f.value === next) ? next : "status") as Field;
    setField(nextField);
    if (operation === "clear" && !CLEARABLE_FIELDS.includes(nextField)) {
      setOperation("set");
    }
    if (nextField === "status") {
      setValue((prev) => (STATUS_OPTIONS.includes(prev) ? prev : "active"));
    } else {
      setValue("");
    }
  }

  function handleOperationChange(next: string) {
    const nextOp = next === "clear" ? "clear" : "set";
    setOperation(nextOp as Operation);
    if (nextOp === "clear") setValue("");
  }

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-4 md:col-span-2 lg:col-span-3">
      <div>
        <p className="text-sm font-semibold text-slate-900">Structured change builder</p>
        <p className="mt-1 text-xs text-slate-500">
          Default to field + operation changes here. Advanced JSON stays secondary for uncommon edits.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <div className="space-y-1">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="bulk-edit-field">
            Field
          </label>
          <Select
            id="bulk-edit-field"
            name="bulkEditField"
            value={field}
            onChange={(e) => handleFieldChange(e.target.value)}
          >
            {STRUCTURED_FIELDS.map((f) => (
              <option key={f.value} value={f.value}>{f.label}</option>
            ))}
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="bulk-edit-operation">
            Operation
          </label>
          <Select
            id="bulk-edit-operation"
            name="bulkEditOperation"
            value={operation}
            onChange={(e) => handleOperationChange(e.target.value)}
          >
            <option value="set">Set value</option>
            <option value="clear">Clear value</option>
          </Select>
        </div>
        <div className="space-y-1">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="bulk-edit-value">
            New value
          </label>
          {isStatus ? (
            <Select
              id="bulk-edit-value"
              name="bulkEditValue"
              value={value}
              onChange={(e) => setValue(e.target.value)}
            >
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </Select>
          ) : (
            <Input
              id="bulk-edit-value"
              name="bulkEditValue"
              value={isClear ? "" : value}
              onChange={(e) => setValue(e.target.value)}
              disabled={isClear}
              placeholder={placeholder}
            />
          )}
        </div>
      </div>
      <div className="rounded-md border border-slate-200 bg-white p-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Generated update payload</p>
        <JsonPreview value={payload} className="mt-2 border-0 bg-transparent p-0" />
      </div>
      <Button type="submit" className="w-fit" name="bulkEditMode" value="structured">
        Preview affected products
      </Button>
    </div>
  );
}
