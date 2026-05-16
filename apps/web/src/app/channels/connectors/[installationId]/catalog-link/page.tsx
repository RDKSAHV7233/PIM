import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardTitle } from "@/components/ui/card";
import { DataGrid, type Column } from "@/components/ui/data-grid";
import { KpiCard } from "@/components/ui/kpi-card";
import { PageHeader } from "@/components/ui/page-header";
import { StatusChip } from "@/components/ui/status-chip";
import { ApiHttpError, getInstalledConnectors } from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";
import { getProductLinks, scanCatalogLinks } from "@/lib/api/connectors";
import { ConfirmLinksButton } from "./ConfirmLinksButton";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ installationId: string }>;
  searchParams: Promise<{ scan?: string }>;
}

export default async function CatalogLinkPage({ params, searchParams }: PageProps) {
  const { installationId } = await params;
  const { scan } = await searchParams;
  const authHeader = await getServerAuthHeader();
  const role = await getServerActorRole();
  const options = { role, authHeader };
  const returnPath = `/channels/connectors/${installationId}/catalog-link`;

  try {
    const [installations, existingLinks, scanResult] = await Promise.all([
      getInstalledConnectors(options),
      getProductLinks(installationId, options),
      scan === "1" ? scanCatalogLinks(installationId, options) : Promise.resolve(null),
    ]);

    const installation = installations.find((i) => i.id === installationId);
    if (!installation) redirect(`/channels/connectors`);

    const confirmedCount = existingLinks.filter((l) => l.confirmedAt).length;

    return (
      <div className="space-y-5">
        <PageHeader
          title="Catalog Link"
          description={`Match existing Shopify listings to Vexa products for ${installation.accountAlias ?? installationId}.`}
          breadcrumb={
            <>
              Dashboard / Channels / Connections /{" "}
              <Link href={`/channels/connectors/${installationId}`} className="hover:underline text-slate-700">
                {installation.accountAlias ?? installationId}
              </Link>{" "}
              / <span className="font-semibold text-slate-700">Catalog Link</span>
            </>
          }
          actions={
            <Link
              href={`${returnPath}?scan=1`}
              className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              {scan === "1" ? "Re-scan" : "Scan now"}
            </Link>
          }
        />

        <section className="grid gap-4 sm:grid-cols-3">
          <KpiCard label="Confirmed links" value={confirmedCount} tone={confirmedCount > 0 ? "success" : "default"} />
          <KpiCard label="Matched (this scan)" value={scanResult?.matched.length ?? "—"} />
          <KpiCard label="Unmatched" value={scanResult?.unmatched.length ?? "—"} tone={scanResult && scanResult.unmatched.length > 0 ? "warning" : "default"} />
        </section>

        {!scanResult ? (
          <Card>
            <CardTitle>Start a scan</CardTitle>
            <p className="mt-2 text-sm text-slate-600">
              Click "Scan now" to match your Vexa products against Shopify listings using submission history, SKU, and barcode.
            </p>
            <Link
              href={`${returnPath}?scan=1`}
              className="mt-3 inline-flex rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
            >
              Scan now
            </Link>
          </Card>
        ) : (
          <>
            {scanResult.matched.length > 0 ? (
              <Card>
                <CardTitle>Matched ({scanResult.matched.length})</CardTitle>
                <p className="mt-1 text-xs text-slate-500">These products were matched to existing Shopify listings. Confirm to save the links.</p>
                <div className="mt-3">
                  <DataGrid
                    columns={[
                      {
                        key: "productTitle",
                        header: "Vexa Product",
                        render: (m) => (
                          <Link href={`/products/${m.productId}`} className="underline text-slate-700 hover:text-slate-900">
                            {m.productTitle || m.productId.slice(0, 8)}
                          </Link>
                        ),
                      },
                      {
                        key: "shopifySku",
                        header: "SKU",
                        cellClassName: "font-mono text-xs text-slate-600",
                        render: (m) => m.shopifySku || "—",
                      },
                      {
                        key: "shopifyGid",
                        header: "Shopify GID",
                        cellClassName: "font-mono text-xs text-slate-600 max-w-[14rem] truncate",
                        render: (m) => m.shopifyGid,
                      },
                      {
                        key: "matchedBy",
                        header: "Matched by",
                        cellClassName: "text-slate-600",
                        render: (m) => m.matchedBy.replace(/_/g, " "),
                      },
                      {
                        key: "confidence",
                        header: "Confidence",
                        render: (m) => (
                          <StatusChip
                            label={m.confidence}
                            tone={m.confidence === "high" ? "success" : "warning"}
                          />
                        ),
                      },
                    ] as Column<(typeof scanResult.matched)[number]>[]}
                    rows={scanResult.matched}
                    getRowKey={(m) => m.productId}
                  />
                </div>
                <div className="mt-4">
                  <ConfirmLinksButton
                    installationId={installationId}
                    links={scanResult.matched.map((m) => ({
                      productId: m.productId,
                      shopifyGid: m.shopifyGid,
                      matchedBy: m.matchedBy,
                    }))}
                  />
                </div>
              </Card>
            ) : null}

            {scanResult.unmatched.length > 0 ? (
              <Card>
                <CardTitle>Unmatched ({scanResult.unmatched.length})</CardTitle>
                <p className="mt-1 text-sm text-slate-600">
                  These products have no Shopify listing yet. They will be created as new listings on first sync.
                </p>
                <ul className="mt-3 space-y-1 text-sm">
                  {scanResult.unmatched.slice(0, 20).map((p) => (
                    <li key={p.productId} className="flex items-center gap-2">
                      <Link href={`/products/${p.productId}`} className="underline text-slate-700">{p.productTitle || p.productId.slice(0, 8)}</Link>
                      {p.sku ? <span className="font-mono text-xs text-slate-500">{p.sku}</span> : null}
                    </li>
                  ))}
                  {scanResult.unmatched.length > 20 ? (
                    <li className="text-xs text-slate-500">…and {scanResult.unmatched.length - 20} more</li>
                  ) : null}
                </ul>
              </Card>
            ) : null}
          </>
        )}

        {existingLinks.length > 0 ? (
          <Card>
            <CardTitle>Confirmed Links ({existingLinks.length})</CardTitle>
            <div className="mt-3">
              <DataGrid
                columns={[
                  {
                    key: "productId",
                    header: "Product ID",
                    render: (link) => (
                      <Link href={`/products/${link.productId}`} className="underline font-mono text-xs text-slate-700">
                        {link.productId.slice(0, 10)}…
                      </Link>
                    ),
                  },
                  {
                    key: "shopifyGid",
                    header: "Shopify GID",
                    cellClassName: "font-mono text-xs text-slate-600 max-w-[14rem] truncate",
                    render: (link) => link.shopifyGid,
                  },
                  {
                    key: "matchedBy",
                    header: "Method",
                    cellClassName: "text-slate-600",
                    render: (link) => link.matchedBy.replace(/_/g, " "),
                  },
                  {
                    key: "confirmedAt",
                    header: "Confirmed",
                    cellClassName: "text-xs text-slate-600",
                    mobileHide: true,
                    render: (link) => (link.confirmedAt ? new Date(link.confirmedAt).toLocaleDateString() : "Auto"),
                  },
                ] as Column<(typeof existingLinks)[number]>[]}
                rows={existingLinks}
                getRowKey={(link) => link.productId}
              />
            </div>
          </Card>
        ) : null}
      </div>
    );
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect(returnPath, error));
    }
    throw error;
  }
}
