import Link from "next/link";
import { redirect } from "next/navigation";
import { bulkAssociateMediaCsvAction, updateMediaGovernanceAction, uploadMediaAssetAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { DataGrid, type Column } from "@/components/ui/data-grid";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { PlanLimitModal } from "@/components/ui/plan-limit-modal";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  ApiHttpError,
  AppRole,
  MarketplaceChannel,
  getMediaAssets,
  getMediaAssetValidation,
  getProductList,
} from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { READINESS_CHANNELS } from "@/lib/channel-readiness";
import {
  DEFAULT_MARKETPLACE_CHANNEL,
  formatMarketplaceChannelLabel,
  normalizeMarketplaceChannel,
} from "@/lib/marketplace-channels";
import { canEditWorkspace } from "@/lib/role-capabilities";
import { getServerSession } from "@/lib/server-session";
import { filterTestData } from "@/lib/test-data-filter";

export const dynamic = "force-dynamic";

function normalizeChannel(value: MarketplaceChannel | undefined): MarketplaceChannel {
  return normalizeMarketplaceChannel(
    value,
    READINESS_CHANNELS,
    READINESS_CHANNELS[0] ?? DEFAULT_MARKETPLACE_CHANNEL,
  );
}

function RoleHiddenInput({ role }: { role: AppRole }) {
  return <input type="hidden" name="actorRole" value={role} />;
}

function formatDateTime(value: string | null): string {
  if (!value) {
    return "Not checked";
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return "Not checked";
  }
  return parsed.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
}

interface MediaPageProps {
  searchParams: Promise<{
    productId?: string;
    productSearch?: string;
    variantId?: string;
    assetId?: string;
    bulkAssociationStatus?: string;
    channel?: MarketplaceChannel;
    uploadError?: string;
    planLimit?: string;
    planResource?: string;
    planLimitValue?: string;
    planCurrent?: string;
    planUpgrade?: string;
    planContact?: string;
  }>;
}

export default async function MediaPage({ searchParams }: MediaPageProps) {
  const query = await searchParams;
  const { authHeader, actorRole } = await getServerSession();
  const canWrite = canEditWorkspace(actorRole);
  const productId = String(query.productId ?? "").trim();
  const productSearch = String(query.productSearch ?? "").trim();
  const variantId = String(query.variantId ?? "").trim();
  const channel = normalizeChannel(query.channel);
  const assetId = String(query.assetId ?? "").trim();
  const bulkAssociationStatus = String(query.bulkAssociationStatus ?? "").trim();
  const uploadError = String(query.uploadError ?? "").trim();
  const showPlanLimitModal =
    String(query.planLimit ?? "").trim() === "1" &&
    String(query.planResource ?? "").trim().length > 0 &&
    Number.isFinite(Number(query.planLimitValue)) &&
    Number.isFinite(Number(query.planCurrent)) &&
    String(query.planUpgrade ?? "").trim().length > 0;
  const planLimitResource = String(query.planResource ?? "").trim();
  const planLimitValue = Number(query.planLimitValue);
  const planCurrent = Number(query.planCurrent);
  const planUpgrade = String(query.planUpgrade ?? "").trim();
  const planContact = String(query.planContact ?? "").trim() || null;
  const dismissPlanLimitHref = (() => {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, raw]) => {
      if (
        key === "planLimit" ||
        key === "planResource" ||
        key === "planLimitValue" ||
        key === "planCurrent" ||
        key === "planUpgrade" ||
        key === "planContact"
      ) {
        return;
      }
      const value = String(raw ?? "").trim();
      if (value.length > 0) {
        params.set(key, value);
      }
    });
    const encoded = params.toString();
    return encoded ? `/media?${encoded}` : "/media";
  })();

  let rawProducts: Awaited<ReturnType<typeof getProductList>>;
  let assets: Awaited<ReturnType<typeof getMediaAssets>>;
  try {
    [rawProducts, assets] = await Promise.all([
      getProductList({ slim: true }, { role: actorRole, authHeader }),
      getMediaAssets(productId || undefined, variantId || undefined, { role: actorRole, authHeader }),
    ]);
  } catch (error: unknown) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect("/media", error));
    }
    throw error;
  }

  const allProducts = filterTestData(rawProducts, true);
  // Cap product list for the select — filter by title search when provided.
  // Always include the currently-selected product so the dropdown shows the active value.
  const PRODUCT_SELECT_MAX = 100;
  const products = (() => {
    const q = productSearch.toLowerCase();
    const matched = q
      ? allProducts.filter(
          (p) =>
            p.title.toLowerCase().includes(q) ||
            p.id === productId,
        )
      : allProducts;
    // If the selected product isn't in matched, prepend it so it stays selectable.
    if (productId && !matched.some((p) => p.id === productId)) {
      const selected = allProducts.find((p) => p.id === productId);
      return selected ? [selected, ...matched.slice(0, PRODUCT_SELECT_MAX - 1)] : matched.slice(0, PRODUCT_SELECT_MAX);
    }
    return matched.slice(0, PRODUCT_SELECT_MAX);
  })();
  const validation = assetId
    ? await getMediaAssetValidation(assetId, channel, { role: actorRole, authHeader })
    : null;
  const assetColumns: Column<(typeof assets)[number]>[] = [
    {
      key: "asset",
      header: "Asset",
      render: (asset) => <span className="font-mono text-xs">{asset.id}</span>,
    },
    {
      key: "product",
      header: "Product",
      render: (asset) => asset.productId ?? "-",
    },
    {
      key: "variant",
      header: "Variant",
      mobileHide: true,
      render: (asset) => asset.variantId ?? "-",
    },
    {
      key: "governance",
      header: "Governance",
      render: (asset) => (
        <form action={updateMediaGovernanceAction} className="space-y-2 rounded-md border border-slate-200 bg-slate-50 p-3">
          <RoleHiddenInput role={actorRole} />
          <input type="hidden" name="assetId" value={asset.id} />
          <input type="hidden" name="productId" value={productId} />
          <input type="hidden" name="variantId" value={variantId} />
          <input type="hidden" name="assetFilterId" value={assetId} />
          <input type="hidden" name="channel" value={channel} />
          <p className="text-xs text-slate-500">
            {asset.mimeType}
            {asset.width && asset.height ? ` | ${asset.width}x${asset.height}` : ""}
            {` | ${Math.round(asset.sizeBytes / 1024)} KB`}
          </p>
          <Input name="altText" defaultValue={asset.altText ?? ""} placeholder="Alt Text" />
          <div className="grid gap-2 md:grid-cols-2">
            <Input name="sortOrder" type="number" min={0} defaultValue={asset.sortOrder} placeholder="Gallery Order" />
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" name="isMain" value="true" defaultChecked={asset.isMain} />
              Mark as main image
            </label>
          </div>
          <div>
            <p className="mb-2 text-xs text-slate-500">Eligible channels</p>
            <div className="flex flex-wrap gap-3 text-xs text-slate-700">
              {READINESS_CHANNELS.map((availableChannel) => (
                <label key={`${asset.id}-${availableChannel}`} className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="channelEligibility"
                    value={availableChannel}
                    defaultChecked={asset.channelEligibility.includes(availableChannel)}
                  />
                  {formatMarketplaceChannelLabel(availableChannel)}
                </label>
              ))}
            </div>
          </div>
          <Button type="submit" variant="secondary" className="w-fit">
            Save governance
          </Button>
        </form>
      ),
    },
    {
      key: "eligibility",
      header: "Eligibility",
      render: (asset) => (
        <div>
          <p>{asset.channelEligibility.length > 0 ? asset.channelEligibility.join(", ") : "All channels not set"}</p>
          <p className="text-xs text-slate-500">Usage count: {asset.usageCount}</p>
        </div>
      ),
    },
    {
      key: "health",
      header: "Health",
      mobileHide: true,
      render: (asset) => (
        <div>
          <p className="font-medium text-slate-900">{asset.assetHealthStatus}</p>
          <p className="text-xs text-slate-500">Last checked: {formatDateTime(asset.lastCheckedAt)}</p>
        </div>
      ),
    },
    {
      key: "validation",
      header: "Validation",
      render: (asset) => (
        <Link
          className="inline-flex items-center rounded-md border border-border px-3 py-2"
          href={`/media?productId=${encodeURIComponent(productId)}&variantId=${encodeURIComponent(variantId)}&assetId=${encodeURIComponent(asset.id)}&channel=${encodeURIComponent(channel)}`}
        >
          Validate
        </Link>
      ),
    },
  ];

  return (
    <div className="space-y-5">
      <PlanLimitModal
        isOpen={showPlanLimitModal}
        resource={planLimitResource}
        limit={planLimitValue}
        current={planCurrent}
        upgradeUrl={planUpgrade}
        contactUrl={planContact}
        dismissHref={dismissPlanLimitHref}
      />
      <PageHeader
        title="Media"
        description="Upload assets, validate channel requirements, and manage product-level media associations."
        breadcrumb={
          <>
            Dashboard / Catalog / <span className="font-semibold text-slate-700">Media</span>
          </>
        }
        actions={
          <>
            <Link className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-slate-50" href="/catalog/products">
              Open Products
            </Link>
            <Link className="rounded-md border border-border px-3 py-2 text-sm font-medium hover:bg-slate-50" href="/channels/health">
              Channel Health
            </Link>
          </>
        }
      />

      {uploadError === "invalid-file-type" ? (
        <div className="rounded-md border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          Invalid file type — only image files are allowed. Please select a JPG, PNG, or WebP file.
        </div>
      ) : null}

      <Card>
        <CardTitle>Filter</CardTitle>
        <form method="get" className="grid gap-3 md:grid-cols-4">
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="media-product-search">
              Search products
            </label>
            <Input
              id="media-product-search"
              name="productSearch"
              defaultValue={productSearch}
              placeholder="Type to filter…"
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="media-filter-product-id">
              Product
              {allProducts.length > PRODUCT_SELECT_MAX && (
                <span className="ml-1 font-normal text-slate-400">
                  (showing {products.length} of {allProducts.length})
                </span>
              )}
            </label>
            <Select id="media-filter-product-id" name="productId" defaultValue={productId}>
              <option value="">All products</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.title}
                </option>
              ))}
            </Select>
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="media-filter-variant-id">
              Variant ID
            </label>
            <Input id="media-filter-variant-id" name="variantId" defaultValue={variantId} placeholder="Optional" />
          </div>
          <Button type="submit" className="w-fit self-end">
            Apply filter
          </Button>
        </form>
      </Card>

      <Card>
        <CardTitle>Upload Media</CardTitle>
        {canWrite ? (
          <form action={uploadMediaAssetAction} className="grid gap-3 md:grid-cols-2">
            <RoleHiddenInput role={actorRole} />
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="media-upload-product-id">
                Product
              </label>
              <Select id="media-upload-product-id" name="productId" defaultValue={productId}>
                <option value="">Unlinked media</option>
                {products.map((product) => (
                  <option key={product.id} value={product.id}>
                    {product.title}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="media-upload-variant-id">
                Variant ID
              </label>
              <Input id="media-upload-variant-id" name="variantId" defaultValue={variantId} placeholder="Optional" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="media-upload-source-file">
                Image File
              </label>
              <Input id="media-upload-source-file" name="sourceFile" type="file" accept="image/*" required />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="media-upload-width">
                Width
              </label>
              <Input id="media-upload-width" name="width" type="number" min={1} placeholder="Optional if PNG" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="media-upload-height">
                Height
              </label>
              <Input id="media-upload-height" name="height" type="number" min={1} placeholder="Optional if PNG" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="media-upload-alt-text">
                Alt Text
              </label>
              <Input id="media-upload-alt-text" name="altText" placeholder="Describe the image for accessibility" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="media-upload-sort-order">
                Gallery Order
              </label>
              <Input id="media-upload-sort-order" name="sortOrder" type="number" min={0} defaultValue={0} />
            </div>
            <div className="space-y-1 md:col-span-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">Governance</label>
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" name="isMain" value="true" />
                Mark as main image
              </label>
              <p className="mt-2 text-xs text-slate-500">Eligible channels</p>
              <div className="flex flex-wrap gap-3 text-sm text-slate-700">
                {READINESS_CHANNELS.map((availableChannel) => (
                  <label key={`upload-${availableChannel}`} className="flex items-center gap-2">
                    <input type="checkbox" name="channelEligibility" value={availableChannel} />
                    {formatMarketplaceChannelLabel(availableChannel)}
                  </label>
                ))}
              </div>
            </div>
            <Button type="submit" className="w-fit">
              Upload media
            </Button>
          </form>
        ) : (
          <p className="text-sm text-slate-600">Your role is read-only on media upload.</p>
        )}
      </Card>

      <Card>
        <CardTitle>Bulk Media Association (CSV)</CardTitle>
        {canWrite ? (
          <form action={bulkAssociateMediaCsvAction} className="space-y-3">
            <RoleHiddenInput role={actorRole} />
            <p className="text-xs text-slate-500">
              Headers: <code>skuCode,imageUrl,contentBase64,fileName,mimeType,width,height</code>. Use{" "}
              <code>contentBase64</code> or <code>imageUrl</code>.
            </p>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="media-bulk-csv-content">
                CSV Content
              </label>
              <Textarea
                id="media-bulk-csv-content"
                name="csvContent"
                rows={6}
                defaultValue={`skuCode,contentBase64,fileName,mimeType,width,height
SKU-DEMO-001,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAoMBgQfXl7wAAAAASUVORK5CYII=,demo.png,image/png,1200,1200`}
                placeholder="Paste CSV rows"
              />
            </div>
            <Button type="submit" className="w-fit">
              Run bulk association
            </Button>
            {bulkAssociationStatus === "done" ? (
              <p className="text-sm text-green-700">Bulk media association request completed.</p>
            ) : null}
          </form>
        ) : (
          <p className="text-sm text-slate-600">Your role is read-only on bulk media association.</p>
        )}
      </Card>

      <Card>
        <CardTitle>Media Assets</CardTitle>
        <DataGrid
          className="mt-3"
          columns={assetColumns}
          rows={assets}
          getRowKey={(asset) => asset.id}
          rowClassName="align-top"
          emptyState={
            <EmptyState
              icon="IMAGE"
              title="No media assets found"
              description="Upload assets or widen the current filter scope to review media governance."
            />
          }
        />
      </Card>

      {assetId ? (
        <Card>
          <CardTitle>Channel Validation</CardTitle>
          <form method="get" className="flex items-end gap-3">
            <input type="hidden" name="productId" value={productId} />
            <input type="hidden" name="variantId" value={variantId} />
            <input type="hidden" name="assetId" value={assetId} />
            <Select name="channel" defaultValue={channel}>
              {READINESS_CHANNELS.map((availableChannel) => (
                <option key={availableChannel} value={availableChannel}>
                  {formatMarketplaceChannelLabel(availableChannel)}
                </option>
              ))}
            </Select>
            <Button type="submit">Run validation</Button>
          </form>
          {validation ? (
            <div className="mt-3 space-y-2 text-sm">
              <p>
                Result: <strong>{validation.valid ? "valid" : "invalid"}</strong>
              </p>
              <p>
                Asset health: <strong>{validation.assetHealthStatus}</strong>
              </p>
              <p>
                Last checked: <strong>{formatDateTime(validation.lastCheckedAt)}</strong>
              </p>
              <p>
                Rules: min {validation.checks.minWidth}x{validation.checks.minHeight}, aspect{" "}
                {validation.checks.aspectMin}-{validation.checks.aspectMax}
              </p>
              {validation.issues.length > 0 ? (
                <ul className="list-disc pl-5">
                  {validation.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              ) : (
                <p>No validation issues.</p>
              )}
              {validation.warnings.length > 0 ? (
                <ul className="list-disc pl-5 text-amber-700">
                  {validation.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </Card>
      ) : null}
    </div>
  );
}
