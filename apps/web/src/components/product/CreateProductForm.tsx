"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { createProductAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { AppRole, AttributeDefinition, Category } from "@/lib/api";
import { formatINR } from "@/lib/format";

interface CreateProductFormProps {
  role: AppRole;
  categories: Category[];
  onCreated?: () => void;
}

type AttributeInputValue = string | number | boolean;

function fieldId(name: string): string {
  return `create-product-${name.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
}

function getAllowedValues(definition: AttributeDefinition): string[] {
  const raw = definition.allowedValues;
  if (Array.isArray(raw)) {
    return raw.map((value) => String(value ?? "").trim()).filter((value) => value.length > 0);
  }
  if (raw && typeof raw === "object" && "values" in raw && Array.isArray(raw.values)) {
    return raw.values.map((value) => String(value ?? "").trim()).filter((value) => value.length > 0);
  }
  return [];
}

function parseNumberOrEmpty(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeAttributeValue(
  definition: AttributeDefinition,
  value: AttributeInputValue | undefined,
): unknown {
  const type = String(definition.dataType ?? "").toLowerCase();
  if (type === "boolean") {
    return Boolean(value);
  }
  if (type === "number") {
    const parsed = parseNumberOrEmpty(String(value ?? ""));
    return parsed;
  }
  if (type === "json") {
    const raw = String(value ?? "").trim();
    if (!raw) {
      return null;
    }
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }
  const text = String(value ?? "").trim();
  return text || null;
}

export function CreateProductForm({ role, categories, onCreated }: CreateProductFormProps) {
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("");
  const [definitions, setDefinitions] = useState<AttributeDefinition[]>([]);
  const [attributeValues, setAttributeValues] = useState<Record<string, AttributeInputValue>>({});
  const [loadingAttributes, setLoadingAttributes] = useState(false);
  const [attributeFetchError, setAttributeFetchError] = useState<string>("");
  const [mrp, setMrp] = useState<string>("");
  const [sellingPrice, setSellingPrice] = useState<string>("");
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!selectedCategoryId) {
      setDefinitions([]);
      setAttributeValues({});
      setAttributeFetchError("");
      return;
    }

    const controller = new AbortController();
    setLoadingAttributes(true);
    setAttributeFetchError("");

    fetch(`/api/taxonomy/categories/${encodeURIComponent(selectedCategoryId)}/attributes`, {
      method: "GET",
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) {
          throw new Error("Unable to load category attributes.");
        }
        const raw = (await response.json()) as AttributeDefinition[];
        const productScoped = raw.filter((definition) => definition.appliesTo !== "variant");
        setDefinitions(productScoped);
        setAttributeValues((previous) => {
          const next: Record<string, AttributeInputValue> = {};
          productScoped.forEach((definition) => {
            const existing = previous[definition.key];
            if (existing !== undefined) {
              next[definition.key] = existing;
              return;
            }
            if (String(definition.dataType).toLowerCase() === "boolean") {
              next[definition.key] = false;
              return;
            }
            next[definition.key] = "";
          });
          return next;
        });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted) {
          return;
        }
        setDefinitions([]);
        setAttributeValues({});
        const message = error instanceof Error ? error.message : "Unable to load category attributes.";
        setAttributeFetchError(message);
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoadingAttributes(false);
        }
      });

    return () => controller.abort();
  }, [role, selectedCategoryId]);

  const attributesJson = useMemo(() => {
    const payload: Record<string, unknown> = {};
    definitions.forEach((definition) => {
      const normalized = normalizeAttributeValue(definition, attributeValues[definition.key]);
      if (normalized !== null && normalized !== "") {
        payload[definition.key] = normalized;
      }
    });

    return JSON.stringify(payload);
  }, [attributeValues, definitions]);

  const submitAction = async (formData: FormData) => {
    startTransition(async () => {
      await createProductAction(formData);
      setSelectedCategoryId("");
      setDefinitions([]);
      setAttributeValues({});
      setMrp("");
      setSellingPrice("");
      onCreated?.();
    });
  };

  const parsedMrp = parseNumberOrEmpty(mrp);
  const parsedSellingPrice = parseNumberOrEmpty(sellingPrice);

  return (
    <form action={submitAction} className="grid gap-3 md:grid-cols-2">
      <input type="hidden" name="actorRole" value={role} />
      <input type="hidden" name="attributes" value={attributesJson} />

      <div className="space-y-1">
        <label htmlFor={fieldId("title")} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          Product Title <span className="text-red-500">*</span>
        </label>
        <Input id={fieldId("title")} name="title" placeholder="e.g. Men's Slim Fit Kurta" required />
      </div>

      <div className="space-y-1">
        <label htmlFor={fieldId("brand")} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          Brand
        </label>
        <Input id={fieldId("brand")} name="brand" placeholder="e.g. PIM1" />
      </div>

      <div className="space-y-1 md:col-span-2">
        <label
          htmlFor={fieldId("description")}
          className="text-xs font-semibold uppercase tracking-wide text-slate-600"
        >
          Description
        </label>
        <Textarea id={fieldId("description")} name="description" rows={3} placeholder="Short product description" />
      </div>

      <div className="space-y-1">
        <label htmlFor={fieldId("hsnCode")} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          HSN Code
        </label>
        <Input id={fieldId("hsnCode")} name="hsnCode" placeholder="4, 6, or 8 digits" />
      </div>

      <div className="space-y-1">
        <label htmlFor={fieldId("gstRate")} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          GST Rate
        </label>
        <Input id={fieldId("gstRate")} name="gstRate" type="number" min={0} step="0.01" placeholder="e.g. 18" />
      </div>

      <div className="space-y-1">
        <label htmlFor={fieldId("mrp")} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          MRP
        </label>
        <div className="flex items-center gap-3">
          <Input
            id={fieldId("mrp")}
            name="mrp"
            type="number"
            min={0}
            step="1"
            value={mrp}
            onChange={(event) => setMrp(event.target.value)}
            placeholder="e.g. 2499"
          />
          <span className="whitespace-nowrap text-xs text-slate-600">{formatINR(parsedMrp)}</span>
        </div>
      </div>

      <div className="space-y-1">
        <label
          htmlFor={fieldId("sellingPrice")}
          className="text-xs font-semibold uppercase tracking-wide text-slate-600"
        >
          Selling Price <span className="text-red-500">*</span>
        </label>
        <div className="flex items-center gap-3">
          <Input
            id={fieldId("sellingPrice")}
            name="sellingPrice"
            type="number"
            min={0}
            step="1"
            required
            value={sellingPrice}
            onChange={(event) => setSellingPrice(event.target.value)}
            placeholder="e.g. 1999"
          />
          <span className="whitespace-nowrap text-xs text-slate-600">{formatINR(parsedSellingPrice)}</span>
        </div>
      </div>

      <div className="space-y-1">
        <label
          htmlFor={fieldId("categoryId")}
          className="text-xs font-semibold uppercase tracking-wide text-slate-600"
        >
          Category <span className="text-red-500">*</span>
        </label>
        <Select
          id={fieldId("categoryId")}
          name="categoryId"
          value={selectedCategoryId}
          required
          onChange={(event) => setSelectedCategoryId(event.target.value)}
        >
          <option value="" disabled>
            Select category
          </option>
          {categories.map((category) => (
            <option key={category.id} value={category.id}>
              {category.path}
            </option>
          ))}
        </Select>
      </div>

      <div className="space-y-1">
        <label htmlFor={fieldId("status")} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
          Status
        </label>
        <Select id={fieldId("status")} name="status" defaultValue="draft">
          <option value="draft">draft</option>
          <option value="active">active</option>
          <option value="archived">archived</option>
        </Select>
      </div>

      <div className="space-y-3 rounded-md border border-slate-200 bg-slate-50 p-3 md:col-span-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-600">Category Attributes</p>
        {!selectedCategoryId ? (
          <p className="text-sm text-slate-600">
            Select a category above to see required fields for this product type.
          </p>
        ) : loadingAttributes ? (
          <p className="text-sm text-slate-600">Loading category attributes...</p>
        ) : attributeFetchError ? (
          <p className="text-sm text-red-700">{attributeFetchError}</p>
        ) : definitions.length === 0 ? (
          <p className="text-sm text-slate-600">No additional attributes required for this category.</p>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {definitions.map((definition) => {
              const type = String(definition.dataType).toLowerCase();
              const id = fieldId(`attr-${definition.key}`);
              const currentValue = attributeValues[definition.key];
              const allowedValues = getAllowedValues(definition);

              if (type === "boolean") {
                return (
                  <label key={definition.id} htmlFor={id} className="flex items-center gap-2 text-sm text-slate-700">
                    <input
                      id={id}
                      type="checkbox"
                      checked={Boolean(currentValue)}
                      onChange={(event) =>
                        setAttributeValues((previous) => ({
                          ...previous,
                          [definition.key]: event.target.checked,
                        }))
                      }
                      className="h-4 w-4 rounded border-slate-300"
                    />
                    <span>
                      {definition.name}
                      {definition.required ? <span className="ml-1 text-red-500">*</span> : null}
                    </span>
                  </label>
                );
              }

              if ((type === "select" || type === "enum") && allowedValues.length > 0) {
                return (
                  <div key={definition.id} className="space-y-1">
                    <label htmlFor={id} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {definition.name}
                      {definition.required ? <span className="ml-1 text-red-500">*</span> : null}
                    </label>
                    <Select
                      id={id}
                      value={String(currentValue ?? "")}
                      onChange={(event) =>
                        setAttributeValues((previous) => ({
                          ...previous,
                          [definition.key]: event.target.value,
                        }))
                      }
                    >
                      <option value="">Select value</option>
                      {allowedValues.map((option) => (
                        <option key={`${definition.id}-${option}`} value={option}>
                          {option}
                        </option>
                      ))}
                    </Select>
                  </div>
                );
              }

              if (type === "json") {
                return (
                  <div key={definition.id} className="space-y-1 md:col-span-2">
                    <label htmlFor={id} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                      {definition.name}
                      {definition.required ? <span className="ml-1 text-red-500">*</span> : null}
                    </label>
                    <Input
                      id={id}
                      type="text"
                      value={String(currentValue ?? "")}
                      onChange={(event) =>
                        setAttributeValues((previous) => ({
                          ...previous,
                          [definition.key]: event.target.value,
                        }))
                      }
                      placeholder="Enter details"
                    />
                    <p className="text-xs text-slate-500">
                      Use plain text; we will structure this value during save.
                    </p>
                  </div>
                );
              }

              return (
                <div key={definition.id} className="space-y-1">
                  <label htmlFor={id} className="text-xs font-semibold uppercase tracking-wide text-slate-600">
                    {definition.name}
                    {definition.required ? <span className="ml-1 text-red-500">*</span> : null}
                  </label>
                  <Input
                    id={id}
                    type={type === "number" ? "number" : "text"}
                    value={String(currentValue ?? "")}
                    onChange={(event) =>
                      setAttributeValues((previous) => ({
                        ...previous,
                        [definition.key]: event.target.value,
                      }))
                    }
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="md:col-span-2">
        <Button type="submit" disabled={isPending}>
          {isPending ? "Creating..." : "Create product"}
        </Button>
      </div>
    </form>
  );
}
