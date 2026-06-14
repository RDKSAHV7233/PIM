"use client";

import { useMemo, useRef, useState } from "react";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { InlineAlert } from "@/components/ui/inline-alert";
import { WorkflowStepper, type WorkflowStep } from "@/components/ui/workflow-stepper";
import type { BulkImportRun, Category } from "@/lib/api";

function readCookie(name: string): string {
  if (typeof document === "undefined") {
    return "";
  }
  const prefix = `${name}=`;
  return document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length) ?? "";
}

function detectSourceFormat(fileName: string): "csv" | "json" | null {
  const normalized = fileName.trim().toLowerCase();
  if (normalized.endsWith(".csv")) {
    return "csv";
  }
  if (normalized.endsWith(".json")) {
    return "json";
  }
  return null;
}

function encodeBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

type ImportPreflightFormProps = {
  categories: Category[];
  canWrite: boolean;
  submitAction: (formData: FormData) => void | Promise<void>;
};

type ValidationFieldErrors = Partial<Record<"categoryId" | "sourceFile" | "chunkSize" | "maxRetries" | "general", string>>;

const DEFAULT_MAPPING = JSON.stringify({
  title: "title",
  description: "description",
  brand: "brand",
  hsnCode: "hsnCode",
  gstRate: "gstRate",
  status: "status",
  attributes: "attributes",
});

export function ImportPreflightForm({ categories, canWrite, submitAction }: ImportPreflightFormProps) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const [stagedRun, setStagedRun] = useState<BulkImportRun | null>(null);
  const [fieldErrors, setFieldErrors] = useState<ValidationFieldErrors>({});
  const [validationError, setValidationError] = useState<string>("");
  const [validating, setValidating] = useState(false);

  const hasCategories = categories.length > 0;
  const canImport = stagedRun?.preflightSummary?.canImport ?? false;
  const isLargeMode = stagedRun?.effectiveMode === "large";
  const validationTone = useMemo(() => {
    if (!stagedRun) {
      return null;
    }
    if (stagedRun.status === "preflight_blocked") {
      return "error";
    }
    if ((stagedRun.warningCount ?? 0) > 0) {
      return "warning";
    }
    return "success";
  }, [stagedRun]);
  const mappedFieldCount = useMemo(
    () => Object.keys(stagedRun?.preflightSummary?.mapping ?? {}).length,
    [stagedRun],
  );
  const hasBlockingIssues = (stagedRun?.blockingIssueCount ?? 0) > 0;
  const warningOnlyPreflight = Boolean(canImport && (stagedRun?.warningCount ?? 0) > 0);
  const malformedFileState = /json|csv|array|file|format|parse/i.test(validationError);
  const preflightSteps = useMemo<WorkflowStep[]>(
    () => [
      {
        label: "Upload and pre-validate",
        tone: stagedRun || validationError ? "complete" : "current",
        description: "Choose category scope and validate the incoming file before creating a job.",
      },
      {
        label: "Review validation summary",
        tone: stagedRun ? (hasBlockingIssues ? "current" : "complete") : validationError ? "rejected" : "pending",
        description: "Check mapping coverage, blocking issues, warnings, and sample row errors.",
      },
      {
        label: "Start import",
        tone: canImport ? "current" : "pending",
        description: isLargeMode
          ? "Start the large import run to process all batches asynchronously."
          : "Create the queued import only when preflight is ready or warning-only.",
      },
      {
        label: "Review result and repair rows",
        tone: "pending",
        description: "Open the selected job after import starts to review outcomes and repair failed rows.",
      },
    ],
    [hasBlockingIssues, stagedRun, validationError, canImport, isLargeMode],
  );

  function resetValidationState() {
    setStagedRun(null);
    setValidationError("");
  }

  async function handleValidate() {
    const form = formRef.current;
    if (!form) {
      return;
    }

    const nextFieldErrors: ValidationFieldErrors = {};
    const formData = new FormData(form);
    const categoryId = String(formData.get("categoryId") ?? "").trim();
    const sourceFileEntry = formData.get("sourceFile");
    const chunkSizeRaw = String(formData.get("chunkSize") ?? "").trim();
    const maxRetriesRaw = String(formData.get("maxRetries") ?? "").trim();
    const file = sourceFileEntry instanceof File && sourceFileEntry.size > 0 ? sourceFileEntry : null;

    if (!categoryId) {
      nextFieldErrors.categoryId = "Choose the category scope before validating.";
    }
    if (!file) {
      nextFieldErrors.sourceFile = "Upload a CSV or JSON file before validating.";
    }
    const chunkSize = Number(chunkSizeRaw);
    if (!chunkSizeRaw || !Number.isFinite(chunkSize) || chunkSize < 1 || chunkSize > 500) {
      nextFieldErrors.chunkSize = "Chunk size must be between 1 and 500.";
    }
    const maxRetries = Number(maxRetriesRaw);
    if (!maxRetriesRaw || !Number.isFinite(maxRetries) || maxRetries < 1 || maxRetries > 10) {
      nextFieldErrors.maxRetries = "Max retries must be between 1 and 10.";
    }

    if (Object.keys(nextFieldErrors).length > 0) {
      setFieldErrors(nextFieldErrors);
      setStagedRun(null);
      setValidationError("");
      return;
    }

    setFieldErrors({});
    setValidationError("");
    setValidating(true);
    try {
      if (!file) {
        throw new Error("Upload a CSV or JSON file before validating.");
      }
      const sourceFormat = detectSourceFormat(file.name);
      if (!sourceFormat) {
        throw new Error("Uploaded file must be .csv or .json. Spreadsheet imports remain disabled.");
      }

      let body: Record<string, unknown>;
      if (sourceFormat === "json") {
        const text = await file.text();
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed)) {
          throw new Error("Uploaded JSON file must contain an array of row objects.");
        }
        body = {
          categoryId,
          sourceFormat,
          sourceName: file.name,
          rows: parsed,
          mapping: JSON.parse(DEFAULT_MAPPING),
          chunkSize,
          maxRetries,
        };
      } else {
        body = {
          categoryId,
          sourceFormat,
          sourceName: file.name,
          fileContentBase64: encodeBase64(await file.arrayBuffer()),
          mapping: JSON.parse(DEFAULT_MAPPING),
          chunkSize,
          maxRetries,
        };
      }

      const csrfToken = readCookie("pim_csrf_token");
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
      };

      // Stage the run via the large-run–capable API
      const uploadResponse = await fetch("/api/bulk-import/runs", {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });
      const uploadPayload = await uploadResponse.json();
      if (!uploadResponse.ok || !uploadPayload.id) {
        const serverMsg = uploadPayload.message ?? uploadPayload.error;
        throw new Error(
          serverMsg
            ? String(serverMsg)
            : uploadResponse.status >= 500
              ? "The import file is too large to process. Try reducing the number of rows or using a smaller file."
              : "Failed to stage import run.",
        );
      }
      const runId = uploadPayload.id;

      // Validate the staged run — this path supports up to 30k rows
      const validateResponse = await fetch(`/api/bulk-import/runs/${encodeURIComponent(runId)}/validate`, {
        method: "POST",
        headers,
        body: "{}",
      });
      const validatePayload = await validateResponse.json();
      if (!validateResponse.ok) {
        const serverMsg = (validatePayload as { message?: string }).message ?? (validatePayload as { error?: string }).error;
        throw new Error(serverMsg ? String(serverMsg) : "Import validation failed.");
      }
      setStagedRun(validatePayload as BulkImportRun);
    } catch (error) {
      setStagedRun(null);
      setValidationError(error instanceof Error ? error.message : "Import validation failed.");
    } finally {
      setValidating(false);
    }
  }

  const unmappedFields = stagedRun?.preflightSummary?.unmappedFields ?? [];
  const unusedHeaders = stagedRun?.preflightSummary?.unusedHeaders ?? [];
  const sampleIssues = stagedRun?.preflightSummary?.sampleIssues ?? [];

  return canWrite ? (
    <form ref={formRef} action={submitAction} className="space-y-4" suppressHydrationWarning>
      <input type="hidden" name="mapping" value={DEFAULT_MAPPING} />
      {stagedRun?.id ? <input type="hidden" name="stagedRunId" value={stagedRun.id} /> : null}
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1 text-sm text-slate-700">
          <span className="font-medium">Category</span>
          <select
            name="categoryId"
            required
            defaultValue={categories[0]?.id ?? ""}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            aria-invalid={fieldErrors.categoryId ? "true" : undefined}
            aria-describedby={fieldErrors.categoryId ? "bulk-import-category-error" : undefined}
            onChange={resetValidationState}
          >
            {hasCategories ? (
              categories.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.path ?? category.name ?? category.id}
                </option>
              ))
            ) : (
              <option value="">No categories available</option>
            )}
          </select>
          {fieldErrors.categoryId ? (
            <p id="bulk-import-category-error" className="text-xs text-red-700">
              {fieldErrors.categoryId}
            </p>
          ) : null}
        </label>
        <label className="space-y-1 text-sm text-slate-700">
          <span className="font-medium">Source File</span>
          <input
            type="file"
            name="sourceFile"
            required
            accept=".csv,.json"
            className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            aria-invalid={fieldErrors.sourceFile ? "true" : undefined}
            aria-describedby={fieldErrors.sourceFile ? "bulk-import-file-error" : undefined}
            onChange={resetValidationState}
          />
          {fieldErrors.sourceFile ? (
            <p id="bulk-import-file-error" className="text-xs text-red-700">
              {fieldErrors.sourceFile}
            </p>
          ) : null}
        </label>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1 text-sm text-slate-700">
          <span className="font-medium">Chunk Size</span>
          <input
            type="number"
            name="chunkSize"
            min={1}
            max={500}
            defaultValue={100}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            aria-invalid={fieldErrors.chunkSize ? "true" : undefined}
            aria-describedby={fieldErrors.chunkSize ? "bulk-import-chunk-error" : undefined}
            onChange={resetValidationState}
          />
          {fieldErrors.chunkSize ? (
            <p id="bulk-import-chunk-error" className="text-xs text-red-700">
              {fieldErrors.chunkSize}
            </p>
          ) : null}
        </label>
        <label className="space-y-1 text-sm text-slate-700">
          <span className="font-medium">Max Retries</span>
          <input
            type="number"
            name="maxRetries"
            min={1}
            max={10}
            defaultValue={3}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            aria-invalid={fieldErrors.maxRetries ? "true" : undefined}
            aria-describedby={fieldErrors.maxRetries ? "bulk-import-retries-error" : undefined}
            onChange={resetValidationState}
          />
          {fieldErrors.maxRetries ? (
            <p id="bulk-import-retries-error" className="text-xs text-red-700">
              {fieldErrors.maxRetries}
            </p>
          ) : null}
        </label>
      </div>
      <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
        <p className="font-medium text-slate-800">Accepted columns</p>
        <p>
          Use the canonical fields <code>title</code>, <code>description</code>, <code>brand</code>, <code>hsnCode</code>, <code>gstRate</code>, <code>status</code>, and <code>attributes</code>.
        </p>
        <p>
          The <code>attributes</code> column should contain a JSON object for category-specific fields, for example <code>{'{"material":"cotton","color":"black"}'}</code>.
        </p>
      </div>
      <div className="space-y-3 rounded-md border border-slate-200 bg-white p-3">
        <p className="text-sm font-medium text-slate-900">Staged import workflow</p>
        <WorkflowStepper steps={preflightSteps} />
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleValidate}
          disabled={!hasCategories || validating}
          className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {validating ? "Validating import..." : "Validate import file"}
        </button>
        <PendingSubmitButton
          type="submit"
          disabled={!hasCategories || validating || stagedRun?.status !== "preflight_ready"}
          idleLabel={
            stagedRun?.status === "preflight_ready"
              ? isLargeMode
                ? "Start large import"
                : "Start validated import"
              : "Validate before importing"
          }
          pendingLabel="Uploading and starting import..."
        />
      </div>
      {!stagedRun && !validationError ? (
        <InlineAlert
          tone="info"
          title="Step 1: validate before creating a job"
          message="Upload a CSV or JSON file, review the validation summary, then start the import only after preflight is clear."
        />
      ) : null}
      {validationError ? (
        <div className="space-y-3">
          <InlineAlert
            tone="error"
            title="Import validation failed"
            message={validationError}
          />
          {malformedFileState ? (
            <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">
              <p className="font-medium">Check file format</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                <li>Upload only <code>.csv</code> or <code>.json</code> source files.</li>
                <li>CSV files should keep the first row as canonical headers.</li>
                <li>JSON files must contain an array of row objects.</li>
                <li>Use the sample files in Stage 1 if you need a clean starting template.</li>
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
      {stagedRun && validationTone ? (
        <div className="space-y-3">
          <InlineAlert
            tone={validationTone}
            title={
              !canImport
                ? "Preflight needs fixes"
                : (stagedRun.warningCount ?? 0) > 0
                  ? "Preflight warnings to review"
                  : "Preflight passed"
            }
            message={
              !canImport
                ? "Resolve the blocking issues below before creating the import job."
                : (stagedRun.warningCount ?? 0) > 0
                  ? "The file can still be imported, but review the warning context below before you start the job."
                  : isLargeMode
                    ? "Large import mode is ready. Review the batch summary below, then start the import."
                    : "The file is ready to import. Review the summary below, then start the validated import."
            }
          />
          {isLargeMode && !hasBlockingIssues ? (
            <InlineAlert
              tone="info"
              title="Large import mode"
              message={`This file will be processed as ${stagedRun.estimatedBatchCount ?? "multiple"} batch(es) in the background. Enterprise plan supports up to 30,000 rows per import job.`}
            />
          ) : null}
          {hasBlockingIssues ? (
            <InlineAlert
              tone="warning"
              title="Start import is disabled"
              message={`Preflight found ${stagedRun.blockingIssueCount ?? 0} blocking issue(s). Clear those issues before starting the import job.`}
            />
          ) : null}
          {warningOnlyPreflight ? (
            <InlineAlert
              tone="warning"
              title="Warnings reviewed: import can continue"
              message={`Preflight found ${stagedRun.warningCount ?? 0} warning(s), but no blocking issues. You can continue into Stage 3 and start the import after reviewing the sample issues below.`}
            />
          ) : null}
          <div className="rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-700">
            <p className="font-medium text-slate-900">Preflight readiness</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
                Step 1 complete: file parsed
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
                {canImport ? "Step 2 complete: summary reviewed" : "Step 2 blocked: fix issues first"}
              </span>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-medium text-slate-700">
                {canImport ? "Step 3 ready: start import" : "Step 3 disabled: blocking issues present"}
              </span>
              {isLargeMode ? (
                <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-medium text-blue-700">
                  Large import mode — {stagedRun.estimatedBatchCount ?? "?"} batch(es)
                </span>
              ) : null}
            </div>
            <p className="mt-3 text-sm text-slate-600">
              Review the validation summary before creating the job so operators know whether this file is ready to run, warning-only, or still needs source-data cleanup.
            </p>
          </div>
          <div className="rounded-md border border-slate-200 bg-white p-3 text-sm text-slate-700">
            <p className="font-medium text-slate-900">Validation summary</p>
            <div className="mt-2 grid gap-3 md:grid-cols-3">
              <p><span className="font-medium">Rows:</span> {stagedRun.totalRows ?? 0}</p>
              <p><span className="font-medium">Blocking issues:</span> {stagedRun.blockingIssueCount ?? 0}</p>
              <p><span className="font-medium">Warnings:</span> {stagedRun.warningCount ?? 0}</p>
              <p><span className="font-medium">Accepted rows:</span> {stagedRun.acceptedRows ?? 0}</p>
              <p><span className="font-medium">Failed rows:</span> {stagedRun.failedRows ?? 0}</p>
              <p><span className="font-medium">Category:</span> {stagedRun.category?.path ?? stagedRun.categoryId}</p>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-3">
              <p><span className="font-medium">Mapped fields:</span> {mappedFieldCount}</p>
              <p><span className="font-medium">Unmapped source fields:</span> {unmappedFields.length}</p>
              <p><span className="font-medium">Unused headers:</span> {unusedHeaders.length}</p>
            </div>
            {unmappedFields.length > 0 || unusedHeaders.length > 0 ? (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                <div>
                  <p className="font-medium text-slate-900">Unmapped fields</p>
                  <p className="mt-1 text-sm text-slate-600">
                    {unmappedFields.length > 0 ? unmappedFields.join(", ") : "None"}
                  </p>
                </div>
                <div>
                  <p className="font-medium text-slate-900">Unused headers</p>
                  <p className="mt-1 text-sm text-slate-600">
                    {unusedHeaders.length > 0 ? unusedHeaders.join(", ") : "None"}
                  </p>
                </div>
              </div>
            ) : null}
            {sampleIssues.length > 0 ? (
              <div className="mt-3 space-y-2">
                <p className="font-medium text-slate-900">Representative issues</p>
                <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
                  {sampleIssues.map((issue, index) => (
                    <li key={`issue-${issue.rowNumber}-${index}`}>
                      {issue.rowNumber > 0 ? `Row ${issue.rowNumber}: ` : ""}{issue.message ?? issue.code ?? ""}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </form>
  ) : (
    <p className="text-sm text-slate-600">Import upload is read-only for your role.</p>
  );
}
