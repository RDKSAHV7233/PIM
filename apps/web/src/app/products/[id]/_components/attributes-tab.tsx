import { updateProductAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getAllowedValues } from "./product-detail-shared";
import type { ProductDetailPageData } from "./product-detail-types";

export function AttributesTab({ data }: { data: ProductDetailPageData }) {
  return (
    <Card hidden={data.activeTab !== "attributes"}>
      <CardTitle>Category-Specific Attributes</CardTitle>
      {data.canWrite ? (
        <form action={updateProductAction} data-product-dirty-form="true" className="mt-4 grid gap-3 md:grid-cols-2">
          <input type="hidden" name="productId" value={data.productId} />
          <input type="hidden" name="currentTab" value="attributes" />
          <input type="hidden" name="returnTo" value={data.returnTo} />
          <input type="hidden" name="categoryId" value={data.product.categoryId} />
          <input type="hidden" name="expectedVersion" value={data.product.version} />
          <input type="hidden" name="title" value={data.product.title} />
          <input type="hidden" name="description" value={data.product.description ?? ""} />
          <input type="hidden" name="brand" value={data.product.brand ?? ""} />
          <input type="hidden" name="hsnCode" value={data.product.hsnCode ?? ""} />
          <input type="hidden" name="gstRate" value={data.product.gstRate ?? ""} />
          <input type="hidden" name="status" value={data.product.status} />
          <input type="hidden" name="attributesBase" value={JSON.stringify(data.productAttributes)} />

          {data.productAttributeDefinitions.length === 0 ? (
            <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
              No category-specific attributes defined for {data.product.category?.path ?? data.product.categoryId}.
            </p>
          ) : (
            <div className="space-y-3 md:col-span-2">
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
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor={inputId}>
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
                      <label className="text-xs font-semibold uppercase tracking-wide text-slate-600" htmlFor={inputId}>
                        {definition.name} {definition.required ? <span className="text-red-500">*</span> : null}
                      </label>
                      <select
                        id={inputId}
                        name={inputName}
                        defaultValue={defaultTextValue}
                        className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm"
                      >
                        <option value="">Select {definition.name}</option>
                        {allowedValues.map((allowedValue) => (
                          <option key={allowedValue} value={allowedValue}>
                            {allowedValue}
                          </option>
                        ))}
                      </select>
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
              <Button type="submit" className="w-fit">
                Save attributes
              </Button>
            </div>
          )}
        </form>
      ) : (
        <div className="mt-4 space-y-3">
          <p className="text-sm text-slate-600">You can review attributes in read-only mode.</p>
          {data.productAttributeDefinitions.length === 0 ? (
            <p className="rounded-md border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
              No category-specific attributes defined for this product.
            </p>
          ) : (
            <fieldset disabled className="grid gap-3 md:grid-cols-2 opacity-75">
              {data.productAttributeDefinitions.map((definition) => {
                const currentValue = data.productAttributes[definition.key];
                const defaultTextValue =
                  currentValue === null || currentValue === undefined
                    ? ""
                    : typeof currentValue === "string"
                      ? currentValue
                      : String(currentValue);
                return (
                  <div key={definition.id} className="space-y-1">
                    <label className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {definition.name}
                    </label>
                    <Input value={defaultTextValue} disabled />
                  </div>
                );
              })}
            </fieldset>
          )}
        </div>
      )}
    </Card>
  );
}
