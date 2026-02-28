"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { postJson } from "@/lib/api";
import type { AppRole, BulkImportJob } from "@/lib/api";
import { translateJobStatus } from "@/lib/errors";

interface ImportProgressProps {
  initialJob: BulkImportJob;
  role: AppRole;
}

const TERMINAL_STATUSES = new Set(["completed", "dead_letter", "failed"]);

export function ImportProgress({ initialJob, role }: ImportProgressProps) {
  const [job, setJob] = useState<BulkImportJob>(initialJob);
  const [startedAt] = useState<number>(() => Date.now());
  const inFlightRef = useRef(false);

  useEffect(() => {
    setJob(initialJob);
  }, [initialJob]);

  useEffect(() => {
    if (TERMINAL_STATUSES.has(job.status)) {
      return;
    }

    const intervalId = window.setInterval(async () => {
      if (inFlightRef.current) {
        return;
      }
      inFlightRef.current = true;
      try {
        const processed = await postJson<BulkImportJob>(
          `/bulk-import/jobs/${encodeURIComponent(job.id)}/process`,
          { chunkSize: job.chunkSize },
          { role },
        );
        setJob(processed);
      } catch {
        // Keep trying in the next tick. Failures are visible in job status fields.
      } finally {
        inFlightRef.current = false;
      }
    }, 1500);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [job.id, job.status, job.chunkSize, role]);

  const progressPct = useMemo(() => {
    if (job.totalRows <= 0) {
      return 0;
    }
    const done = Math.min(job.totalRows, job.successRows + job.failedRows + job.deadLetterRows);
    return Math.max(0, Math.min(100, (done / job.totalRows) * 100));
  }, [job.totalRows, job.successRows, job.failedRows, job.deadLetterRows]);

  const elapsedSeconds = Math.max(1, Math.floor((Date.now() - startedAt) / 1000));
  const completedRows = job.successRows + job.failedRows + job.deadLetterRows;
  const throughput = completedRows > 0 ? completedRows / elapsedSeconds : 0;
  const remainingRows = Math.max(0, job.totalRows - completedRows);
  const etaSeconds = throughput > 0 ? Math.round(remainingRows / throughput) : null;

  return (
    <div className="space-y-2 rounded-md border border-slate-200 bg-white p-3">
      <p className="text-sm font-medium text-slate-800">{translateJobStatus(job.status)}</p>
      <div className="h-2 rounded-full bg-slate-100">
        <div
          className="h-2 rounded-full bg-orange-500 transition-all duration-500 ease-out"
          style={{ width: `${progressPct}%` }}
        />
      </div>
      <p className="text-xs text-slate-600">
        {job.successRows} imported | {job.failedRows + job.deadLetterRows} failed | {job.totalRows} total
      </p>
      <p className="text-xs text-slate-500">
        ~{throughput.toFixed(1)} rows/sec |{" "}
        {etaSeconds === null ? "estimating..." : etaSeconds <= 3 ? "almost done" : `~${etaSeconds}s remaining`}
      </p>
    </div>
  );
}


