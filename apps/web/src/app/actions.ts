"use server";

import { Buffer } from "node:buffer";
import { revalidatePath } from "next/cache";
import { applyBulkEdit as applyBulkEditRequest, normalizeAppRole, postJson } from "@/lib/api";

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

function parseStringList(value: FormDataEntryValue | null): string[] {
  const text = String(value ?? "").trim();
  if (!text) {
    return [];
  }
  return Array.from(
    new Set(
      text
        .split(/[\n,]/)
        .map((item) => item.trim())
        .filter((item) => item.length > 0),
    ),
  );
}

function detectSourceFormatFromFileName(fileName: string) {
  const normalized = fileName.trim().toLowerCase();
  if (normalized.endsWith(".xlsx")) {
    return "xlsx" as const;
  }
  if (normalized.endsWith(".xls")) {
    return "xls" as const;
  }
  if (normalized.endsWith(".csv")) {
    return "csv" as const;
  }
  if (normalized.endsWith(".json")) {
    return "json" as const;
  }
  return null;
}

function postJsonForAction<T>(formData: FormData, path: string, body: unknown) {
  return postJson<T>(path, body, {
    role: normalizeAppRole(formData.get("actorRole")),
  });
}

export async function createCategoryAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const parentId = String(formData.get("parentId") ?? "").trim();
  if (!name) {
    throw new Error("Category name is required.");
  }
  await postJsonForAction(formData, "/taxonomy/categories", {
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
  await postJsonForAction(formData, "/catalog/products", {
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

  await postJsonForAction(formData, `/taxonomy/categories/${categoryId}/attributes`, {
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
  await postJsonForAction(formData, `/compliance/products/${productId}/validate`, {});
  revalidatePath(`/products/${productId}`);
}

export async function createVariantAction(formData: FormData) {
  const productId = String(formData.get("productId") ?? "").trim();
  const skuCode = String(formData.get("skuCode") ?? "").trim();
  if (!productId || !skuCode) {
    throw new Error("Product and SKU are required.");
  }
  const attributes = parseJsonObject(formData.get("attributes"), "Attributes");

  await postJsonForAction(formData, `/catalog/products/${productId}/variants`, {
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

  await postJsonForAction(formData, `/marketplace/categories/${categoryId}/templates`, {
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
  await postJsonForAction(formData, `/marketplace/products/${productId}/export-jobs`, {
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
  await postJsonForAction(formData, `/marketplace/export-jobs/${jobId}/process`, {});
  revalidatePath(`/products/${productId}`);
}

export async function requeueExportJobAction(formData: FormData) {
  const jobId = String(formData.get("jobId") ?? "").trim();
  const productId = String(formData.get("productId") ?? "").trim();
  if (!jobId || !productId) {
    throw new Error("Job id and product id are required.");
  }
  await postJsonForAction(formData, `/marketplace/export-jobs/${jobId}/requeue`, {});
  revalidatePath(`/products/${productId}`);
}

export async function createBulkImportJobAction(formData: FormData) {
  const categoryId = String(formData.get("categoryId") ?? "").trim();
  let sourceFormat = String(formData.get("sourceFormat") ?? "").trim().toLowerCase();
  let sourceName = String(formData.get("sourceName") ?? "").trim();
  const csvContent = String(formData.get("csvContent") ?? "");
  const rowsJson = String(formData.get("rowsJson") ?? "").trim();
  const sourceFileEntry = formData.get("sourceFile");
  const mapping = parseJsonObject(formData.get("mapping"), "Mapping");
  const chunkSize = parseNumber(formData.get("chunkSize"));
  const maxRetries = parseNumber(formData.get("maxRetries"));

  if (!categoryId) {
    throw new Error("Category is required for bulk import.");
  }

  const sourceFile =
    sourceFileEntry instanceof File && sourceFileEntry.size > 0 ? sourceFileEntry : null;
  let fileContentBase64: string | undefined;

  let rows: Record<string, unknown>[] | undefined;
  if (sourceFile) {
    const detectedFormat = detectSourceFormatFromFileName(sourceFile.name);
    if (!detectedFormat) {
      throw new Error("Uploaded file must be .csv, .xlsx, .xls, or .json.");
    }
    if (sourceFormat && sourceFormat !== detectedFormat) {
      throw new Error(`Selected source format does not match uploaded file (${detectedFormat}).`);
    }
    sourceFormat = detectedFormat;
    sourceName = sourceName || sourceFile.name;

    if (sourceFormat === "json") {
      const text = await sourceFile.text();
      try {
        const parsed = JSON.parse(text);
        if (!Array.isArray(parsed)) {
          throw new Error("JSON file must contain an array of rows.");
        }
        rows = parsed as Record<string, unknown>[];
      } catch {
        throw new Error("Uploaded JSON file must contain a valid JSON array.");
      }
    } else {
      fileContentBase64 = Buffer.from(await sourceFile.arrayBuffer()).toString("base64");
    }
  } else if (sourceFormat === "json") {
    if (!rowsJson) {
      throw new Error("rowsJson is required when source format is json and no file is uploaded.");
    }
    try {
      const parsed = JSON.parse(rowsJson);
      if (!Array.isArray(parsed)) {
        throw new Error("rowsJson must be a JSON array.");
      }
      rows = parsed as Record<string, unknown>[];
    } catch {
      throw new Error("rowsJson must be valid JSON array.");
    }
  } else if (sourceFormat === "csv") {
    if (!csvContent.trim()) {
      throw new Error("csvContent is required when source format is csv and no file is uploaded.");
    }
  } else if (sourceFormat === "xlsx" || sourceFormat === "xls") {
    throw new Error("Upload a spreadsheet file for xlsx/xls source format.");
  } else {
    throw new Error("Source format must be csv, json, xlsx, or xls.");
  }

  await postJsonForAction(formData, "/bulk-import/jobs", {
    categoryId,
    sourceFormat,
    sourceName: sourceName || undefined,
    csvContent: sourceFormat === "csv" ? csvContent : undefined,
    fileContentBase64,
    rows: sourceFormat === "json" ? rows : undefined,
    mapping,
    chunkSize,
    maxRetries,
  });
  revalidatePath("/");
}

export async function createBulkImportTemplateAction(formData: FormData) {
  const tenantKey = String(formData.get("tenantKey") ?? "").trim() || "default";
  const categoryId = String(formData.get("categoryId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const sourceFormat = String(formData.get("sourceFormat") ?? "").trim().toLowerCase();
  const chunkSize = parseNumber(formData.get("chunkSize"));
  const maxRetries = parseNumber(formData.get("maxRetries"));
  const mappingRaw = parseJsonObject(formData.get("mapping"), "Template mapping");

  if (!categoryId || !name) {
    throw new Error("Template tenant, category, and name are required.");
  }
  if (!["csv", "json", "xlsx", "xls"].includes(sourceFormat)) {
    throw new Error("Template source format must be csv, json, xlsx, or xls.");
  }

  const mapping: Record<string, string> = {};
  for (const [key, value] of Object.entries(mappingRaw)) {
    const field = String(key ?? "").trim();
    const mapped = String(value ?? "").trim();
    if (field && mapped) {
      mapping[field] = mapped;
    }
  }

  await postJsonForAction(formData, "/bulk-import/templates", {
    tenantKey,
    categoryId,
    name,
    sourceFormat,
    chunkSize,
    maxRetries,
    mapping,
  });
  revalidatePath("/");
}

export async function processBulkImportJobAction(formData: FormData) {
  const jobId = String(formData.get("jobId") ?? "").trim();
  const chunkSize = parseNumber(formData.get("chunkSize"));
  if (!jobId) {
    throw new Error("Bulk import job id is required.");
  }
  await postJsonForAction(formData, `/bulk-import/jobs/${jobId}/process`, {
    chunkSize,
  });
  revalidatePath("/");
}

export async function requeueBulkImportDlqAction(formData: FormData) {
  const jobId = String(formData.get("jobId") ?? "").trim();
  const limit = parseNumber(formData.get("limit"));
  if (!jobId) {
    throw new Error("Bulk import job id is required.");
  }
  await postJsonForAction(formData, `/bulk-import/jobs/${jobId}/requeue-dlq`, {
    limit,
  });
  revalidatePath("/");
}

export async function processBulkImportRowAction(formData: FormData) {
  const jobId = String(formData.get("jobId") ?? "").trim();
  const rowId = String(formData.get("rowId") ?? "").trim();
  if (!jobId || !rowId) {
    throw new Error("Bulk import job id and row id are required.");
  }
  await postJsonForAction(formData, `/bulk-import/jobs/${jobId}/rows/${rowId}/process`, {});
  revalidatePath("/");
}

export async function repairBulkImportRowAction(formData: FormData) {
  const jobId = String(formData.get("jobId") ?? "").trim();
  const rowId = String(formData.get("rowId") ?? "").trim();
  const payloadRaw = String(formData.get("payload") ?? "").trim();
  const requeue = String(formData.get("requeue") ?? "true") === "true";
  if (!jobId || !rowId) {
    throw new Error("Bulk import job id and row id are required.");
  }
  const payload = payloadRaw ? parseJsonObject(payloadRaw, "Repair payload") : {};
  await postJsonForAction(formData, `/bulk-import/jobs/${jobId}/rows/${rowId}/repair`, {
    payload,
    requeue,
  });
  revalidatePath("/");
}

export async function applyBulkEditAction(formData: FormData) {
  const categoryId = String(formData.get("categoryId") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const brandContains = String(formData.get("brandContains") ?? "").trim();
  const productIds = parseStringList(formData.get("productIds"));
  const updates = parseJsonObject(formData.get("updates"), "Bulk edit updates");

  const scope: Record<string, unknown> = {};
  if (categoryId) {
    scope.categoryId = categoryId;
  }
  if (status) {
    scope.status = status;
  }
  if (brandContains) {
    scope.brandContains = brandContains;
  }
  if (productIds.length > 0) {
    scope.productIds = productIds;
  }

  await applyBulkEditRequest(scope, updates, {
    role: normalizeAppRole(formData.get("actorRole")),
  });
  revalidatePath("/");
}
