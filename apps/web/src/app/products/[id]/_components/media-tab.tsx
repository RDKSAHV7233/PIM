import Link from "next/link";
import { uploadMediaAssetAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { READINESS_CHANNELS } from "@/lib/channel-readiness";
import { formatMarketplaceChannelLabel } from "@/lib/marketplace-channels";
import type { ProductDetailPageData } from "./product-detail-types";

export function MediaTab({ data }: { data: ProductDetailPageData }) {
  const returnTo = `/products/${encodeURIComponent(data.productId)}?tab=media`;

  return (
    <Card hidden={data.activeTab !== "media"}>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle>Media</CardTitle>
          <p className="text-sm text-slate-600">
            {data.imageAssetCount} image asset{data.imageAssetCount === 1 ? "" : "s"} linked across {data.mediaAssetCount} total asset{data.mediaAssetCount === 1 ? "" : "s"}.
          </p>
        </div>
        <Link
          href={`/catalog/media?productId=${encodeURIComponent(data.productId)}`}
          className="inline-flex w-fit rounded-md border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Open Media Library
        </Link>
      </div>

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
