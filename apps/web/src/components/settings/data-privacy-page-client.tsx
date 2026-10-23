"use client";

import Link from "@/components/ui/app-link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/ui/page-header";
import type { AppRole } from "@/lib/api";
import { formatDateTime } from "@/lib/format";
import { readCsrfCookie } from "@/lib/csrf";

type ExportFormat = "json" | "csv";

interface PrivacyStatusPayload {
  commercialState: {
    billingStatus: string;
    accessStatus: string;
    suspensionReason: string | null;
    suspendedAt: string | null;
  };
  latestConsent: {
    accepted: boolean;
    policyVersion: string;
    purpose: string;
    consentRecordedAt: string;
  } | null;
  latestExport: {
    jobId: string;
    status: string;
    format: string;
    requestedAt: string;
    estimatedReadyInSeconds: number;
    completedAt: string | null;
    failedAt: string | null;
    errorMessage: string | null;
    downloadAvailable: boolean;
  } | null;
  latestDeletion: {
    ticketId: string;
    status: string;
    requestedAt: string;
    scheduledFor: string;
  } | null;
}

interface DataPrivacyPageClientProps {
  actorRole: AppRole;
}

export function DataPrivacyPageClient({ actorRole }: DataPrivacyPageClientProps) {
  const [exportFormat, setExportFormat] = useState<ExportFormat>("json");
  const [exportMessage, setExportMessage] = useState("");
  const [deleteMessage, setDeleteMessage] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [deleteReason, setDeleteReason] = useState("");
  const [working, setWorking] = useState<"export" | "delete" | null>(null);
  const [statusError, setStatusError] = useState("");
  const [status, setStatus] = useState<PrivacyStatusPayload | null>(null);
  const exportBlockedBySuspension = status?.commercialState?.accessStatus === "suspended";
  const scopeNote =
    actorRole === "admin"
      ? "This page applies only to your signed-in account. It does not manage exports or deletion requests for other workspace users."
      : "These controls apply only to your signed-in account.";

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/account/privacy-status", {
        method: "GET",
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => ({}))) as { error?: string };
        if (response.status === 401) {
          setStatusError("Session expired. Please login again.");
          return;
        }
        setStatusError(payload.error ?? "Unable to load privacy status.");
        return;
      }
      const payload = (await response.json()) as PrivacyStatusPayload;
      setStatus(payload);
      setStatusError("");
    } catch {
      setStatusError("Network error while loading privacy status.");
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    const exportStatus = status?.latestExport?.status;
    if (exportStatus !== "queued" && exportStatus !== "processing") {
      return undefined;
    }

    const timer = setInterval(() => {
      void loadStatus();
    }, 30_000);
    return () => clearInterval(timer);
  }, [loadStatus, status?.latestExport?.status]);

  async function requestExport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking("export");
    setExportMessage("");

    try {
      const csrfToken = readCsrfCookie();
      const response = await fetch("/api/account/export", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        },
        body: JSON.stringify({ format: exportFormat }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        jobId?: string;
        estimatedReadyInSeconds?: number;
        note?: string;
        error?: string;
      };
      if (!response.ok) {
        if (response.status === 401) {
          setExportMessage("Session expired. Please login again.");
          return;
        }
        if (response.status === 403) {
          if (payload.error === "TENANT_SUSPENDED") {
            setExportMessage(
              "New export requests are paused while the workspace is suspended. You can still download any export that was already prepared.",
            );
            return;
          }
          setExportMessage("You do not have permission to request an account export.");
          return;
        }
        setExportMessage(payload.error ?? "Unable to queue export.");
        return;
      }
      setExportMessage(
        `Export requested (${payload.jobId ?? "n/a"}). ${payload.note ?? "We will email you when the export is ready."}`,
      );
      await loadStatus();
    } catch {
      setExportMessage("Network error while recording export request.");
    } finally {
      setWorking(null);
    }
  }

  async function requestDelete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking("delete");
    setDeleteMessage("");

    try {
      const csrfToken = readCsrfCookie();
      const response = await fetch("/api/account", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
        },
        body: JSON.stringify({
          confirmation,
          reason: deleteReason,
        }),
      });

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
        ticketId?: string;
        scheduledFor?: string;
      };
      if (!response.ok) {
        if (response.status === 401) {
          setDeleteMessage("Session expired. Please login again.");
          return;
        }
        setDeleteMessage(payload.error ?? "Unable to schedule account deletion.");
        return;
      }
      setDeleteMessage(
        `Deletion scheduled (${payload.ticketId ?? "n/a"}). Effective at ${payload.scheduledFor ?? "next cycle"}.`,
      );
      setConfirmation("");
      setDeleteReason("");
    } catch {
      setDeleteMessage("Network error while scheduling deletion.");
    } finally {
      setWorking(null);
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Data and Privacy"
        description="Manage the signed-in account's privacy status and deletion workflow. Account exports are prepared asynchronously and can be downloaded here when ready."
        breadcrumb={<><Link href="/dashboard">Dashboard</Link>{" / "}<span className="font-semibold text-slate-700">Data & Privacy</span></>}
      />
      {scopeNote ? <p className="text-sm text-slate-500">{scopeNote}</p> : null}

      <section className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-4 text-sm text-slate-700">
        <h2 className="text-base font-semibold text-slate-900">Current account privacy status</h2>
        {statusError ? (
          <p className="text-red-700">{statusError}</p>
        ) : (
          <div className="space-y-1">
            {status?.commercialState?.accessStatus === "suspended" ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                <p className="font-medium">Workspace access is suspended.</p>
                <p>
                  New export requests are paused while suspension is in effect. Previously prepared exports can still
                  be downloaded here, and account deletion remains available.
                </p>
                {status.commercialState.suspensionReason ? (
                  <p className="mt-1">Reason: {status.commercialState.suspensionReason}</p>
                ) : null}
              </div>
            ) : null}
            <p>
              Latest consent:{" "}
              {status?.latestConsent
                ? `${status.latestConsent.policyVersion} at ${formatDateTime(status.latestConsent.consentRecordedAt)}`
                : "No consent recorded yet."}
            </p>
            <p>
              Latest export:{" "}
              {status?.latestExport ? (
                <>
                  {`${status.latestExport.status} (${status.latestExport.format.toUpperCase()}) requested at ${formatDateTime(status.latestExport.requestedAt)}`}
                  {status.latestExport.completedAt
                    ? `, ready at ${formatDateTime(status.latestExport.completedAt)}`
                    : ""}
                  {status.latestExport.downloadAvailable ? (
                    <>
                      {" "}
                      <a
                        href={`/api/account/export/${encodeURIComponent(status.latestExport.jobId)}/download`}
                        className="underline"
                      >
                        Download export
                      </a>
                    </>
                  ) : null}
                  {status.latestExport.errorMessage ? ` (${status.latestExport.errorMessage})` : ""}
                </>
              ) : (
                "No export request yet."
              )}
            </p>
            <p>
              Latest deletion:{" "}
              {status?.latestDeletion
                ? `${status.latestDeletion.status} for ${formatDateTime(status.latestDeletion.scheduledFor)}`
                : "No deletion request yet."}
            </p>
          </div>
        )}
      </section>

      <section className="space-y-3 rounded-md border border-slate-200 bg-white p-4">
        <h2 className="text-lg font-semibold text-slate-900">Request data export</h2>
          <p className="text-sm text-slate-600">
            Request an export of the signed-in account&apos;s activity and privacy records. We will prepare the file in the background and email you when it is ready.
          </p>
        <form className="space-y-3" onSubmit={requestExport}>
          <div className="space-y-1">
            <label htmlFor="export-format" className="text-xs font-semibold uppercase tracking-wide text-slate-600">
              Format
            </label>
            <select
              id="export-format"
              value={exportFormat}
              onChange={(event) => setExportFormat(event.target.value as ExportFormat)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            >
              <option value="json">JSON</option>
              <option value="csv">CSV</option>
            </select>
          </div>
          <button
            type="submit"
            disabled={working !== null || exportBlockedBySuspension}
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {working === "export"
              ? "Requesting export..."
              : exportBlockedBySuspension
                ? "Export requests paused during suspension"
                : "Request export"}
          </button>
        </form>
        {exportMessage && <p className="text-sm text-slate-700">{exportMessage}</p>}
      </section>

      <section className="space-y-3 rounded-md border border-red-200 bg-red-50 p-4">
        <h2 className="text-lg font-semibold text-red-900">Delete this account</h2>
        <p className="text-sm text-red-800">
          This schedules irreversible account erasure. Type <span className="font-semibold">DELETE</span> to confirm.
        </p>
        <form className="space-y-3" onSubmit={requestDelete}>
          <div className="space-y-1">
            <label htmlFor="delete-confirmation" className="text-xs font-semibold uppercase tracking-wide text-red-700">
              Confirmation text
            </label>
            <input
              id="delete-confirmation"
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              className="w-full rounded-md border border-red-300 bg-white px-3 py-2 text-sm"
              placeholder="Type DELETE"
              required
            />
          </div>
          <div className="space-y-1">
            <label htmlFor="delete-reason" className="text-xs font-semibold uppercase tracking-wide text-red-700">
              Reason (optional)
            </label>
            <textarea
              id="delete-reason"
              value={deleteReason}
              onChange={(event) => setDeleteReason(event.target.value)}
              className="w-full rounded-md border border-red-300 bg-white px-3 py-2 text-sm"
              rows={3}
            />
          </div>
          <button
            type="submit"
            disabled={working !== null || confirmation.trim().toUpperCase() !== "DELETE"}
            className="rounded-md bg-red-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {working === "delete" ? "Scheduling deletion..." : "Schedule account deletion"}
          </button>
        </form>
        {deleteMessage && <p className="text-sm text-red-900">{deleteMessage}</p>}
      </section>
    </div>
  );
}
