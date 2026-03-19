import { createVariantAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { StatusChip } from "@/components/ui/status-chip";
import { Textarea } from "@/components/ui/textarea";
import { formatINR } from "@/lib/format";
import { lifecycleStatusTone, RoleHiddenInput } from "./product-detail-shared";
import type { ProductDetailPageData } from "./product-detail-types";

export function VariantsTab({ data }: { data: ProductDetailPageData }) {
  return (
    <>
      <Card hidden={data.activeTab !== "variants"}>
        <CardTitle>Add Variant</CardTitle>
        {data.canWrite ? (
          <form action={createVariantAction} className="grid gap-3 md:grid-cols-2">
            <RoleHiddenInput role={data.actorRole} />
            <input type="hidden" name="productId" value={data.productId} />
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="variant-sku-code">
                SKU Code
              </label>
              <Input id="variant-sku-code" name="skuCode" required />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="variant-inventory-qty">
                Inventory Quantity
              </label>
              <Input id="variant-inventory-qty" name="inventoryQty" type="number" min={0} defaultValue={0} required />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="variant-mrp">
                MRP
              </label>
              <Input id="variant-mrp" name="mrp" type="number" min={0} step="0.01" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="variant-selling-price">
                Selling Price
              </label>
              <Input id="variant-selling-price" name="sellingPrice" type="number" min={0} step="0.01" />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="variant-status">
                Status
              </label>
              <Select id="variant-status" name="status" defaultValue="draft">
                <option value="draft">draft</option>
                <option value="active">active</option>
                <option value="archived">archived</option>
              </Select>
            </div>
            <div />
            <div className="space-y-1 md:col-span-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="variant-attributes">
                Variant Attributes
              </label>
              <Textarea id="variant-attributes" name="attributes" rows={4} className="md:col-span-2" />
              <p className="text-xs text-slate-500">Optional details to describe this variant.</p>
            </div>
            <Button type="submit" className="w-fit">
              Create variant
            </Button>
          </form>
        ) : (
          <p className="text-sm text-slate-600">Your role cannot create variants.</p>
        )}
      </Card>

      <Card hidden={data.activeTab !== "variants"}>
        <CardTitle>Variants</CardTitle>
        <div className="overflow-x-auto rounded-lg border border-slate-200">
          <table className="w-full min-w-[760px] text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">SKU</th>
                <th className="px-3 py-2">Attributes</th>
                <th className="px-3 py-2">MRP</th>
                <th className="px-3 py-2">Selling Price</th>
                <th className="px-3 py-2">Inventory</th>
                <th className="px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.variants.length > 0 ? (
                data.variants.map((variant) => (
                  <tr key={variant.id} className="border-t border-slate-200 hover:bg-slate-50/50">
                    <td className="px-3 py-2.5">{variant.skuCode}</td>
                    <td className="px-3 py-2.5">
                      <pre className="max-w-[360px] overflow-auto whitespace-pre-wrap rounded border border-slate-200 bg-slate-50 p-2 text-xs">
                        {JSON.stringify(variant.attributes, null, 2)}
                      </pre>
                    </td>
                    <td className="px-3 py-2.5">{formatINR(variant.mrp)}</td>
                    <td className="px-3 py-2.5">{formatINR(variant.sellingPrice)}</td>
                    <td className="px-3 py-2.5">{variant.inventoryQty}</td>
                    <td className="px-3 py-2.5">
                      <StatusChip label={variant.status} tone={lifecycleStatusTone(variant.status)} />
                    </td>
                  </tr>
                ))
              ) : (
                <tr className="border-t border-slate-200">
                  <td className="px-3 py-6 text-sm text-slate-500" colSpan={6}>
                    No variants yet. Add the first variant to enable inventory and price differentiation.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
