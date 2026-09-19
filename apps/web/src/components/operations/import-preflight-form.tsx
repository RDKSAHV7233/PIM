"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { PendingSubmitButton } from "@/components/ui/pending-submit-button";
import { InlineAlert } from "@/components/ui/inline-alert";
import type { BulkImportRun, Category } from "@/lib/api";
import { readCsrfCookie } from "@/lib/csrf";

const MAX_UPLOAD_BYTES = 32 * 1024 * 1024;

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

type ImportPreflightFormProps = {
  categories: Category[];
  canWrite: boolean;
  initialRun?: BulkImportRun | null;
  submitAction: (formData: FormData) => void | Promise<void>;
};

type ValidationFieldErrors = Partial<Record<"categoryId" | "sourceFile" | "chunkSize" | "maxRetries" | "general", string>>;

type BulkImportValidationIssueGroup = {
  code: string;
  severity: "blocking" | "warning";
  field: string | null;
  message: string;
  affectedRowCount: number;
  sampleRowNumbers: number[];
};

const DEFAULT_MAPPING = JSON.stringify({
  title: "title",
  description: "description",
  brand: "brand",
  skuCode: "skuCode",
  sellingPrice: "sellingPrice",
  hsnCode: "hsnCode",
  gstRate: "gstRate",
  status: "status",
  attributes: "attributes",
});

function serializeMapping(mapping: unknown): string {
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
    return DEFAULT_MAPPING;
  }
  return JSON.stringify(mapping);
}

function csvCell(value: string | number | null | undefined): string {
  const normalized = String(value ?? "");
  return /[",\n\r]/.test(normalized) ? `"${normalized.replace(/"/g, '""')}"` : normalized;
}

function downloadCsv(fileName: string, rows: string[][]) {
  const content = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

export function ImportPreflightForm({ categories, canWrite, initialRun = null, submitAction }: ImportPreflightFormProps) {
  const formRef = useRef<HTMLFormElement | null>(null);
  const sourceFileRef = useRef<HTMLInputElement | null>(null);
  const validationHeadingRef = useRef<HTMLParagraphElement | null>(null);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [stagedRun, setStagedRun] = useState<BulkImportRun | null>(initialRun);
  const [fieldErrors, setFieldErrors] = useState<ValidationFieldErrors>({});
  const [validationError, setValidationError] = useState<string>("");
  const [validating, setValidating] = useState(false);
  const [hasSelectedFile, setHasSelectedFile] = useState(false);
  const [selectedCategoryId, setSelectedCategoryId] = useState(initialRun?.categoryId ?? categories[0]?.id ?? "");

  const hasCategories = categories.length > 0;
  const validation = stagedRun?.preflightSummary ?? null;
  const canImport = validation?.canImport ?? false;
  const canStartImport = canImport && stagedRun?.status === "preflight_ready";
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

  // Stable primitive derived from `categories`: the array reference changes on
  // every server round-trip (e.g. router.replace from resetValidationState),
  // but this string only changes when the actual first category differs. Using
  // it (instead of the array itself) as an effect dependency below prevents the
  // reset effect from firing on unrelated re-renders and clobbering in-flight
  // user state (a just-set validation error, a just-picked category).
  const firstCategoryId = useMemo(() => categories[0]?.id ?? "", [categories]);

  useEffect(() => {
    setStagedRun(initialRun);
    setValidationError("");
    setFieldErrors({});
    setSelectedCategoryId(initialRun?.categoryId ?? firstCategoryId);
  }, [firstCategoryId, initialRun?.categoryId, initialRun?.id, initialRun?.status, initialRun?.updatedAt]);

  useEffect(() => {
    if (stagedRun || validationError) {
      validationHeadingRef.current?.focus();
    }
  }, [stagedRun?.id, stagedRun?.status, validationError]);

  function replaceImportsQuery(updater: (params: URLSearchParams) => void) {
    const nextParams = new URLSearchParams(searchParams.toString());
    updater(nextParams);
    nextParams.delete("runRowCursor");
    const queryString = nextParams.toString();
    router.replace(queryString ? `${pathname}?${queryString}` : pathname, { scroll: false });
  }

  function selectRunInUrl(runId: string) {
    replaceImportsQuery((params) => {
      params.delete("bulkJobId");
      params.set("bulkRunId", runId);
    });
  }

  function clearSelectedImportUrl() {
    replaceImportsQuery((params) => {
      params.delete("bulkRunId");
      params.delete("bulkJobId");
    });
  }

  function resetValidationState() {
    setStagedRun(null);
    setValidationError("");
    clearSelectedImportUrl();
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
    } else if (file.size > MAX_UPLOAD_BYTES) {
      nextFieldErrors.sourceFile = `File exceeds the ${MAX_UPLOAD_BYTES / (1024 * 1024)} MB upload limit.`;
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
      clearSelectedImportUrl();
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

      if (sourceFormat === "json") {
        const text = await file.text();
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed)) {
          throw new Error("Uploaded JSON file must contain an array of row objects.");
        }
      }

      const csrfToken = readCsrfCookie();
      const commonHeaders: Record<string, string> = {
        Accept: "application/json",
        ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
      };

      // Upload via multipart FormData — avoids the body-size limit that
      // breaks base64-in-JSON for large CSV files.
      const uploadForm = new FormData();
      uploadForm.append("sourceFile", file);
      uploadForm.append("categoryId", categoryId);
      uploadForm.append("sourceFormat", sourceFormat);
      uploadForm.append("sourceName", file.name);
      uploadForm.append("maxRetries", String(maxRetries));

      const uploadResponse = await fetch("/api/bulk-import/runs/upload", {
        method: "POST",
        headers: commonHeaders,
        body: uploadForm,
      });
      const uploadPayload = await uploadResponse.json();
      if (!uploadResponse.ok || !uploadPayload.id) {
        const serverMsg = uploadPayload.message ?? uploadPayload.error;
        throw new Error(serverMsg ? String(serverMsg) : "Failed to upload import file.");
      }
      const runId: string = uploadPayload.id;

      // Validate the run — reads the stored file from storage, runs full
      // preflight checks, and transitions "uploaded" → "preflight_ready".
      const validateResponse = await fetch(`/api/bulk-import/runs/${encodeURIComponent(runId)}/validate`, {
        method: "POST",
        headers: { ...commonHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const validatePayload = await validateResponse.json();
      if (!validateResponse.ok) {
        const serverMsg = (validatePayload as { message?: string }).message ?? (validatePayload as { error?: string }).error;
        throw new Error(serverMsg ? String(serverMsg) : "Import validation failed.");
      }

      const mergedRun: BulkImportRun = validatePayload as BulkImportRun;
      setStagedRun(mergedRun);
      selectRunInUrl(mergedRun.id);

      // Clear the file input so the form submission only sends stagedRunId,
      // keeping the Server Action request body well under the Next.js body limit.
      const fileInput = sourceFileRef.current ?? form.querySelector<HTMLInputElement>('input[type="file"]');
      if (fileInput) fileInput.value = "";
      setHasSelectedFile(false);
    } catch (error) {
      setStagedRun(null);
      setValidationError(error instanceof Error ? error.message : "Import validation failed.");
      clearSelectedImportUrl();
    } finally {
      setValidating(false);
    }
  }

  const unmappedFields = stagedRun?.preflightSummary?.unmappedFields ?? [];
  const unusedHeaders = stagedRun?.preflightSummary?.unusedHeaders ?? [];
  const sampleIssues = stagedRun?.preflightSummary?.sampleIssues ?? [];
  const issueGroups = ((stagedRun?.preflightSummary as { issueGroups?: BulkImportValidationIssueGroup[] } | null)?.issueGroups ?? []);
  const summaryDownloadRows = useMemo<string[][]>(() => {
    const groups: BulkImportValidationIssueGroup[] =
      issueGroups.length > 0
        ? issueGroups
        : sampleIssues.map((issue) => ({
            code: issue.code,
            severity: issue.severity,
            field: issue.fieldPath ?? null,
            message: "Representative validation issue found.",
            affectedRowCount: 1,
            sampleRowNumbers: [issue.rowNumber],
          }));
    return [
      ["severity", "code", "field", "affectedRowCount", "sampleRowNumbers", "message"],
      ...groups.map((group) => [
        group.severity,
        group.code,
        group.field ?? "",
        String(group.affectedRowCount),
        group.sampleRowNumbers.join(" "),
        group.message,
      ]),
    ];
  }, [issueGroups, sampleIssues]);
  function handleDownloadValidationSummary() {
    if (!stagedRun) {
      return;
    }
    downloadCsv(`bulk-import-validation-${stagedRun.id}.csv`, summaryDownloadRows);
  }
  function handleReplaceFile() {
    resetValidationState();
    setHasSelectedFile(false);
    if (sourceFileRef.current) {
      sourceFileRef.current.value = "";
      sourceFileRef.current.click();
    }
  }
  const formatSampleIssue = (issue: unknown) => {
    if (!issue || typeof issue !== "object") {
      return "";
    }
    const record = issue as Record<string, unknown>;
    if (typeof record.message === "string" && record.message.trim()) {
      return record.message.trim();
    }
    if (Array.isArray(record.issues)) {
      return record.issues
        .map((value) => String(value ?? "").trim())
        .filter(Boolean)
        .join("; ");
    }
    if (typeof record.code === "string" && record.code.trim()) {
      return record.code.trim();
    }
    return "Validation issue found.";
  };
  const effectiveMapping = serializeMapping(stagedRun?.preflightSummary?.mapping);

  return canWrite ? (
    <form ref={formRef} action={submitAction} className="space-y-4" suppressHydrationWarning>
      <input type="hidden" name="mapping" value={effectiveMapping} />
      <input type="hidden" name="stagedRunId" value={stagedRun ? stagedRun.id : ""} />
      <input type="hidden" name="sourceFormat" value={stagedRun?.sourceFormat ?? ""} />
      <input type="hidden" name="sourceName" value={stagedRun?.sourceName ?? ""} />
      <div className="grid gap-4 md:grid-cols-2">
        <label className="space-y-1 text-sm text-slate-700">
          <span className="font-medium">Category</span>
          <select
            name="categoryId"
            required
            value={selectedCategoryId}
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            aria-invalid={fieldErrors.categoryId ? "true" : undefined}
            aria-describedby={fieldErrors.categoryId ? "bulk-import-category-error" : undefined}
            onChange={(event) => {
              setSelectedCategoryId(event.currentTarget.value);
              resetValidationState();
            }}
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
            ref={sourceFileRef}
            type="file"
            name="sourceFile"
            required={!stagedRun}
            accept=".csv,.json"
            className="block w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            aria-invalid={fieldErrors.sourceFile ? "true" : undefined}
            aria-describedby={fieldErrors.sourceFile ? "bulk-import-file-error" : "bulk-import-file-guidance"}
            onChange={(event) => {
              setHasSelectedFile((event.currentTarget.files?.length ?? 0) > 0);
              resetValidationState();
            }}
          />
          <p id="bulk-import-file-guidance" className="text-xs text-slate-500">
            CSV or JSON only. Maximum upload size: 32 MB. Large files are uploaded using staged validation before import.
          </p>
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
          Use the canonical fields <code>title</code>, <code>description</code>, <code>brand</code>, <code>skuCode</code>, <code>sellingPrice</code>, <code>hsnCode</code>, <code>gstRate</code>, <code>status</code>, and <code>attributes</code>.
        </p>
        <p>
          The <code>attributes</code> column should contain a JSON object for category-specific fields, for example <code>{'{"material":"cotton","color":"black"}'}</code>.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleValidate}
          disabled={!hasCategories || validating}
          className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {validating ? "Validating import..." : stagedRun || validationError ? "Revalidate file" : "Validate file"}
        </button>
        <PendingSubmitButton
          type="submit"
          disabled={!hasCategories || validating || !canStartImport}
          idleLabel={canStartImport ? "Start validated import" : "Validate before importing"}
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
        <div className="space-y-3" aria-live="polite" aria-atomic="true">
          <p ref={validationHeadingRef} tabIndex={-1} className="sr-only">
            Import validation failed
          </p>
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
        <div className="space-y-3" aria-live="polite" aria-atomic="true">
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
            <p ref={validationHeadingRef} tabIndex={-1} className="font-medium text-slate-900">
              Validation summary
            </p>
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
            {issueGroups.length > 0 ? (
              <div className="mt-3 space-y-2">
                <p className="font-medium text-slate-900">Grouped validation issues</p>
                <div className="space-y-2">
                  {issueGroups.map((group) => (
                    <div
                      key={`${group.severity}-${group.code}-${group.field ?? "file"}`}
                      className="rounded-md border border-slate-200 bg-slate-50 p-3"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={group.severity === "blocking" ? "font-semibold text-rose-700" : "font-semibold text-amber-700"}>
                          {group.severity === "blocking" ? "Blocking" : "Warning"}
                        </span>
                        <code className="rounded bg-white px-1.5 py-0.5 text-xs text-slate-700">{group.code}</code>
                        {group.field ? <span className="text-xs text-slate-500">Field: {group.field}</span> : null}
                      </div>
                      <p className="mt-1 text-sm text-slate-700">{group.message}</p>
                      <p className="mt-1 text-xs text-slate-500">
                        {group.affectedRowCount} affected row(s)
                        {group.sampleRowNumbers.length > 0
                          ? `; sample rows: ${group.sampleRowNumbers.join(", ")}`
                          : ""}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
            {sampleIssues.length > 0 ? (
              <div className="mt-3 space-y-2">
                <p className="font-medium text-slate-900">Representative issues</p>
                <ul className="list-disc space-y-1 pl-5 text-sm text-slate-600">
                  {sampleIssues.map((issue, index) => (
                    <li key={`issue-${issue.rowNumber}-${index}`}>
                      {issue.rowNumber > 0 ? `Row ${issue.rowNumber}: ` : ""}{formatSampleIssue(issue)}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleDownloadValidationSummary}
                className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Download validation summary
              </button>
              <Link
                href="/api/imports/templates/sample.csv"
                className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Download sample CSV
              </Link>
              <button
                type="button"
                onClick={handleReplaceFile}
                className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
              >
                Replace file
              </button>
              <button
                type="button"
                onClick={handleValidate}
                disabled={validating || !hasSelectedFile}
                className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
                aria-describedby={!hasSelectedFile ? "bulk-import-revalidate-guidance" : undefined}
              >
                Revalidate
              </button>
            </div>
            {!hasSelectedFile ? (
              <p id="bulk-import-revalidate-guidance" className="mt-2 text-xs text-slate-500">
                Select a source file again before revalidating; browsers do not retain file bytes after staged upload.
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
    </form>
  ) : (
    <p className="text-sm text-slate-600">Import upload is read-only for your role.</p>
  );
}
