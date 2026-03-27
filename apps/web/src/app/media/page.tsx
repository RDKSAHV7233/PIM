import Link from "next/link";
import { redirect } from "next/navigation";
import { bulkAssociateMediaCsvAction, uploadMediaAssetAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { PlanLimitModal } from "@/components/ui/plan-limit-modal";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  ApiHttpError,
  AppRole,
  getMediaAssets,
  getMediaAssetValidation,
  getProductList,
  MarketplaceChannel,
} from "@/lib/api";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { READINESS_CHANNELS } from "@/lib/channel-readiness";
import { canEditWorkspace } from "@/lib/role-capabilities";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";
import { filterTestData } from "@/lib/test-data-filter";

export const dynamic = "force-dynamic";

function normalizeChannel(value: MarketplaceChannel | undefined): MarketplaceChannel {
  if (value && READINESS_CHANNELS.includes(value)) {
    return value;
  }
  return READINESS_CHANNELS[0] ?? "amazon";
}

function formatChannelLabel(channel: MarketplaceChannel): string {
  if (channel === "meesho") {
    return "Meesho";
  }
  return channel === "amazon" ? "Amazon" : "Flipkart";
}

function RoleHiddenInput({ role }: { role: AppRole }) {
  return <input type="hidden" name="actorRole" value={role} />;
}

interface MediaPageProps {
  searchParams: Promise<{    productId?: string;
    variantId?: string;
    assetId?: string;
    bulkAssociationStatus?: string;
    channel?: MarketplaceChannel;
    planLimit?: string;
    planResource?: string;
    planLimitValue?: string;
    planCurrent?: string;
    planUpgrade?: string;
  }>;
}

export default async function MediaPage({ searchParams }: MediaPageProps) {
  const query = await searchParams;
  const authHeader = await getServerAuthHeader();
  const actorRole = await getServerActorRole();
  const canWrite = canEditWorkspace(actorRole);
  const productId = String(query.productId ?? "").trim();
  const variantId = String(query.variantId ?? "").trim();
  const channel = normalizeChannel(query.channel);
  const assetId = String(query.assetId ?? "").trim();
  const bulkAssociationStatus = String(query.bulkAssociationStatus ?? "").trim();
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
  const dismissPlanLimitHref = (() => {
    const params = new URLSearchParams();
    Object.entries(query).forEach(([key, raw]) => {
      if (
        key === "planLimit" ||
        key === "planResource" ||
        key === "planLimitValue" ||
        key === "planCurrent" ||
        key === "planUpgrade"
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
  const products = filterTestData(rawProducts, true);
  const validation = assetId
    ? await getMediaAssetValidation(assetId, channel, { role: actorRole, authHeader })
    : null;

  return (
    <div className="space-y-5">
      <PlanLimitModal
        isOpen={showPlanLimitModal}
        resource={planLimitResource}
        limit={planLimitValue}
        current={planCurrent}
        upgradeUrl={planUpgrade}
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

      <Card>
        <CardTitle>Filter</CardTitle>
        <form method="get" className="grid gap-3 md:grid-cols-4">
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="media-filter-product-id">
              Product
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
          <Button type="submit" className="w-fit">
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
            {bulkAssociationStatus === "done" && (
              <p className="text-sm text-green-700">Bulk media association request completed.</p>
            )}
          </form>
        ) : (
          <p className="text-sm text-slate-600">Your role is read-only on bulk media association.</p>
        )}
      </Card>

      <Card>
        <CardTitle>Media Assets</CardTitle>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1080px] text-left text-sm">
            <thead className="text-xs uppercase text-slate-500">
              <tr>
                <th className="py-2">Asset</th>
                <th className="py-2">Product</th>
                <th className="py-2">Variant</th>
                <th className="py-2">Type</th>
                <th className="py-2">Dimensions</th>
                <th className="py-2">Size (KB)</th>
                <th className="py-2">Validation</th>
              </tr>
            </thead>
            <tbody>
              {assets.map((asset) => (
                <tr key={asset.id} className="border-t border-border">
                  <td className="py-2 font-mono text-xs">{asset.id}</td>
                  <td className="py-2">{asset.productId ?? "-"}</td>
                  <td className="py-2">{asset.variantId ?? "-"}</td>
                  <td className="py-2">{asset.mimeType}</td>
                  <td className="py-2">{asset.width && asset.height ? `${asset.width}x${asset.height}` : "-"}</td>
                  <td className="py-2">{Math.round(asset.sizeBytes / 1024)}</td>
                  <td className="py-2">
                    <Link
                      className="inline-flex items-center rounded-md border border-border px-3 py-2"
                      href={`/media?productId=${encodeURIComponent(productId)}&variantId=${encodeURIComponent(variantId)}&assetId=${encodeURIComponent(asset.id)}&channel=${encodeURIComponent(channel)}`}
                    >
                      Validate
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {assetId && (
        <Card>
          <CardTitle>Channel Validation</CardTitle>
          <form method="get" className="flex items-end gap-3">
            <input type="hidden" name="productId" value={productId} />
            <input type="hidden" name="variantId" value={variantId} />
            <input type="hidden" name="assetId" value={assetId} />
            <Select name="channel" defaultValue={channel}>
              {READINESS_CHANNELS.map((availableChannel) => (
                <option key={availableChannel} value={availableChannel}>
                  {formatChannelLabel(availableChannel)}
                </option>
              ))}
            </Select>
            <Button type="submit">Run validation</Button>
          </form>
          {validation && (
            <div className="mt-3 space-y-2 text-sm">
              <p>
                Result: <strong>{validation.valid ? "valid" : "invalid"}</strong>
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
              {validation.warnings.length > 0 && (
                <ul className="list-disc pl-5 text-amber-700">
                  {validation.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

