import Link from "@/components/ui/app-link";
import { uploadMediaAssetAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { mediaFileUrl } from "@/lib/media-file-url";
import { READINESS_CHANNELS } from "@/lib/channel-readiness";
import { formatMarketplaceChannelLabel } from "@/lib/marketplace-channels";
import type { ProductDetailPageData } from "./product-detail-types";

function MediaThumbnail({ asset }: { asset: ProductDetailPageData["mediaAssets"][number] }) {
  const isImage = asset.mimeType.startsWith("image/");
  const dimensions =
    asset.width && asset.height ? `${asset.width}×${asset.height}` : null;

  return (
    <div className="flex flex-col items-center gap-1.5 rounded-lg border border-slate-200 bg-white p-2">
      <div className="relative h-20 w-20 overflow-hidden rounded-md bg-slate-100">
        {isImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={mediaFileUrl(asset)}
            alt={asset.altText ?? asset.fileName}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-slate-400">
            {asset.mimeType.split("/")[1]?.toUpperCase() ?? "FILE"}
          </div>
        )}
        {asset.isMain && (
          <span className="absolute bottom-0.5 left-0.5 rounded bg-blue-600 px-1 py-0.5 text-[10px] font-semibold leading-none text-white">
            Main
          </span>
        )}
      </div>
      <p className="w-20 truncate text-center text-[11px] text-slate-600" title={asset.fileName}>
        {asset.fileName}
      </p>
      {dimensions && (
        <p className="text-[10px] text-slate-400">{dimensions}</p>
      )}
    </div>
  );
}

export function MediaTab({ data }: { data: ProductDetailPageData }) {
  const returnTo = `/products/${encodeURIComponent(data.productId)}?tab=media`;
  const imageAssets = data.mediaAssets.filter((a) => a.mimeType.startsWith("image/"));
  const nonImageAssets = data.mediaAssets.filter((a) => !a.mimeType.startsWith("image/"));

  return (
    <Card hidden={data.activeTab !== "media"}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>Media</CardTitle>
          <p className="text-sm text-slate-600">
            {data.imageAssetCount} image asset{data.imageAssetCount === 1 ? "" : "s"} linked across {data.mediaAssetCount} total asset{data.mediaAssetCount === 1 ? "" : "s"}.
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Link
            href={`/catalog/media?productId=${encodeURIComponent(data.productId)}`}
            className="inline-flex w-fit rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            Open Media Library
          </Link>
          <p className="text-xs text-slate-500">
            Manage alt text, main image selection, gallery ordering, and channel eligibility in the Media Library.
          </p>
        </div>
      </div>

      {imageAssets.length === 0 && data.hasMainImageUrl && (
        <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
          No images are linked in the Media Library, but this product has a Main Image URL set on the Content tab —
          it's used as a fallback image for Shopify/WooCommerce exports. It has no alt text or per-channel
          eligibility, so add a real image here for full media governance.
        </p>
      )}

      {imageAssets.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Images</h3>
          <div className="flex flex-wrap gap-2">
            {imageAssets.map((asset) => (
              <MediaThumbnail key={asset.id} asset={asset} />
            ))}
          </div>
        </div>
      )}

      {nonImageAssets.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Other assets</h3>
          <div className="flex flex-wrap gap-2">
            {nonImageAssets.map((asset) => (
              <MediaThumbnail key={asset.id} asset={asset} />
            ))}
          </div>
        </div>
      )}

      <div className="mt-5 border-t border-slate-100 pt-5">
        <h3 className="text-sm font-semibold text-slate-900">Add Media</h3>
        {data.canWrite ? (
          <form action={uploadMediaAssetAction} className="mt-3 grid gap-3 md:grid-cols-2">
            <input type="hidden" name="productId" value={data.productId} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="product-media-upload-variant-id">
                Variant
              </label>
              <Select id="product-media-upload-variant-id" name="variantId" defaultValue="">
                <option value="">Product level</option>
                {data.variants.map((variant) => (
                  <option key={variant.id} value={variant.id}>
                    {variant.skuCode}
                  </option>
                ))}
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="product-media-upload-source-file">
                Image file
              </label>
              <Input id="product-media-upload-source-file" name="sourceFile" type="file" accept="image/*" required />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="product-media-upload-alt-text">
                Alt text
              </label>
              <Input id="product-media-upload-alt-text" name="altText" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="product-media-upload-sort-order">
                Gallery order
              </label>
              <Input id="product-media-upload-sort-order" name="sortOrder" type="number" min={0} defaultValue={data.mediaAssetCount} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="product-media-upload-width">
                Width
              </label>
              <Input id="product-media-upload-width" name="width" type="number" min={1} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="product-media-upload-height">
                Height
              </label>
              <Input id="product-media-upload-height" name="height" type="number" min={1} />
            </div>
            <div className="space-y-3 md:col-span-2">
              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" name="isMain" value="true" defaultChecked={data.imageAssetCount === 0} />
                Mark as main image
              </label>
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">Eligible channels</p>
                <div className="flex flex-wrap gap-3 text-sm text-slate-700">
                  {READINESS_CHANNELS.map((availableChannel) => (
                    <label key={`product-media-${availableChannel}`} className="flex items-center gap-2">
                      <input type="checkbox" name="channelEligibility" value={availableChannel} />
                      {formatMarketplaceChannelLabel(availableChannel)}
                    </label>
                  ))}
                </div>
              </div>
            </div>
            <Button type="submit" className="w-fit">
              Upload media
            </Button>
          </form>
        ) : (
          <p className="mt-3 text-sm text-slate-600">Your role is read-only on media upload.</p>
        )}
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <Link
          href="/channels/health"
          className="rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Channel Media Health
        </Link>
      </div>
    </Card>
  );
}
