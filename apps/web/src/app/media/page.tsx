import Link from "next/link";
import { bulkAssociateMediaCsvAction, uploadMediaAssetAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  AppRole,
  getMediaAssets,
  getMediaAssetValidation,
  getProducts,
  MarketplaceChannel,
  normalizeAppRole,
} from "@/lib/api";

export const dynamic = "force-dynamic";

function RoleHiddenInput({ role }: { role: AppRole }) {
  return <input type="hidden" name="actorRole" value={role} />;
}

interface MediaPageProps {
  searchParams: Promise<{
    role?: string;
    productId?: string;
    variantId?: string;
    assetId?: string;
    bulkAssociationStatus?: string;
    channel?: MarketplaceChannel;
  }>;
}

export default async function MediaPage({ searchParams }: MediaPageProps) {
  const query = await searchParams;
  const actorRole = normalizeAppRole(query.role);
  const canWrite = actorRole !== "viewer";
  const productId = String(query.productId ?? "").trim();
  const variantId = String(query.variantId ?? "").trim();
  const channel = (query.channel ?? "amazon") as MarketplaceChannel;
  const assetId = String(query.assetId ?? "").trim();
  const bulkAssociationStatus = String(query.bulkAssociationStatus ?? "").trim();

  const [products, assets] = await Promise.all([
    getProducts({ role: actorRole }),
    getMediaAssets(productId || undefined, variantId || undefined, { role: actorRole }),
  ]);
  const validation = assetId ? await getMediaAssetValidation(assetId, channel, { role: actorRole }) : null;

  return (
    <div className="space-y-5">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Phase 5: DAM + Media Validation</h1>
        <p className="text-sm text-slate-600">
          Image upload/storage, metadata extraction, and marketplace media-rule validation.
        </p>
      </header>

      <div className="flex flex-wrap gap-2 text-sm">
        <Link className="rounded-md border border-border px-3 py-2" href={`/?role=${encodeURIComponent(actorRole)}`}>
          Dashboard
        </Link>
        <Link className="rounded-md border border-border px-3 py-2" href={`/rejection?role=${encodeURIComponent(actorRole)}`}>
          Phase 6
        </Link>
        <Link className="rounded-md border border-border px-3 py-2" href={`/ondc?role=${encodeURIComponent(actorRole)}`}>
          Phase 7
        </Link>
        <Link className="rounded-md border border-border px-3 py-2" href={`/ai?role=${encodeURIComponent(actorRole)}`}>
          Phase 8
        </Link>
      </div>

      <Card>
        <CardTitle>Filter</CardTitle>
        <form method="get" className="grid gap-3 md:grid-cols-4">
          <input type="hidden" name="role" value={actorRole} />
          <Select name="productId" defaultValue={productId}>
            <option value="">All products</option>
            {products.map((product) => (
              <option key={product.id} value={product.id}>
                {product.title}
              </option>
            ))}
          </Select>
          <Input name="variantId" defaultValue={variantId} placeholder="Variant id (optional)" />
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
            <Select name="productId" defaultValue={productId}>
              <option value="">Unlinked media</option>
              {products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.title}
                </option>
              ))}
            </Select>
            <Input name="variantId" defaultValue={variantId} placeholder="Variant id (optional)" />
            <Input name="sourceFile" type="file" accept="image/*" required />
            <Input name="width" type="number" min={1} placeholder="Width (optional if png)" />
            <Input name="height" type="number" min={1} placeholder="Height (optional if png)" />
            <Button type="submit" className="w-fit">
              Upload media
            </Button>
          </form>
        ) : (
          <p className="text-sm text-slate-600">Viewer role is read-only.</p>
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
            <Textarea
              name="csvContent"
              rows={6}
              defaultValue={`skuCode,contentBase64,fileName,mimeType,width,height
SKU-DEMO-001,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8Xw8AAoMBgQfXl7wAAAAASUVORK5CYII=,demo.png,image/png,1200,1200`}
              placeholder="Paste CSV rows"
            />
            <Button type="submit" className="w-fit">
              Run bulk association
            </Button>
            {bulkAssociationStatus === "done" && (
              <p className="text-sm text-green-700">Bulk media association request completed.</p>
            )}
          </form>
        ) : (
          <p className="text-sm text-slate-600">Viewer role is read-only.</p>
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
                      href={`/media?role=${encodeURIComponent(actorRole)}&productId=${encodeURIComponent(productId)}&variantId=${encodeURIComponent(variantId)}&assetId=${encodeURIComponent(asset.id)}&channel=${encodeURIComponent(channel)}`}
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
            <input type="hidden" name="role" value={actorRole} />
            <input type="hidden" name="productId" value={productId} />
            <input type="hidden" name="variantId" value={variantId} />
            <input type="hidden" name="assetId" value={assetId} />
            <Select name="channel" defaultValue={channel}>
              <option value="amazon">amazon</option>
              <option value="flipkart">flipkart</option>
              <option value="meesho">meesho</option>
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
