"use server";

import { revalidatePath } from "next/cache";
import { postJson } from "@/lib/api";

function parseNumber(value: FormDataEntryValue | null): number | undefined {
  if (value === null) {
    return undefined;
  }
  const text = String(value).trim();
  if (!text) {
    return undefined;
  }
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseJsonObject(value: FormDataEntryValue | null, label: string): Record<string, unknown> {
  const text = String(value ?? "").trim();
  if (!text) {
    return {};
  }
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`${label} must be a JSON object.`);
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new Error(`${label} must be valid JSON object.`);
  }
}

function parseJsonArray(value: FormDataEntryValue | null, label: string): string[] {
  const text = String(value ?? "").trim();
  if (!text) {
    return [];
  }
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) {
      throw new Error(`${label} must be a JSON array.`);
    }
    return parsed
      .map((item) => String(item ?? "").trim())
      .filter((item) => item.length > 0);
  } catch {
    throw new Error(`${label} must be valid JSON array.`);
  }
}

export async function createCategoryAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const parentId = String(formData.get("parentId") ?? "").trim();
  if (!name) {
    throw new Error("Category name is required.");
  }
  await postJson("/taxonomy/categories", {
    name,
    parentId: parentId || undefined,
  });
  revalidatePath("/");
}

export async function createProductAction(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const categoryId = String(formData.get("categoryId") ?? "").trim();
  if (!title || !categoryId) {
    throw new Error("Product title and category are required.");
  }
  const attributes = parseJsonObject(formData.get("attributes"), "Product attributes");
  await postJson("/catalog/products", {
    title,
    description: String(formData.get("description") ?? "").trim(),
    brand: String(formData.get("brand") ?? "").trim(),
    categoryId,
    hsnCode: String(formData.get("hsnCode") ?? "").trim() || undefined,
    gstRate: parseNumber(formData.get("gstRate")),
    attributes,
    status: String(formData.get("status") ?? "draft"),
  });
  revalidatePath("/");
}

export async function createAttributeDefinitionAction(formData: FormData) {
  const categoryId = String(formData.get("categoryId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const key = String(formData.get("key") ?? "").trim();
  if (!categoryId || !name || !key) {
    throw new Error("Category, name, and key are required for attribute definition.");
  }

  const allowedValuesRaw = String(formData.get("allowedValues") ?? "").trim();
  let allowedValues: Record<string, unknown> | undefined;
  if (allowedValuesRaw) {
    try {
      const values = JSON.parse(allowedValuesRaw);
      if (Array.isArray(values)) {
        allowedValues = { values };
      } else if (values && typeof values === "object") {
        allowedValues = values as Record<string, unknown>;
      } else {
        throw new Error("Allowed values must be JSON array/object.");
      }
    } catch {
      throw new Error("Allowed values must be valid JSON.");
    }
  }

  await postJson(`/taxonomy/categories/${categoryId}/attributes`, {
    name,
    key,
    dataType: String(formData.get("dataType") ?? "text"),
    required: String(formData.get("required") ?? "false") === "true",
    appliesTo: String(formData.get("appliesTo") ?? "product"),
    allowedValues,
  });
  revalidatePath("/");
}

export async function validateProductAction(formData: FormData) {
  const productId = String(formData.get("productId") ?? "").trim();
  if (!productId) {
    throw new Error("Product id is required.");
  }
  await postJson(`/compliance/products/${productId}/validate`, {});
  revalidatePath(`/products/${productId}`);
}

export async function createVariantAction(formData: FormData) {
  const productId = String(formData.get("productId") ?? "").trim();
  const skuCode = String(formData.get("skuCode") ?? "").trim();
  if (!productId || !skuCode) {
    throw new Error("Product and SKU are required.");
  }
  const attributes = parseJsonObject(formData.get("attributes"), "Attributes");

  await postJson(`/catalog/products/${productId}/variants`, {
    skuCode,
    attributes,
    mrp: parseNumber(formData.get("mrp")),
    sellingPrice: parseNumber(formData.get("sellingPrice")),
    inventoryQty: parseNumber(formData.get("inventoryQty")) ?? 0,
    status: String(formData.get("status") ?? "draft"),
  });

  revalidatePath(`/products/${productId}`);
}

export async function createMappingTemplateAction(formData: FormData) {
  const categoryId = String(formData.get("categoryId") ?? "").trim();
  const channel = String(formData.get("channel") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  if (!categoryId || !channel || !name) {
    throw new Error("Category, channel, and template name are required.");
  }

  const requiredFields = parseJsonArray(formData.get("requiredFields"), "Required fields");
  const fieldMap = parseJsonObject(formData.get("fieldMap"), "Field map");
  const isDefault = String(formData.get("isDefault") ?? "false") === "true";
  const productId = String(formData.get("productId") ?? "").trim();

  await postJson(`/marketplace/categories/${categoryId}/templates`, {
    name,
    channel,
    requiredFields,
    fieldMap,
    isDefault,
  });

  revalidatePath("/");
  if (productId) {
    revalidatePath(`/products/${productId}`);
  }
}

export async function createExportJobAction(formData: FormData) {
  const productId = String(formData.get("productId") ?? "").trim();
  const channel = String(formData.get("channel") ?? "").trim();
  const templateId = String(formData.get("templateId") ?? "").trim();
  const maxRetries = parseNumber(formData.get("maxRetries"));
  if (!productId || !channel) {
    throw new Error("Product and channel are required for export.");
  }
  await postJson(`/marketplace/products/${productId}/export-jobs`, {
    channel,
    templateId: templateId || undefined,
    maxRetries,
  });
  revalidatePath(`/products/${productId}`);
}

export async function processExportJobAction(formData: FormData) {
  const jobId = String(formData.get("jobId") ?? "").trim();
  const productId = String(formData.get("productId") ?? "").trim();
  if (!jobId || !productId) {
    throw new Error("Job id and product id are required.");
  }
  await postJson(`/marketplace/export-jobs/${jobId}/process`, {});
  revalidatePath(`/products/${productId}`);
}

export async function requeueExportJobAction(formData: FormData) {
  const jobId = String(formData.get("jobId") ?? "").trim();
  const productId = String(formData.get("productId") ?? "").trim();
  if (!jobId || !productId) {
    throw new Error("Job id and product id are required.");
  }
  await postJson(`/marketplace/export-jobs/${jobId}/requeue`, {});
  revalidatePath(`/products/${productId}`);
}
