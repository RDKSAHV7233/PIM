"use client";

import Link from "next/link";
import { useState } from "react";
import { AppDrawer } from "@/components/ui/app-drawer";
import { StatusChip } from "@/components/ui/status-chip";

interface ConnectorAccountQuickViewProps {
  title: string;
  statusLabel: string;
  statusTone: "neutral" | "success" | "warning" | "danger" | "info";
  externalReference: string;
  installedAt: string;
  lastSyncAt: string;
  lastSyncRelative: string;
  capabilities: string[];
  detailHref: string;
  mappingHref: string;
  contextTitle?: string | null;
  contextSummary?: string | null;
  contextNote?: string | null;
  contextActionHref?: string | null;
  contextActionLabel?: string | null;
}

export function ConnectorAccountQuickView({
  title,
  statusLabel,
  statusTone,
  externalReference,
  installedAt,
  lastSyncAt,
  lastSyncRelative,
  capabilities,
  detailHref,
  mappingHref,
  contextTitle,
  contextSummary,
  contextNote,
  contextActionHref,
  contextActionLabel,
}: ConnectorAccountQuickViewProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        Quick view
      </button>
      <AppDrawer open={open} onClose={() => setOpen(false)} title={title} width="md">
        <div className="space-y-4 text-sm text-slate-700">
          <div className="flex flex-wrap gap-2">
            <StatusChip label={statusLabel} tone={statusTone} />
          </div>

          <div className="grid gap-3">
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">External reference</p>
              <p className="mt-2 text-sm text-slate-700">{externalReference}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Installed</p>
              <p className="mt-2 text-sm text-slate-700">{installedAt}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Last synced</p>
              <p className="mt-2 text-sm text-slate-700">{lastSyncAt}</p>
              <p className="mt-1 text-xs text-slate-500">{lastSyncRelative}</p>
            </div>
          </div>

          <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Supported operations</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {capabilities.length > 0 ? (
                capabilities.map((capability) => (
                  <StatusChip key={capability} label={capability} tone="info" />
                ))
              ) : (
                <StatusChip label="No operations recorded" tone="neutral" />
              )}
            </div>
          </div>

          {contextTitle || contextSummary || contextNote ? (
            <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-3">
              {contextTitle ? (
                <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">{contextTitle}</p>
              ) : null}
              {contextSummary ? <p className="mt-2 text-sm text-slate-700">{contextSummary}</p> : null}
              {contextNote ? <p className="mt-1 text-xs text-slate-500">{contextNote}</p> : null}
              {contextActionHref && contextActionLabel ? (
                <Link
                  href={contextActionHref}
                  className="mt-2 inline-flex items-center rounded-md border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-100"
                  onClick={() => setOpen(false)}
                >
                  {contextActionLabel}
                </Link>
              ) : null}
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Link
              href={detailHref}
              className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Open details
            </Link>
            <Link
              href={mappingHref}
              className="inline-flex items-center rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Open mapping
            </Link>
          </div>
        </div>
      </AppDrawer>
    </>
  );
}
