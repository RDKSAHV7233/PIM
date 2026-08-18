import { createVariantAction, deleteVariantAction, updateVariantAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { DataGrid, type Column } from "@/components/ui/data-grid";
import { Input } from "@/components/ui/input";
import { JsonPreview } from "@/components/ui/json-preview";
import { Select } from "@/components/ui/select";
import { StatusChip } from "@/components/ui/status-chip";
import { Textarea } from "@/components/ui/textarea";
import { formatINR } from "@/lib/format";
import { lifecycleStatusTone } from "./product-detail-shared";
import type { ProductDetailPageData } from "./product-detail-types";

export function VariantsTab({ data }: { data: ProductDetailPageData }) {
  const variantColumns: Column<(typeof data.variants)[number]>[] = [
    {
      key: "sku",
      header: "SKU",
      render: (variant, view) => {
        const editFormId = `variant-edit-${variant.id}-${view}`;
        return data.canWrite ? (
          <Input form={editFormId} name="skuCode" defaultValue={variant.skuCode} required />
        ) : (
          variant.skuCode
        );
      },
    },
    {
      key: "attributes",
      header: "Attributes",
      render: (variant, view) => {
        const editFormId = `variant-edit-${variant.id}-${view}`;
        const attributesDefault = JSON.stringify(variant.attributes ?? {}, null, 2);
        return data.canWrite ? (
          <Textarea form={editFormId} name="variantAttributes" rows={4} className="w-full min-w-0 text-xs" defaultValue={attributesDefault} />
        ) : (
          <JsonPreview value={attributesDefault} className="max-w-[360px] p-2" />
        );
      },
    },
    {
      key: "mrp",
      header: "MRP",
      render: (variant, view) => {
        const editFormId = `variant-edit-${variant.id}-${view}`;
        return data.canEditPricing ? (
          <Input form={editFormId} name="mrp" type="number" min={0} step="0.01" defaultValue={variant.mrp ?? ""} />
        ) : (
          formatINR(variant.mrp)
        );
      },
    },
    {
      key: "sellingPrice",
      header: "Selling Price",
      render: (variant, view) => {
        const editFormId = `variant-edit-${variant.id}-${view}`;
        return data.canEditPricing ? (
          <Input form={editFormId} name="sellingPrice" type="number" min={0} step="0.01" defaultValue={variant.sellingPrice ?? ""} />
        ) : (
          formatINR(variant.sellingPrice)
        );
      },
    },
    {
      key: "inventory",
      header: "Inventory",
      render: (variant, view) => {
        const editFormId = `variant-edit-${variant.id}-${view}`;
        return data.canWrite ? (
          <Input form={editFormId} name="inventoryQty" type="number" min={0} defaultValue={variant.inventoryQty} required />
        ) : (
          variant.inventoryQty
        );
      },
    },
    {
      key: "status",
      header: "Status",
      render: (variant, view) => {
        const editFormId = `variant-edit-${variant.id}-${view}`;
        return data.canWrite ? (
          <Select form={editFormId} name="status" defaultValue={variant.status}>
            <option value="draft">draft</option>
            <option value="active">active</option>
            <option value="archived">archived</option>
          </Select>
        ) : (
          <StatusChip label={variant.status} tone={lifecycleStatusTone(variant.status)} />
        );
      },
    },
    {
      key: "actions",
      header: "Actions",
      render: (variant, view) => {
        const editFormId = `variant-edit-${variant.id}-${view}`;
        const removeFormId = `variant-remove-${variant.id}-${view}`;
        return (
          <div className="px-0 py-0" data-variant-lifecycle-actions="true">
            {data.canWrite && !["approved", "active", "archived"].includes(data.product.status) ? (
              <div className="space-y-3">
                <form id={editFormId} action={updateVariantAction} className="space-y-2">
                  <input type="hidden" name="productId" value={data.productId} />
                  <input type="hidden" name="variantId" value={variant.id} />
                  <Button type="submit" variant="secondary" size="sm">
                    Update variant
                  </Button>
                </form>
                <details className="rounded-md border border-red-200 bg-red-50 p-2">
                  <summary className="cursor-pointer text-xs font-semibold text-red-700">Remove variant</summary>
                  <form id={removeFormId} action={deleteVariantAction} className="mt-2 space-y-2">
                    <input type="hidden" name="productId" value={data.productId} />
                    <input type="hidden" name="variantId" value={variant.id} />
                    <label className="flex items-start gap-2 text-xs text-red-800">
                      <input type="checkbox" name="confirmRemove" value="yes" required className="mt-0.5 h-4 w-4 rounded border-red-300" />
                      Confirm removal of this variant from the product.
                    </label>
                    <Button type="submit" variant="destructive" size="sm">
                      Remove variant
                    </Button>
                  </form>
                </details>
              </div>
            ) : data.canWrite ? (
              <p className="text-xs text-amber-700">Product is {data.product.status} — revert to draft to edit variants.</p>
            ) : (
              <p className="text-xs text-slate-500">Read-only</p>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <>
      <Card hidden={data.activeTab !== "variants"}>
        <CardTitle>Add Variant</CardTitle>
        {data.canWrite && ["approved", "active", "archived"].includes(data.product.status) ? (
          <p className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Product is {data.product.status} — revert to draft to add or edit variants.
          </p>
        ) : data.canWrite ? (
          <form action={createVariantAction} className="grid gap-3 md:grid-cols-2">
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
            {data.canEditPricing ? (
              <>
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
              </>
            ) : null}
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
              <Textarea id="variant-attributes" name="variantAttributes" rows={4} className="md:col-span-2" />
              <p className="text-xs text-slate-500">Optional JSON object, for example {"{\"color\":\"blue\"}"}.</p>
            </div>
            <Button type="submit" className="w-fit">
              Create variant
            </Button>
          </form>
        ) : !data.canWrite ? (
          <p className="text-sm text-slate-600">Your role cannot create variants.</p>
        ) : null}
      </Card>

      <Card hidden={data.activeTab !== "variants"}>
        <CardTitle>Variants</CardTitle>
        {data.variants.length > 0 ? (
          <DataGrid columns={variantColumns} rows={data.variants} getRowKey={(variant) => variant.id} rowClassName="align-top" />
        ) : (
          <div className="rounded-lg border border-slate-200 px-3 py-6 text-sm text-slate-500">
            No variants yet. Add the first variant to enable inventory and price differentiation.
          </div>
        )}
      </Card>
    </>
  );
}
