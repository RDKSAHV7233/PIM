import Link from "next/link";
import { notFound } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { getConnectorDefinitions } from "@/lib/api";
import { getServerSession } from "@/lib/server-session";

export const dynamic = "force-dynamic";

const STAGE_LABELS: Record<string, string> = {
  planned: "Planned",
  under_development: "Under development",
  code_complete: "Code complete",
  qa_validation: "QA validation",
  po_review: "PO review",
  early_access: "Early access",
  controlled_pilot: "Controlled pilot",
  p1_blocker_hold: "P1 blocker-closure hold",
  manual: "Manual export",
  live: "Live",
  deprecated: "Deprecated",
  internal_diagnostic: "Internal diagnostic",
};

const STAGE_TONES: Record<string, string> = {
  live: "bg-emerald-100 text-emerald-900",
  manual: "bg-sky-100 text-sky-900",
  early_access: "bg-violet-100 text-violet-900",
  controlled_pilot: "bg-amber-100 text-amber-900",
  p1_blocker_hold: "bg-rose-100 text-rose-900",
  code_complete: "bg-amber-100 text-amber-900",
  qa_validation: "bg-amber-100 text-amber-900",
  po_review: "bg-amber-100 text-amber-900",
  under_development: "bg-orange-100 text-orange-900",
  planned: "bg-slate-200 text-slate-700",
  deprecated: "bg-rose-100 text-rose-900",
  internal_diagnostic: "bg-slate-300 text-slate-800",
};

const IMPLEMENTATION_TONES: Record<string, string> = {
  full: "bg-emerald-100 text-emerald-900",
  partial: "bg-amber-100 text-amber-900",
  stub: "bg-slate-200 text-slate-700",
};

type PipelineMetadata = {
  owner: string;
  milestone: string | null;
  blockers: string[];
  internalNotes: string | null;
};

const PIPELINE_METADATA: Record<string, PipelineMetadata> = {
  shopify: { owner: "Platform", milestone: null, blockers: [], internalNotes: "GA — full lifecycle support." },
  myntra: { owner: "Platform", milestone: null, blockers: [], internalNotes: "GA — Listing Management API." },
  flipkart: { owner: "Platform", milestone: null, blockers: [], internalNotes: "GA — default fallback connector." },
  meesho: { owner: "Platform", milestone: "RD-MEESHO-1", blockers: ["Meesho API access pending"], internalNotes: "Export-only. Waiting on Meesho partner API programme." },
  nykaa: { owner: "Platform", milestone: null, blockers: ["Nykaa platform-partner credentials"], internalNotes: "Export-only. Direct API requires partner credentials." },
  "amazon-in": { owner: "Platform", milestone: "Sprint F", blockers: ["Feeds API bulk publish validation"], internalNotes: "Experimental preview. Install + credential validation available; publish under validation." },
  woocommerce: {
    owner: "Platform",
    milestone: "P1 blocker-closure hold",
    blockers: [
      "P1-1 tenant-owned app-auth credential verification",
      "P1-2 auth revocation failure policy",
      "staging runtime proof and fresh CTO/PO/Security/QA/SRE signoff",
    ],
    internalNotes:
      "W1-W10 code-complete and historical P0 remediation evidence exists, but WooCommerce is not customer-installable while P1-1/P1-2 are open.",
  },
};

function getMetadata(slug: string): PipelineMetadata {
  return PIPELINE_METADATA[slug.toLowerCase()] ?? { owner: "Unknown", milestone: null, blockers: [], internalNotes: null };
}

function formatStage(stage: string): string {
  return STAGE_LABELS[stage] ?? stage;
}

function stageTone(stage: string): string {
  return STAGE_TONES[stage] ?? "bg-slate-200 text-slate-700";
}

function implTone(status: string | undefined): string {
  return IMPLEMENTATION_TONES[status ?? ""] ?? "bg-slate-200 text-slate-700";
}

function isCustomerVisible(stage: string): boolean {
  return stage === "live" || stage === "manual";
}

export default async function ConnectorPipelinePage() {
  const { authHeader, actorRole, adminBoundaryRoles } = await getServerSession();

  const isSystemAdmin = adminBoundaryRoles.includes("system_admin");
  const isSuperAdmin = adminBoundaryRoles.includes("super_admin");
  if (actorRole !== "admin" || (!isSystemAdmin && !isSuperAdmin)) {
    notFound();
  }

  const definitions = await getConnectorDefinitions({
    role: actorRole,
    authHeader,
    revalidateSeconds: 0,
  });

  const liveCount = definitions.filter((d) => d.launchStage === "live").length;
  const manualCount = definitions.filter((d) => d.launchStage === "manual").length;
  const inProgressCount = definitions.filter((d) => !isCustomerVisible(d.launchStage)).length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Connector Pipeline"
        description="Internal view of registered connector definitions across launch stages. Not visible to customers."
        breadcrumb={
          <>
            <Link href="/dashboard" className="hover:underline">Dashboard</Link>
            {" / "}
            <Link href="/admin/connectors" className="hover:underline">Governance</Link>
            {" / "}
            <span className="font-semibold text-slate-700">Pipeline</span>
          </>
        }
      />

      <div className="grid gap-3 md:grid-cols-3">
        <div className="rounded-md border border-slate-200 bg-white p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Live</div>
          <div className="mt-2 text-2xl font-semibold text-emerald-900">{liveCount}</div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Manual export</div>
          <div className="mt-2 text-2xl font-semibold text-sky-900">{manualCount}</div>
        </div>
        <div className="rounded-md border border-slate-200 bg-white p-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">In progress</div>
          <div className="mt-2 text-2xl font-semibold text-amber-900">{inProgressCount}</div>
        </div>
      </div>

      <Card>
        <CardTitle>All connectors</CardTitle>
        <div className="mt-4 space-y-4">
          {definitions.length === 0 ? (
            <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-700">
              No connector definitions returned. The API may be filtering results — check that your account has system_admin or super_admin boundary roles.
            </div>
          ) : null}
          {definitions.map((def) => {
            const meta = getMetadata(def.slug);
            const customerVisible = isCustomerVisible(def.launchStage);
            return (
              <div key={def.id} className="rounded-md border border-slate-200 bg-white p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="font-semibold text-slate-900">{def.displayName}</div>
                    <div className="mt-1 text-xs text-slate-500">{def.slug} &middot; v{def.connectorVersion}</div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${stageTone(def.launchStage)}`}>
                      {formatStage(def.launchStage)}
                    </span>
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${implTone(def.implementationStatus)}`}>
                      {def.implementationStatus ?? "unknown"}
                    </span>
                    {customerVisible ? (
                      <span className="inline-flex rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">
                        Customer visible
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                        Internal only
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-3 grid gap-3 text-sm text-slate-700 md:grid-cols-2 xl:grid-cols-4">
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Capabilities</div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {def.capabilities.map((cap) => (
                        <span key={cap} className="inline-flex rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-700">
                          {cap}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Owner</div>
                    <div className="mt-1">{meta.owner}</div>
                    {meta.milestone ? (
                      <div className="text-xs text-slate-500">Milestone: {meta.milestone}</div>
                    ) : null}
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Blockers</div>
                    {meta.blockers.length > 0 ? (
                      <ul className="mt-1 list-disc pl-4 text-xs text-amber-800">
                        {meta.blockers.map((b) => <li key={b}>{b}</li>)}
                      </ul>
                    ) : (
                      <div className="mt-1 text-xs text-emerald-700">None</div>
                    )}
                  </div>
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Auth</div>
                    <div className="mt-1">{def.authType}</div>
                  </div>
                </div>

                {def.launchNote || meta.internalNotes ? (
                  <div className="mt-3 rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    {meta.internalNotes ? (
                      <div className="text-xs text-slate-600">{meta.internalNotes}</div>
                    ) : null}
                    {def.launchNote && def.launchNote !== meta.internalNotes ? (
                      <div className="mt-1 text-xs text-slate-500">{def.launchNote}</div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </Card>

      <Card>
        <CardTitle>Visibility rules</CardTitle>
        <div className="mt-3 space-y-2 text-sm text-slate-700">
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="font-semibold">Customer catalog</div>
            <div className="mt-1 text-xs text-slate-500">Shows only <strong>live</strong> and <strong>manual</strong> stage connectors. Under-development, planned, deprecated, and diagnostic connectors are hidden.</div>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="font-semibold">Setup page</div>
            <div className="mt-1 text-xs text-slate-500">Shows customer-eligible setup stages for new installations; controlled-pilot and P1 hold connectors stay hidden.</div>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="font-semibold">This pipeline page</div>
            <div className="mt-1 text-xs text-slate-500">Shows <strong>all registered</strong> connector definitions regardless of stage. Connectors with only a launch-policy entry but no database definition (e.g. WooCommerce during pre-QA) do not appear here. Visible only to system_admin and super_admin boundary roles.</div>
          </div>
          <div className="rounded-md border border-slate-200 bg-slate-50 p-3">
            <div className="font-semibold">Install guard</div>
            <div className="mt-1 text-xs text-slate-500">Only <strong>live</strong> and <strong>manual</strong> stage connectors can be installed. All other stages are blocked at the API level regardless of visibility.</div>
          </div>
        </div>
      </Card>
    </div>
  );
}
