import { updateProductAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ViewerEditTooltip } from "@/components/ui/viewer-edit-tooltip";
import { getAllowedValues, RoleHiddenInput } from "./product-detail-shared";
import type { ProductDetailPageData } from "./product-detail-types";

export function ContentTab({ data }: { data: ProductDetailPageData }) {
  return (
    <Card hidden={!(data.activeTab === "content" || data.activeTab === "attributes")}>
      <CardTitle>Edit Product (Versioned)</CardTitle>
      {data.canWrite ? (
        <form
          id="product-edit-form"
          action={updateProductAction}
          data-product-dirty-form="true"
          className="grid gap-3 md:grid-cols-2"
        >
          <RoleHiddenInput role={data.actorRole} />
          <input type="hidden" name="productId" value={data.productId} />
          <input type="hidden" name="currentTab" value={data.activeTab} />
          <input type="hidden" name="returnTo" value={data.returnTo} />
          <input type="hidden" name="categoryId" value={data.product.categoryId} />
          <input type="hidden" name="expectedVersion" value={data.product.version} />
          <input type="hidden" name="attributesBase" value={JSON.stringify(data.productAttributes)} />
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="product-title">
              Product Title
            </label>
            <Input id="product-title" name="title" data-field="title" defaultValue={data.product.title} required />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="product-brand">
              Brand
            </label>
            <Input id="product-brand" name="brand" data-field="brand" defaultValue={data.product.brand} />
          </div>
          <div className="space-y-1 md:col-span-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="product-description">
              Description
            </label>
            <Textarea
              id="product-description"
              name="description"
              data-field="description"
              rows={3}
              className="md:col-span-2"
              defaultValue={data.product.description}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="product-hsn-code">
              HSN Code
            </label>
            <Input id="product-hsn-code" name="hsnCode" data-field="hsnCode" defaultValue={data.product.hsnCode ?? ""} />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="product-gst-rate">
              GST Rate
            </label>
            <Input
              id="product-gst-rate"
              name="gstRate"
              data-field="gstRate"
              type="number"
              min={0}
              step="0.01"
              defaultValue={data.product.gstRate ?? ""}
            />
          </div>
          <div className="space-y-1">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor="product-status">
              Status
            </label>
            <Select id="product-status" name="status" data-field="status" defaultValue={data.product.status}>
              <option value="draft">draft</option>
              <option value="active">active</option>
              <option value="archived">archived</option>
            </Select>
          </div>
          <p className="text-xs text-slate-500">Submitting with expected version: {data.product.version}</p>
          <div className="space-y-2 md:col-span-2">
            <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">Additional Attributes</label>
            {data.productAttributeDefinitions.length === 0 ? (
              <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                No additional attributes required for this category.
              </p>
            ) : (
              <div className="grid gap-3 md:grid-cols-2">
                {data.productAttributeDefinitions.map((definition) => {
                  const inputName = `attr__${definition.key}`;
                  const inputTypeName = `attrType__${definition.key}`;
                  const inputId = `product-attribute-${definition.key}`;
                  const currentValue = data.productAttributes[definition.key];
                  const dataType = String(definition.dataType ?? "text").toLowerCase();
                  const allowedValues = getAllowedValues(definition.allowedValues);
                  const defaultTextValue =
                    currentValue === null || currentValue === undefined
                      ? ""
                      : typeof currentValue === "string"
                        ? currentValue
                        : String(currentValue);

                  if (dataType === "boolean") {
                    return (
                      <div key={definition.id} className="space-y-1">
                        <input type="hidden" name={inputTypeName} value={dataType} />
                        <label
                          className="text-xs font-semibold uppercase tracking-wide text-slate-600"
                          htmlFor={inputId}
                        >
                          {definition.name} {definition.required ? <span className="text-red-500">*</span> : null}
                        </label>
                        <div className="flex items-center gap-2 rounded-md border border-slate-200 px-3 py-2">
                          <input type="hidden" name={inputName} value="false" />
                          <input
                            id={inputId}
                            name={inputName}
                            type="checkbox"
                            value="true"
                            defaultChecked={Boolean(currentValue)}
                            className="h-4 w-4 rounded border-slate-300"
                          />
                          <span className="text-sm text-slate-700">Enabled</span>
                        </div>
                      </div>
                    );
                  }

                  if (dataType === "select" && allowedValues.length > 0) {
                    return (
                      <div key={definition.id} className="space-y-1">
                        <input type="hidden" name={inputTypeName} value={dataType} />
                        <label
                          className="text-xs font-semibold uppercase tracking-wide text-slate-600"
                          htmlFor={inputId}
                        >
                          {definition.name} {definition.required ? <span className="text-red-500">*</span> : null}
                        </label>
                        <Select id={inputId} name={inputName} defaultValue={defaultTextValue}>
                          <option value="">Select {definition.name}</option>
                          {allowedValues.map((allowedValue) => (
                            <option key={allowedValue} value={allowedValue}>
                              {allowedValue}
                            </option>
                          ))}
                        </Select>
                      </div>
                    );
                  }

                  return (
                    <div key={definition.id} className="space-y-1">
                      <input type="hidden" name={inputTypeName} value={dataType} />
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor={inputId}>
                        {definition.name} {definition.required ? <span className="text-red-500">*</span> : null}
                      </label>
                      <Input
                        id={inputId}
                        name={inputName}
                        type={dataType === "number" ? "number" : "text"}
                        step={dataType === "number" ? "0.01" : undefined}
                        defaultValue={defaultTextValue}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          <Button type="submit" className="w-fit">
            Save product changes
          </Button>
        </form>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">You can review product data in read-only mode.</p>
          <div className="rounded-md border border-dashed border-slate-300 p-3">
            <ViewerEditTooltip>
              <div className="h-10 w-40 rounded-md border border-slate-200 bg-slate-50" />
            </ViewerEditTooltip>
          </div>
        </div>
      )}
    </Card>
  );
}
