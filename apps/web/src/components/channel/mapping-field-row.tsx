"use client";

import { useState } from "react";
import { Select } from "@/components/ui/select";
import { StatusChip } from "@/components/ui/status-chip";

type MappingFieldRow = {
  targetField: string;
  selectedSource: string;
  required: boolean;
  // Set when no PIM field is picked for this row but the map already covers the field as a source key.
  coveredBy?: string;
};

export function MappingFieldRowControls({
  row,
  fieldInputPrefix,
  sourceFieldOptions,
}: {
  row: MappingFieldRow;
  fieldInputPrefix: string;
  sourceFieldOptions: Array<{ value: string; label: string; preview: string | null }>;
}) {
  const [selectedSource, setSelectedSource] = useState(row.selectedSource);
  const selectedOption = sourceFieldOptions.find((option) => option.value === selectedSource) ?? null;
  const samplePreview = selectedSource
    ? selectedOption?.preview ?? "No value on sample product"
    : "Select a PIM field to preview sample value.";
  const samplePreviewId = `${fieldInputPrefix}${row.targetField}-sample-preview`;
  const mappingStatusId = `${fieldInputPrefix}${row.targetField}-mapping-status`;

  return (
    <>
      <div className="mt-3 min-w-0 lg:mt-0">
        <label
          className="text-xs font-semibold uppercase tracking-wide text-slate-600 lg:hidden"
          htmlFor={`${fieldInputPrefix}${row.targetField}-field`}
        >
          PIM field
        </label>
        <Select
          id={`${fieldInputPrefix}${row.targetField}-field`}
          name={`${fieldInputPrefix}${row.targetField}`}
          defaultValue={row.selectedSource}
          onChange={(e) => setSelectedSource(e.target.value)}
          aria-label={`PIM field for ${row.targetField}`}
          aria-describedby={`${samplePreviewId} ${mappingStatusId}`}
          className="max-w-full"
        >
          <option value="">Select PIM field</option>
          {sourceFieldOptions.map((option) => (
            <option key={`${row.targetField}:${option.value}`} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="mt-3 lg:mt-0">
        <p className="flex items-baseline gap-1.5 text-xs text-slate-600 lg:block">
          <span className="shrink-0 font-semibold uppercase tracking-wide text-slate-500 lg:hidden">
            Sample:
          </span>
          <span id={samplePreviewId}>{samplePreview}</span>
        </p>
      </div>
      <div className="mt-3 flex items-center gap-2 lg:mt-0 lg:block">
        <p className="shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500 lg:hidden">
          Required:
        </p>
        <StatusChip
          label={row.required ? "Required" : "Optional"}
          tone={row.required ? "warning" : "neutral"}
        />
      </div>
      <div className="mt-3 flex items-center gap-2 lg:mt-0 lg:block" id={mappingStatusId}>
        <p className="shrink-0 text-xs font-semibold uppercase tracking-wide text-slate-500 lg:hidden">
          Status:
        </p>
        <StatusChip
          label={selectedSource ? "Mapped" : row.coveredBy ? "Covered" : "Missing"}
          tone={selectedSource ? "success" : row.coveredBy ? "info" : row.required ? "danger" : "neutral"}
        />
        {!selectedSource && row.coveredBy ? (
          <p className="text-xs text-slate-500">Already mapped: {row.coveredBy}</p>
        ) : null}
      </div>
    </>
  );
}
