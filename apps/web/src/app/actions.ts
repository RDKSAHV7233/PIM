"use server";

import { Buffer } from "node:buffer";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { isRedirectError } from "next/dist/client/components/redirect-error";
import {
  addApprovalComment as addApprovalCommentRequest,
  ApiHttpError,
  type ApiRequestOptions,
  applyBulkEdit as applyBulkEditRequest,
  decideProductReview as decideProductReviewRequest,
  deleteJson,
  getProduct,
  getProductVariants,
  getPlanLimitExceededPayload,
  issueStepUp,
  patchJson,
  postJson,
  rollbackConnectorMappingVersion,
} from "@/lib/api";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";
import {
  IN_DEVELOPMENT_CHANNEL_NOTICE,
  isChannelInDevelopment,
  isMarketplaceChannel,
} from "@/lib/marketplace-channels";

const STEP_UP_SCOPE_MAPPING_HIGH_RISK = "mapping_high_risk";
const STEP_UP_TOKEN_HEADER = "x-pim-step-up-token";
const STEP_UP_ERROR_CODES = new Set([
  "STEP_UP_REQUIRED",
  "STEP_UP_INVALID_CREDENTIALS",
  "STEP_UP_TOKEN_INVALID",
  "STEP_UP_TOKEN_SESSION_MISMATCH",
  "STEP_UP_SCOPE_MISMATCH",
  "STEP_UP_PASSWORD_REQUIRED",
]);
const CONNECTOR_PERMISSION_ROLE_IDS = new Set(["admin", "editor", "publisher", "approver", "channel_manager", "connector_admin", "reviewer", "viewer"]);

function rethrowRedirectError(error: unknown): void {
  if (isRedirectError(error)) {
    throw error;
  }
}

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

function parseStructuredConnectorMappingRules(formData: FormData, categoryScope: string): Record<string, unknown> {
  const fieldMappings: Record<string, string> = {};
  for (const [key, rawValue] of formData.entries()) {
    if (!key.startsWith("mapTarget::")) {
      continue;
    }
    const targetField = String(key.slice("mapTarget::".length)).trim();
    const sourceField = String(rawValue ?? "").trim();
    if (targetField && sourceField) {
      fieldMappings[sourceField] = targetField;
    }
  }

  const requiredFields = formData
    .getAll("requiredField")
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  const taxonomyRequiredAttributes = formData
    .getAll("taxonomyRequiredAttribute")
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  const targetCategory = String(formData.get("targetCategory") ?? "").trim();

  return {
    field_mappings: fieldMappings,
    required_fields: requiredFields,
    category: {
      source: categoryScope,
      target: targetCategory,
    },
    taxonomy_required_attributes: taxonomyRequiredAttributes,
  };
}

function parseStructuredConnectorFallbackPolicy(formData: FormData): Record<string, unknown> {
  const enabled = String(formData.get("fallbackEnabled") ?? "true").trim() === "true";
  const warningTag = String(formData.get("fallbackWarningTag") ?? "").trim();
  const ackMessage = String(formData.get("fallbackAckMessage") ?? "").trim();
  const defaultCategory = String(formData.get("fallbackDefaultCategory") ?? "").trim();

  const fallbackPolicy: Record<string, unknown> = {
    enabled,
  };
  if (warningTag) {
    fallbackPolicy.warning_tag = warningTag;
  }
  if (ackMessage) {
    fallbackPolicy.ack_message = ackMessage;
  }
  if (defaultCategory) {
    fallbackPolicy.default_category = defaultCategory;
  }
  return fallbackPolicy;
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

function hasDynamicAttributeFields(formData: FormData): boolean {
  for (const key of formData.keys()) {
    if (key.startsWith("attr__")) {
      return true;
    }
  }
  return false;
}

function parseDynamicAttributes(
  formData: FormData,
  baseAttributes: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...baseAttributes };
  for (const [fieldName, raw] of formData.entries()) {
    if (!fieldName.startsWith("attr__")) {
      continue;
    }
    const key = fieldName.slice("attr__".length);
    if (!key) {
      continue;
    }

    const type = String(formData.get(`attrType__${key}`) ?? "text")
      .trim()
      .toLowerCase();
    const rawText = String(raw ?? "").trim();
    let normalized: unknown;

    if (type === "boolean") {
      const value = rawText.toLowerCase();
      normalized = value === "true" || value === "1" || value === "on";
    } else if (type === "number") {
      if (!rawText) {
        normalized = null;
      } else {
        const parsed = Number(rawText);
        normalized = Number.isFinite(parsed) ? parsed : null;
      }
    } else if (type === "json") {
      if (!rawText) {
        normalized = null;
      } else {
        try {
          normalized = JSON.parse(rawText);
        } catch {
          normalized = rawText;
        }
      }
    } else {
      normalized = rawText || null;
    }

    if (normalized === null || normalized === "") {
      delete merged[key];
    } else {
      merged[key] = normalized;
    }
  }
  return merged;
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
  if (normalized.endsWith(".csv")) {
    return "csv" as const;
  }
  if (normalized.endsWith(".json")) {
    return "json" as const;
  }
  return null;
}

function resolveTenantKey(formData: FormData): string {
  const fromForm = String(formData.get("tenantKey") ?? "").trim();
  if (fromForm) {
    return fromForm;
  }
  const fromEnv = String(process.env.PIM_DEFAULT_TENANT_KEY ?? "").trim();
  return fromEnv || "default";
}

async function resolveActionOptions(formData: FormData) {
  return {
    tenantKey: resolveTenantKey(formData),
    authHeader: await getServerAuthHeader(),
  };
}

async function postJsonForAction<T>(formData: FormData, path: string, body: unknown, options?: ApiRequestOptions) {
  return postJson<T>(path, body, {
    ...(await resolveActionOptions(formData)),
    ...(options ?? {}),
    headers: {
      ...(options?.headers ?? {}),
    },
  });
}

async function patchJsonForAction<T>(formData: FormData, path: string, body: unknown) {
  return patchJson<T>(path, body, {
    ...(await resolveActionOptions(formData)),
  });
}

async function deleteJsonForAction(formData: FormData, path: string) {
  return deleteJson(path, {
    ...(await resolveActionOptions(formData)),
  });
}

function appendQueryParams(basePath: string, params: Record<string, string | undefined>): string {
  const [path, query = ""] = basePath.split("?");
  const search = new URLSearchParams(query);
  for (const [key, value] of Object.entries(params)) {
    if (value && value.trim()) {
      search.set(key, value.trim());
    }
  }
  const nextQuery = search.toString();
  return nextQuery ? `${path}?${nextQuery}` : path;
}

function replaceQueryParams(
  basePath: string,
  params: Record<string, string | null | undefined>,
): string {
  const [path, query = ""] = basePath.split("?");
  const search = new URLSearchParams(query);
  for (const [key, value] of Object.entries(params)) {
    const normalized = typeof value === "string" ? value.trim() : value;
    if (normalized) {
      search.set(key, normalized);
      continue;
    }
    search.delete(key);
  }
  const nextQuery = search.toString();
  return nextQuery ? `${path}?${nextQuery}` : path;
}
function resolveConnectorPermissionGrantStatus(error: unknown): string | null {
  if (!(error instanceof ApiHttpError) || error.status !== 400 || !error.body || typeof error.body !== "object") {
    return null;
  }
  const payload = error.body as Record<string, unknown>;
  switch (String(payload.error ?? "").trim()) {
    case "CONNECTOR_PERMISSION_INVALID_ROLE":
      return "permission-invalid-role";
    case "CONNECTOR_PERMISSION_USER_NOT_FOUND":
      return "permission-user-not-found";
    case "CONNECTOR_PERMISSION_USER_REQUIRED":
      return "permission-user-required";
    default:
      return "permission-invalid-request";
  }
}

function withStepUpErrorQuery(
  basePath: string,
  action: "publish" | "archive" | "rollback",
  versionId: string,
  error: unknown,
): string | null {
  if (error instanceof ApiHttpError && error.body && typeof error.body === "object") {
    const payload = error.body as Record<string, unknown>;
    const code = String(payload.error ?? "").trim();
    if (STEP_UP_ERROR_CODES.has(code)) {
      return appendQueryParams(basePath, {
        stepUpError: code,
        stepUpAction: action,
        stepUpVersionId: versionId,
      });
    }
  }
  if (error instanceof Error && error.message === "STEP_UP_PASSWORD_REQUIRED") {
    return appendQueryParams(basePath, {
      stepUpError: "STEP_UP_PASSWORD_REQUIRED",
      stepUpAction: action,
      stepUpVersionId: versionId,
    });
  }
  return null;
}

async function issueMappingStepUpToken(formData: FormData): Promise<string> {
  const password = String(formData.get("stepUpPassword") ?? "").trim();
  if (!password) {
    throw new Error("STEP_UP_PASSWORD_REQUIRED");
  }
  const response = await issueStepUp(
    {
      password,
      scope: STEP_UP_SCOPE_MAPPING_HIGH_RISK,
    },
    await resolveActionOptions(formData),
  );
  return String(response.stepUpToken ?? "").trim();
}

function withPlanLimitQuery(basePath: string, error: unknown): string | null {
  const payload = getPlanLimitExceededPayload(error);
  if (!payload) {
    return null;
  }
  const upgradeUrl = payload.upgrade_url;
  const separator = basePath.includes("?") ? "&" : "?";
  let query =
    `${basePath}${separator}planLimit=1` +
    `&planResource=${encodeURIComponent(payload.resource)}` +
    `&planLimitValue=${encodeURIComponent(String(payload.limit))}` +
    `&planCurrent=${encodeURIComponent(String(payload.current))}` +
    `&planUpgrade=${encodeURIComponent(upgradeUrl)}`;
  if (payload.contact_url) {
    query += `&planContact=${encodeURIComponent(payload.contact_url)}`;
  }
  return query;
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
  revalidatePath("/catalog/categories");
  revalidatePath("/dashboard");
}

export async function deleteCategoryAction(formData: FormData) {
  const categoryId = String(formData.get("categoryId") ?? "").trim();
  const confirmDelete = String(formData.get("confirmDelete") ?? "").trim().toLowerCase();
  if (!categoryId) {
    throw new Error("Category id is required.");
  }
  if (confirmDelete !== "yes") {
    throw new Error("Confirm category delete before proceeding.");
  }
  const returnTo = resolveReturnToPath(formData, "/catalog/categories");

  try {
    await deleteJsonForAction(formData, `/taxonomy/categories/${encodeURIComponent(categoryId)}`);
    revalidatePath("/catalog/categories");
    revalidatePath("/dashboard");
    redirect(
      appendQueryParams(returnTo, {
        deleteStatus: "deleted",
        deletedCategory: categoryId,
      }),
    );
  } catch (error: unknown) {
    rethrowRedirectError(error);
    const deleteError = resolveDeleteErrorMessage(error);
    redirect(
      appendQueryParams(returnTo, {
        deleteError,
        deletedCategory: categoryId,
      }),
    );
  }
}

export async function resolveIssueInboxWarningsAction(formData: FormData) {
  const issueIds = Array.from(
    new Set(
      formData
        .getAll("issueIds")
        .map((value) => String(value ?? "").trim())
        .filter((value) => value.length > 0),
    ),
  );
  if (issueIds.length === 0) {
    throw new Error("Select at least one warning issue to resolve.");
  }

  await postJsonForAction(formData, "/issues/inbox/resolve", {
    issueIds,
  });

  revalidatePath("/quality/issues");
  const returnToRaw = String(formData.get("returnTo") ?? "").trim();
  const returnTo = returnToRaw.startsWith("/") ? returnToRaw : "/quality/issues";
  redirect(returnTo || "/quality/issues");
}

function resolveReturnToPath(formData: FormData, fallback: string): string {
  const returnToRaw = String(formData.get("returnTo") ?? "").trim();
  if (returnToRaw.startsWith("/")) {
    return returnToRaw;
  }
  return fallback;
}

function resolveDeleteErrorMessage(error: unknown): string {
  if (error instanceof ApiHttpError && error.body && typeof error.body === "object") {
    const payload = error.body as Record<string, unknown>;
    const message = String(payload.error ?? "").trim();
    if (message) {
      return message;
    }
  }
  if (error instanceof Error) {
    return error.message;
  }
  return "delete_failed";
}

function resolveInstallConnectorError(error: unknown): string {
  if (error instanceof ApiHttpError && error.body && typeof error.body === "object") {
    const payload = error.body as Record<string, unknown>;
    const code = String(payload.error ?? "").trim();
    if (code) {
      return code;
    }
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message.trim();
  }
  return "install_failed";
}

async function resolveProductDeleteTokens(
  productId: string,
  options: ApiRequestOptions,
): Promise<{ productId: string; tokens: string[] }> {
  const [product, variants] = await Promise.all([
    getProduct(productId, options),
    getProductVariants(productId, options),
  ]);
  const tokenSet = new Set<string>();
  if (product?.id) {
    tokenSet.add(String(product.id));
  }
  for (const variant of variants ?? []) {
    if (variant?.skuCode) {
      tokenSet.add(String(variant.skuCode));
    }
  }
  return { productId: product?.id ?? productId, tokens: Array.from(tokenSet) };
}

export async function decideProductReviewAction(
  statusOrFormData: "approved" | "rejected" | FormData,
  maybeFormData?: FormData,
) {
  const formData = statusOrFormData instanceof FormData ? statusOrFormData : maybeFormData;
  if (!formData) {
    throw new Error("Product review decision requires form data.");
  }
  const status = statusOrFormData instanceof FormData
    ? String(formData.get("status") ?? "").trim()
    : statusOrFormData;
  const productId = String(formData.get("productId") ?? "").trim();
  const note = String(formData.get("note") ?? "").trim();
  if (!productId || (status !== "approved" && status !== "rejected")) {
    throw new Error("Product review decision requires productId and approved/rejected status.");
  }

  const returnToRaw = String(formData.get("returnTo") ?? "").trim();
  const returnTo = returnToRaw.startsWith("/") ? returnToRaw : "/quality/approvals";

  try {
    await decideProductReviewRequest(
      productId,
      {
        status,
        note: note || undefined,
      },
      await resolveActionOptions(formData),
    );
    revalidatePath("/quality/approvals");
    revalidatePath(`/products/${productId}`);
    redirect(appendQueryParams(returnTo, { decisionStatus: status }));
  } catch (error: unknown) {
    rethrowRedirectError(error);
    const body = error instanceof ApiHttpError ? (error.body as Record<string, unknown> | null) : null;
    const message = String(body?.code ?? body?.error ?? "").trim();
    const decisionError = message || "decision_failed";
    redirect(appendQueryParams(returnTo, { decisionError }));
  }
}

export async function addApprovalCommentAction(formData: FormData) {
  const productId = String(formData.get("productId") ?? "").trim();
  const body = String(formData.get("body") ?? "").trim();
  if (!productId || !body) {
    throw new Error("Approval comment requires productId and body.");
  }

  await addApprovalCommentRequest(productId, body, await resolveActionOptions(formData));
  revalidatePath("/quality/approvals");
  revalidatePath(`/products/${productId}`);
}

export async function createProductAction(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  const categoryId = String(formData.get("categoryId") ?? "").trim();
  if (!title || !categoryId) {
    throw new Error("Product title and category are required.");
  }
  const baseAttributes = parseJsonObject(formData.get("attributes"), "Product attributes");
  const mrp = parseNumber(formData.get("mrp"));
  const sellingPrice = parseNumber(formData.get("sellingPrice"));

  if (mrp !== undefined && mrp < 0) {
    throw new Error("MRP cannot be negative.");
  }
  if (sellingPrice !== undefined && sellingPrice < 0) {
    throw new Error("Selling Price cannot be negative.");
  }
  if (sellingPrice === undefined) {
    throw new Error("Selling Price is required.");
  }
  if (mrp !== undefined && sellingPrice > mrp) {
    throw new Error("Selling Price cannot exceed MRP.");
  }

  const attributes: Record<string, unknown> = { ...baseAttributes };
  delete attributes.mrp;
  delete attributes.sellingPrice;
  delete attributes.selling_price;

  const existingPricing =
    baseAttributes.pricing && typeof baseAttributes.pricing === "object" && !Array.isArray(baseAttributes.pricing)
      ? (baseAttributes.pricing as Record<string, unknown>)
      : {};
  const pricing: Record<string, unknown> = {
    ...existingPricing,
    sellingPrice,
  };
  if (mrp !== undefined) {
    pricing.mrp = mrp;
  } else {
    delete pricing.mrp;
  }
  attributes.pricing = pricing;

  try {
    await postJsonForAction(formData, "/catalog/products", {
      title,
      description: String(formData.get("description") ?? "").trim(),
      brand: String(formData.get("brand") ?? "").trim(),
      categoryId,
      hsnCode: String(formData.get("hsnCode") ?? "").trim() || undefined,
      gstRate: parseNumber(formData.get("gstRate")),
      attributes,
      status: "draft",
    });
  } catch (error: unknown) {
    const redirectPath = withPlanLimitQuery("/catalog/products", error);
    if (redirectPath) {
      redirect(redirectPath);
    }
    throw error;
  }
  revalidatePath("/catalog/products");
  revalidatePath("/dashboard");
}

export async function updateProductAction(formData: FormData) {
  const productId = String(formData.get("productId") ?? "").trim();
  if (!productId) {
    throw new Error("Product id is required.");
  }

  const title = String(formData.get("title") ?? "").trim();
  const categoryId = String(formData.get("categoryId") ?? "").trim();
  const expectedVersion = parseNumber(formData.get("expectedVersion"));
  if (!title || !categoryId || !expectedVersion) {
    throw new Error("Product title, category, and expected version are required.");
  }

  const baseAttributes = parseJsonObject(formData.get("attributesBase"), "Product attributes");
  const attributes = hasDynamicAttributeFields(formData)
    ? parseDynamicAttributes(formData, baseAttributes)
    : parseJsonObject(formData.get("attributes"), "Product attributes");
  const basePath = `/products/${encodeURIComponent(productId)}`;
  const returnToRaw = String(formData.get("returnTo") ?? "").trim();
  const returnTo = returnToRaw.startsWith("/") ? returnToRaw : undefined;
  const currentTab = String(formData.get("currentTab") ?? "").trim() || undefined;

  try {
    await patchJsonForAction(formData, `/catalog/products/${productId}`, {
      expectedVersion,
      title,
      description: String(formData.get("description") ?? "").trim(),
      brand: String(formData.get("brand") ?? "").trim(),
      categoryId,
      hsnCode: String(formData.get("hsnCode") ?? "").trim() || undefined,
      gstRate: parseNumber(formData.get("gstRate")),
      attributes,
      status: String(formData.get("status") ?? "draft"),
    });
    revalidatePath(`/products/${productId}`);
    redirect(
      appendQueryParams(basePath, {
        tab: currentTab,
        returnTo,
        updateStatus: "updated",
      }),
    );
  } catch (error: unknown) {
    rethrowRedirectError(error);
    if (error instanceof ApiHttpError && error.status === 409) {
      const body =
        typeof error.body === "object" && error.body !== null
          ? (error.body as Record<string, unknown>)
          : null;
      if (body?.code === "VERSION_CONFLICT") {
        const currentVersion =
          typeof body.currentVersion === "number" ? body.currentVersion : null;
        redirect(
          appendQueryParams(basePath, {
            tab: currentTab,
            returnTo,
            updateStatus: "conflict",
            currentVersion: currentVersion !== null ? String(currentVersion) : undefined,
          }),
        );
      }
    }
    redirect(
      appendQueryParams(basePath, {
        tab: currentTab,
        returnTo,
        updateStatus: "error",
      }),
    );
  }
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
  revalidatePath("/catalog/attributes");
}

export async function validateProductAction(formData: FormData) {
  const productId = String(formData.get("productId") ?? "").trim();
  if (!productId) {
    throw new Error("Product id is required.");
  }
  await postJsonForAction(formData, `/compliance/products/${productId}/validate`, {});
  revalidatePath(`/products/${productId}`);
}

export async function deleteProductAction(formData: FormData) {
  const productId = String(formData.get("productId") ?? "").trim();
  const confirmDelete = String(formData.get("confirmDelete") ?? "").trim().toLowerCase();
  if (!productId) {
    throw new Error("Product id is required.");
  }
  if (confirmDelete !== "yes") {
    throw new Error("Confirm product delete before proceeding.");
  }
  const returnTo = resolveReturnToPath(formData, "/catalog/products");

  try {
    await deleteJsonForAction(formData, `/catalog/products/${encodeURIComponent(productId)}`);
    revalidatePath("/catalog/products");
    revalidatePath(`/products/${productId}`);
    revalidatePath("/dashboard");
    redirect(
      appendQueryParams(returnTo, {
        deleteStatus: "deleted",
        deletedId: productId,
      }),
    );
  } catch (error: unknown) {
    rethrowRedirectError(error);
    const deleteError = resolveDeleteErrorMessage(error);
    redirect(
      appendQueryParams(returnTo, {
        deleteError,
        deletedId: productId,
      }),
    );
  }
}

export async function purgeProductAction(formData: FormData) {
  const productId = String(formData.get("productId") ?? "").trim();
  const confirmDelete = String(formData.get("confirmDelete") ?? "").trim().toLowerCase();
  const confirmToken = String(formData.get("confirmToken") ?? "").trim();
  if (!productId) {
    throw new Error("Product id is required.");
  }
  if (confirmDelete !== "yes") {
    throw new Error("Confirm permanent delete before proceeding.");
  }

  const actorRole = await getServerActorRole();
  if (actorRole !== "admin") {
    throw new Error("Admin role is required for permanent delete.");
  }

  const { authHeader } = await resolveActionOptions(formData);
  const { tokens } = await resolveProductDeleteTokens(productId, { role: actorRole, authHeader });
  if (!confirmToken || !tokens.includes(confirmToken)) {
    throw new Error("Confirmation does not match a known product SKU or ID.");
  }

  const returnTo = resolveReturnToPath(formData, "/catalog/products");

  try {
    await deleteJsonForAction(formData, `/catalog/products/${encodeURIComponent(productId)}/purge`);
    revalidatePath("/catalog/products");
    revalidatePath(`/products/${productId}`);
    revalidatePath("/dashboard");
    redirect(
      appendQueryParams(returnTo, {
        deleteStatus: "purged",
        deletedId: productId,
      }),
    );
  } catch (error: unknown) {
    rethrowRedirectError(error);
    const deleteError = resolveDeleteErrorMessage(error);
    redirect(
      appendQueryParams(returnTo, {
        deleteError,
        deletedId: productId,
      }),
    );
  }
}

export async function createVariantAction(formData: FormData) {
  const productId = String(formData.get("productId") ?? "").trim();
  const skuCode = String(formData.get("skuCode") ?? "").trim();
  if (!productId || !skuCode) {
    throw new Error("Product and SKU are required.");
  }
  const attributes = parseJsonObject(formData.get("attributes"), "Attributes");
  const basePath = `/products/${encodeURIComponent(productId)}`;

  try {
    await postJsonForAction(formData, `/catalog/products/${productId}/variants`, {
      skuCode,
      attributes,
      mrp: parseNumber(formData.get("mrp")),
      sellingPrice: parseNumber(formData.get("sellingPrice")),
      inventoryQty: parseNumber(formData.get("inventoryQty")) ?? 0,
      status: String(formData.get("status") ?? "draft"),
    });
    revalidatePath(`/products/${productId}`);
  } catch (error: unknown) {
    rethrowRedirectError(error);
    const message = error instanceof Error ? error.message : String(error ?? "");
    if (message.includes("WORKFLOW_CONTENT_LOCKED")) {
      redirect(appendQueryParams(basePath, { tab: "variants", error: "CONTENT_LOCKED" }));
    }
    redirect(appendQueryParams(basePath, { tab: "variants", error: "VARIANT_ERROR" }));
  }
}

export async function updateVariantAction(formData: FormData) {
  const productId = String(formData.get("productId") ?? "").trim();
  const variantId = String(formData.get("variantId") ?? "").trim();
  const skuCode = String(formData.get("skuCode") ?? "").trim();
  if (!productId || !variantId || !skuCode) {
    throw new Error("Product, variant, and SKU are required.");
  }
  const attributes = parseJsonObject(formData.get("attributes"), "Attributes");
  const basePath = `/products/${encodeURIComponent(productId)}`;

  try {
    await patchJsonForAction(formData, `/catalog/variants/${encodeURIComponent(variantId)}`, {
      skuCode,
      attributes,
      mrp: parseNumber(formData.get("mrp")),
      sellingPrice: parseNumber(formData.get("sellingPrice")),
      inventoryQty: parseNumber(formData.get("inventoryQty")) ?? 0,
      status: String(formData.get("status") ?? "draft"),
    });
    revalidatePath(`/products/${productId}`);
  } catch (error: unknown) {
    rethrowRedirectError(error);
    const message = error instanceof Error ? error.message : String(error ?? "");
    if (message.includes("WORKFLOW_CONTENT_LOCKED")) {
      redirect(appendQueryParams(basePath, { tab: "variants", error: "CONTENT_LOCKED" }));
    }
    redirect(appendQueryParams(basePath, { tab: "variants", error: "VARIANT_ERROR" }));
  }
}

export async function deleteVariantAction(formData: FormData) {
  const productId = String(formData.get("productId") ?? "").trim();
  const variantId = String(formData.get("variantId") ?? "").trim();
  const confirmed = String(formData.get("confirmRemove") ?? "") === "yes";
  if (!productId || !variantId) {
    throw new Error("Product and variant are required.");
  }
  if (!confirmed) {
    throw new Error("Confirm variant removal before continuing.");
  }

  await deleteJsonForAction(formData, `/catalog/variants/${encodeURIComponent(variantId)}`);

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

  revalidatePath("/channels/mappings");
  if (productId) {
    revalidatePath(`/products/${productId}`);
  }
}

export async function updateMappingTemplateAction(formData: FormData) {
  const templateId = String(formData.get("templateId") ?? "").trim();
  if (!templateId) {
    throw new Error("Template id is required.");
  }
  const redirectTo = String(formData.get("redirectTo") ?? "").trim();

  const name = String(formData.get("name") ?? "").trim();
  const channel = String(formData.get("channel") ?? "").trim();
  const requiredFieldsRaw = String(formData.get("requiredFields") ?? "").trim();
  const fieldMapRaw = String(formData.get("fieldMap") ?? "").trim();
  const isDefaultRaw = String(formData.get("isDefault") ?? "").trim();
  const versionValue = parseNumber(formData.get("version"));

  const payload: Record<string, unknown> = {};
  if (name.length > 0) {
    payload.name = name;
  }
  if (channel.length > 0) {
    payload.channel = channel;
  }
  if (requiredFieldsRaw.length > 0) {
    payload.requiredFields = parseJsonArray(formData.get("requiredFields"), "Required fields");
  }
  if (fieldMapRaw.length > 0) {
    payload.fieldMap = parseJsonObject(formData.get("fieldMap"), "Field map");
  }
  if (isDefaultRaw.length > 0) {
    payload.isDefault = isDefaultRaw === "true";
  }
  if (typeof versionValue === "number" && Number.isFinite(versionValue) && versionValue > 0) {
    payload.version = Math.floor(versionValue);
  }
  if (Object.keys(payload).length === 0) {
    throw new Error("At least one field is required to update template.");
  }

  await patchJsonForAction(formData, `/marketplace/templates/${templateId}`, payload);
  revalidatePath("/channels/mappings");
  revalidatePath("/catalog/products");
  if (redirectTo) {
    revalidatePath(redirectTo);
    redirect(redirectTo);
  }
}

export async function cloneMappingTemplateAction(formData: FormData) {
  const templateId = String(formData.get("templateId") ?? "").trim();
  if (!templateId) {
    throw new Error("Template id is required.");
  }
  const redirectTo = String(formData.get("redirectTo") ?? "").trim();
  const payload: Record<string, unknown> = {};
  const name = String(formData.get("name") ?? "").trim();
  if (name.length > 0) {
    payload.name = name;
  }
  const isDefaultRaw = String(formData.get("isDefault") ?? "").trim();
  if (isDefaultRaw.length > 0) {
    payload.isDefault = isDefaultRaw === "true";
  }

  await postJsonForAction(formData, `/marketplace/templates/${templateId}/clone`, payload);
  revalidatePath("/channels/mappings");
  revalidatePath("/catalog/products");
  if (redirectTo) {
    revalidatePath(redirectTo);
    redirect(redirectTo);
  }
}

export async function deleteMappingTemplateAction(formData: FormData) {
  const templateId = String(formData.get("templateId") ?? "").trim();
  if (!templateId) {
    throw new Error("Template id is required.");
  }
  const redirectTo = String(formData.get("redirectTo") ?? "").trim();

  await deleteJsonForAction(formData, `/marketplace/templates/${templateId}`);
  revalidatePath("/channels/mappings");
  revalidatePath("/catalog/products");
  if (redirectTo) {
    revalidatePath(redirectTo);
    redirect(redirectTo);
  }
}

export async function installConnectorAction(formData: FormData) {
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase();
  const accountAlias = String(formData.get("accountAlias") ?? "").trim();
  const externalAccountRef = String(formData.get("externalAccountRef") ?? "").trim();
  const shopDomain = String(formData.get("shopDomain") ?? "").trim();
  const clientId = String(formData.get("clientId") ?? "").trim();
  const clientSecret = String(formData.get("clientSecret") ?? "").trim();
  const refreshToken = String(formData.get("refreshToken") ?? "").trim();
  const accessToken = String(formData.get("accessToken") ?? "").trim();
  // Amazon-specific fields
  const marketplaceId = String(formData.get("marketplaceId") ?? "").trim();
  const defaultProductType = String(formData.get("defaultProductType") ?? "").trim().toUpperCase();
  const returnTo = String(formData.get("returnTo") ?? "").trim() || "/channels/connectors";
  if (!slug) {
    throw new Error("Connector slug is required.");
  }

  try {
    await postJsonForAction(formData, `/connectors/${encodeURIComponent(slug)}/install`, {
      accountAlias: accountAlias || undefined,
      externalAccountRef: externalAccountRef || undefined,
      shopDomain: shopDomain || undefined,
      clientId: clientId || undefined,
      clientSecret: clientSecret || undefined,
      refreshToken: refreshToken || undefined,
      accessToken: accessToken || undefined,
      marketplaceId: marketplaceId || undefined,
      defaultProductType: defaultProductType || undefined,
    });
  } catch (error: unknown) {
    rethrowRedirectError(error);
    const installError = resolveInstallConnectorError(error);
    redirect(
      appendQueryParams(returnTo, {
        installError,
        connectorSlug: slug,
      }),
    );
  }

  revalidatePath("/channels/connectors");
  revalidatePath("/connectors");
  revalidatePath("/channels");
  if (returnTo.startsWith("/")) {
    revalidatePath(returnTo);
  }
  revalidatePath("/dashboard");
  redirect(
    appendQueryParams(returnTo, {
      status: "installed",
      connectorSlug: slug,
    }),
  );
}

export async function configureAmazonAction(formData: FormData) {
  const installationId = String(formData.get("installationId") ?? "").trim();
  const marketplaceId = String(formData.get("marketplaceId") ?? "").trim();
  const defaultProductType = String(formData.get("defaultProductType") ?? "").trim().toUpperCase();
  const returnTo =
    String(formData.get("returnTo") ?? "").trim() ||
    `/channels/connectors/${encodeURIComponent(installationId)}?tab=credentials`;
  if (!installationId) {
    throw new Error("Installation ID is required.");
  }
  try {
    await patchJsonForAction(formData, `/connectors/${encodeURIComponent(installationId)}/configure`, {
      marketplaceId: marketplaceId || undefined,
      defaultProductType: defaultProductType || undefined,
    });
  } catch (error: unknown) {
    rethrowRedirectError(error);
    throw error;
  }
  revalidatePath(`/channels/connectors/${installationId}`);
  revalidatePath("/channels/connectors");
  redirect(appendQueryParams(returnTo, { status: "amazon-configured" }));
}

export async function reconnectConnectorAction(formData: FormData) {
  const installationId = String(formData.get("installationId") ?? "").trim();
  if (!installationId) {
    throw new Error("Connector installation id is required.");
  }

  await postJsonForAction(formData, `/connectors/${encodeURIComponent(installationId)}/reconnect`, {});
  revalidatePath("/channels/connectors");
  revalidatePath("/channels");
  redirect("/channels/connectors?status=reconnected");
}

export async function updateConnectorPublicationTargetsAction(formData: FormData) {
  const installationId = String(formData.get("installationId") ?? "").trim();
  const returnTo = String(formData.get("returnTo") ?? "").trim()
    || `/channels/connectors/${encodeURIComponent(installationId)}`;
  const publicationIds = formData
    .getAll("publicationId")
    .map((value) => String(value ?? "").trim())
    .filter(Boolean);
  if (!installationId) {
    throw new Error("Connector installation id is required.");
  }

  try {
    await postJsonForAction(formData, `/connectors/${encodeURIComponent(installationId)}/publication-targets`, {
      publicationIds,
    });
  } catch (error: unknown) {
    rethrowRedirectError(error);
    let status = "publication-targets-error";
    if (error instanceof ApiHttpError && error.body && typeof error.body === "object") {
      const payload = error.body as Record<string, unknown>;
      const code = String(payload.error ?? "").trim();
      if (code === "PUBLICATION_TARGET_REQUIRED") {
        status = "publication-targets-required";
      } else if (code === "PUBLICATION_TARGET_INVALID") {
        status = "publication-targets-invalid";
      } else if (code === "CONNECTOR_PUBLICATIONS_UNSUPPORTED") {
        status = "publication-targets-unsupported";
      }
    }
    redirect(appendQueryParams(returnTo, { status }));
  }

  revalidatePath("/channels/connectors");
  revalidatePath(returnTo);
  redirect(appendQueryParams(returnTo, { status: "publication-targets-saved" }));
}

export async function uninstallConnectorAction(formData: FormData) {
  const installationId = String(formData.get("installationId") ?? "").trim();
  if (!installationId) {
    throw new Error("Connector installation id is required.");
  }

  await postJsonForAction(formData, `/connectors/${encodeURIComponent(installationId)}/uninstall`, {});
  revalidatePath("/channels/connectors");
  revalidatePath("/channels");
  revalidatePath("/dashboard");
  redirect("/channels/connectors?status=disabled");
}

export async function deleteConnectorInstallationAction(formData: FormData) {
  const installationId = String(formData.get("installationId") ?? "").trim();
  const connectorSlug = String(formData.get("connectorSlug") ?? "").trim().toLowerCase();
  const confirmDelete = String(formData.get("confirmDelete") ?? "").trim().toLowerCase();
  if (!installationId) {
    throw new Error("Connector installation id is required.");
  }
  if (!connectorSlug) {
    throw new Error("Connector slug is required.");
  }
  if (confirmDelete !== "yes") {
    throw new Error("Confirm permanent delete before proceeding.");
  }

  await deleteJsonForAction(
    formData,
    `/connectors/${encodeURIComponent(connectorSlug)}/install/${encodeURIComponent(installationId)}`,
  );
  revalidatePath("/channels/connectors");
  revalidatePath("/channels");
  revalidatePath("/dashboard");
  redirect("/channels/connectors?status=deleted");
}

export async function grantConnectorPermissionAction(formData: FormData) {
  const connectorSlug = String(formData.get("connectorSlug") ?? "").trim().toLowerCase();
  const principalType = String(formData.get("principalType") ?? "").trim().toLowerCase();
  const principalId = String(formData.get("principalId") ?? "").trim();
  const action = String(formData.get("action") ?? "").trim().toLowerCase();
  const accountAlias = String(formData.get("accountAlias") ?? "").trim();

  if (!connectorSlug) {
    throw new Error("Connector slug is required.");
  }
  if (!principalId) {
    throw new Error(principalType === "user" ? "User ID is required." : "Role is required.");
  }
  if (!["user", "role"].includes(principalType)) {
    throw new Error("Principal type must be user or role.");
  }
  if (principalType === "role" && !CONNECTOR_PERMISSION_ROLE_IDS.has(principalId.toLowerCase())) {
    throw new Error("Role must be one of: admin, editor, reviewer, viewer.");
  }
  if (!["install", "reconnect", "uninstall"].includes(action)) {
    throw new Error("Action must be install, reconnect, or uninstall.");
  }

  try {
    await postJsonForAction(formData, "/connectors/permissions", {
      connectorSlug,
      principalType,
      principalId,
      action,
      accountAlias: accountAlias || undefined,
    });
  } catch (error: unknown) {
    const status = resolveConnectorPermissionGrantStatus(error);
    if (status) {
      redirect(`/admin/connectors?status=${status}`);
    }
    throw error;
  }
  revalidatePath("/admin/connectors");
  revalidatePath("/channels/connectors");
  redirect("/admin/connectors?status=permission-granted");
}

export async function revokeConnectorPermissionAction(formData: FormData) {
  const permissionId = String(formData.get("permissionId") ?? "").trim();
  if (!permissionId) {
    throw new Error("Permission id is required.");
  }
  await deleteJsonForAction(formData, `/connectors/permissions/${permissionId}`);
  revalidatePath("/admin/connectors");
  revalidatePath("/channels/connectors");
  redirect("/admin/connectors?status=permission-revoked");
}

export async function createExportJobAction(formData: FormData) {
  const productId = String(formData.get("productId") ?? "").trim();
  const channel = String(formData.get("channel") ?? "").trim();
  const templateId = String(formData.get("templateId") ?? "").trim();
  const installationId = String(formData.get("installationId") ?? "").trim();
  const maxRetries = parseNumber(formData.get("maxRetries"));
  const fallbackAcknowledged = String(formData.get("fallbackAcknowledged") ?? "").trim() === "true";
  if (!productId || !channel) {
    throw new Error("Product and channel are required for export.");
  }
  if (isMarketplaceChannel(channel) && isChannelInDevelopment(channel)) {
    // Defense in depth: reject in-development channels at the server-action boundary so
    // we never enqueue an export the connector cannot fulfill.
    // Source of truth: apps/web/src/lib/marketplace-channels.ts IN_DEVELOPMENT_CHANNELS.
    throw new Error(IN_DEVELOPMENT_CHANNEL_NOTICE);
  }
  try {
    await postJsonForAction(formData, `/marketplace/products/${productId}/export-jobs`, {
      channel,
      templateId: templateId || undefined,
      installationId: installationId || undefined,
      maxRetries,
      fallbackAcknowledged,
    });
  } catch (error: unknown) {
    const redirectPath = withPlanLimitQuery(`/products/${encodeURIComponent(productId)}`, error);
    if (redirectPath) {
      redirect(redirectPath);
    }
    throw error;
  }
  revalidatePath(`/products/${productId}`);
  redirect(
    replaceQueryParams(`/products/${encodeURIComponent(productId)}`, {
      tab: "channels",
      channel,
      updateStatus: "export-queued",
    }),
  );
}

export async function createConnectorMappingVersionAction(formData: FormData) {
  const connectorSlug = String(formData.get("connectorSlug") ?? "").trim().toLowerCase();
  const categoryScope = String(formData.get("categoryScope") ?? "").trim();
  const mappingLevel = String(formData.get("mappingLevel") ?? "").trim();
  const connectorDefinitionId = String(formData.get("connectorDefinitionId") ?? "").trim();
  const connectorDefinitionVersion = String(formData.get("connectorDefinitionVersion") ?? "").trim();
  const compatibilityState = String(formData.get("compatibilityState") ?? "").trim();
  if (!connectorSlug || !categoryScope || !mappingLevel || !connectorDefinitionId || !connectorDefinitionVersion) {
    throw new Error("Connector slug, category scope, mapping level and connector definition are required.");
  }

  const mappingRulesRaw = String(formData.get("mappingRules") ?? "").trim();
  const fallbackPolicyRaw = String(formData.get("fallbackPolicy") ?? "").trim();
  const mappingRules = mappingRulesRaw
    ? parseJsonObject(formData.get("mappingRules"), "Mapping rules")
    : parseStructuredConnectorMappingRules(formData, categoryScope);
  const fallbackPolicy = fallbackPolicyRaw
    ? parseJsonObject(formData.get("fallbackPolicy"), "Fallback policy")
    : parseStructuredConnectorFallbackPolicy(formData);
  const fallbackAckRequired = String(formData.get("fallbackAckRequired") ?? "").trim() === "true";
  const redirectTo = String(formData.get("redirectTo") ?? "").trim() || "/channels/mappings";

  await postJsonForAction(formData, `/marketplace/connectors/${encodeURIComponent(connectorSlug)}/mappings/versions`, {
    categoryScope,
    mappingLevel,
    connectorDefinitionId,
    connectorDefinitionVersion,
    compatibilityState: compatibilityState || undefined,
    mappingRules,
    fallbackPolicy,
    fallbackAckRequired,
  });
  revalidatePath("/channels/mappings");
  redirect(redirectTo);
}

export async function validateConnectorMappingVersionAction(formData: FormData) {
  const connectorSlug = String(formData.get("connectorSlug") ?? "").trim().toLowerCase();
  const versionId = String(formData.get("versionId") ?? "").trim();
  const redirectTo = String(formData.get("redirectTo") ?? "").trim() || "/channels/mappings";
  if (!connectorSlug || !versionId) {
    throw new Error("Connector slug and version id are required.");
  }
  await postJsonForAction(
    formData,
    `/marketplace/connectors/${encodeURIComponent(connectorSlug)}/mappings/versions/${encodeURIComponent(versionId)}/validate`,
    {},
  );
  revalidatePath("/channels/mappings");
  redirect(redirectTo);
}

export async function setMappingFallbackAcknowledgementAction(formData: FormData) {
  const redirectTo = String(formData.get("redirectTo") ?? "").trim() || "/channels/mappings";
  const versionId = String(formData.get("versionId") ?? "").trim();
  const acknowledged = String(formData.get("fallbackAcknowledged") ?? "").trim() === "true";
  redirect(
    replaceQueryParams(redirectTo, {
      fallbackAcknowledged: acknowledged ? "true" : null,
      fallbackAckVersionId: acknowledged ? versionId : null,
      fallbackAckError: null,
    }),
  );
}

export async function publishConnectorMappingVersionAction(formData: FormData) {
  const connectorSlug = String(formData.get("connectorSlug") ?? "").trim().toLowerCase();
  const versionId = String(formData.get("versionId") ?? "").trim();
  const redirectTo = String(formData.get("redirectTo") ?? "").trim() || "/channels/mappings";
  const confirm = String(formData.get("confirm") ?? "").trim() === "true";
  const fallbackAckRequired = String(formData.get("fallbackAckRequired") ?? "").trim() === "true";
  const fallbackAcknowledged = String(formData.get("fallbackAcknowledged") ?? "").trim() === "true";
  if (!connectorSlug || !versionId || !confirm) {
    throw new Error("Connector slug, version id, and explicit confirmation are required.");
  }
  if (fallbackAckRequired && !fallbackAcknowledged) {
    redirect(
      replaceQueryParams(redirectTo, {
        fallbackAckError: "required",
        fallbackAckVersionId: versionId,
        fallbackAcknowledged: null,
      }),
    );
  }
  try {
    const stepUpToken = await issueMappingStepUpToken(formData);
    await postJsonForAction(
      formData,
      `/marketplace/connectors/${encodeURIComponent(connectorSlug)}/mappings/versions/${encodeURIComponent(versionId)}/publish`,
      { confirm: true },
      { headers: { [STEP_UP_TOKEN_HEADER]: stepUpToken } },
    );
  } catch (error: unknown) {
    const redirectPath = withStepUpErrorQuery(redirectTo, "publish", versionId, error);
    if (redirectPath) {
      redirect(redirectPath);
    }
    throw error;
  }
  revalidatePath("/channels/mappings");
  redirect(redirectTo);
}

export async function archiveConnectorMappingVersionAction(formData: FormData) {
  const connectorSlug = String(formData.get("connectorSlug") ?? "").trim().toLowerCase();
  const versionId = String(formData.get("versionId") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const redirectTo = String(formData.get("redirectTo") ?? "").trim() || "/channels/mappings";
  if (!connectorSlug || !versionId || !reason) {
    throw new Error("Connector slug, version id, and archive reason are required.");
  }
  try {
    const stepUpToken = await issueMappingStepUpToken(formData);
    await postJsonForAction(
      formData,
      `/marketplace/connectors/${encodeURIComponent(connectorSlug)}/mappings/versions/${encodeURIComponent(versionId)}/archive`,
      { reason },
      { headers: { [STEP_UP_TOKEN_HEADER]: stepUpToken } },
    );
  } catch (error: unknown) {
    const redirectPath = withStepUpErrorQuery(redirectTo, "archive", versionId, error);
    if (redirectPath) {
      redirect(redirectPath);
    }
    throw error;
  }
  revalidatePath("/channels/mappings");
  redirect(redirectTo);
}

export async function rollbackConnectorMappingVersionAction(formData: FormData) {
  const connectorSlug = String(formData.get("connectorSlug") ?? "").trim().toLowerCase();
  const versionId = String(formData.get("versionId") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const redirectTo = String(formData.get("redirectTo") ?? "").trim() || "/channels/mappings";
  const confirm = String(formData.get("confirm") ?? "").trim() === "true";
  if (!connectorSlug || !versionId || !reason || !confirm) {
    throw new Error("Connector slug, version id, rollback reason, and confirmation are required.");
  }
  try {
    const stepUpToken = await issueMappingStepUpToken(formData);
    await rollbackConnectorMappingVersion(
      connectorSlug,
      versionId,
      { confirm: true, reason },
      {
        ...(await resolveActionOptions(formData)),
        headers: { [STEP_UP_TOKEN_HEADER]: stepUpToken },
      },
    );
  } catch (error: unknown) {
    const redirectPath = withStepUpErrorQuery(redirectTo, "rollback", versionId, error);
    if (redirectPath) {
      redirect(redirectPath);
    }
    throw error;
  }
  revalidatePath("/channels/mappings");
  redirect(redirectTo);
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

export async function retrySubmissionAction(formData: FormData) {
  const submissionId = String(formData.get("submissionId") ?? "").trim();
  if (!submissionId) {
    throw new Error("Submission id is required.");
  }

  await postJsonForAction(formData, `/submissions/${submissionId}/retry`, {});
  revalidatePath("/operations/jobs");
  revalidatePath("/dashboard");

  const jobsParams = new URLSearchParams();
  jobsParams.set("submissionId", submissionId);
  const keepToJobs = (targetKey: string, formKey: string) => {
    const value = String(formData.get(formKey) ?? "").trim();
    if (value) {
      jobsParams.set(targetKey, value);
    }
  };
  keepToJobs("connectorSlug", "submissionConnector");
  keepToJobs("status", "submissionStatus");
  redirect(`/operations/jobs?${jobsParams.toString()}`);
}

async function uploadBulkImportRun(formData: FormData, categoryId: string, sourceFormat: string, sourceName: string, csvContent: string, fileContentBase64: string | undefined, rows: Record<string, unknown>[] | undefined, mapping: Record<string, unknown>, chunkSize: number | undefined, maxRetries: number | undefined): Promise<{ id: string; status: string }> {
  return postJsonForAction<{ id: string; status: string }>(formData, "/bulk-import/runs", {
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
}

async function validateBulkImportRun(formData: FormData, runId: string): Promise<{ id: string; status: string }> {
  return postJsonForAction<{ id: string; status: string }>(formData, `/bulk-import/runs/${encodeURIComponent(runId)}/validate`, {});
}

async function startBulkImportRun(formData: FormData, runId: string): Promise<void> {
  await postJsonForAction(formData, `/bulk-import/runs/${encodeURIComponent(runId)}/start`, {});
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
      throw new Error("Uploaded file must be .csv or .json. Spreadsheet imports are temporarily disabled.");
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
  } else {
    throw new Error("Source format must be csv or json.");
  }

  // Stage and validate the bulk import run before deciding standard vs large mode
  const stagedRun = await uploadBulkImportRun(formData, categoryId, sourceFormat, sourceName, csvContent, fileContentBase64, rows, mapping, chunkSize, maxRetries);
  const linkedRunId = stagedRun.id;
  const validatedRun = await validateBulkImportRun(formData, linkedRunId);

  // Large import runs start only after validation
  if (validatedRun.status === "large") {
    await startBulkImportRun(formData, linkedRunId);
    revalidatePath("/operations/imports");
    redirect(`/operations/imports?bulkRunId=${encodeURIComponent(validatedRun.id)}`);
  }

  // CSV imports must stop when pre-validation is not ready
  if (validatedRun.status !== "preflight_ready") {
    throw new Error(`Bulk import preflight did not pass validation. Status: ${validatedRun.status}`);
  }

  const createdJob = await postJsonForAction<{ id: string }>(formData, "/bulk-import/jobs", {
    categoryId,
    runId: linkedRunId,
    sourceFormat,
    sourceName: sourceName || undefined,
    csvContent: sourceFormat === "csv" ? csvContent : undefined,
    fileContentBase64,
    rows: sourceFormat === "json" ? rows : undefined,
    mapping,
    chunkSize,
    maxRetries,
  });
  try {
    await postJsonForAction(formData, `/bulk-import/jobs/${createdJob.id}/process`, {
      chunkSize,
    });
  } catch {
    // If inline processing fails the job stays queued; redirect so the user can start it manually.
  }
  redirect(`/operations/imports?bulkJobId=${encodeURIComponent(createdJob.id)}`);
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
  if (!["csv", "json"].includes(sourceFormat)) {
    throw new Error("Template source format must be csv or json.");
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
  revalidatePath("/operations/imports");
}

export async function processBulkImportJobAction(formData: FormData) {
  const jobId = String(formData.get("jobId") ?? "").trim();
  const chunkSize = parseNumber(formData.get("chunkSize"));
  if (!jobId) {
    throw new Error("Bulk import job id is required.");
  }
  const returnTo = resolveReturnToPath(
    formData,
    `/operations/imports?bulkJobId=${encodeURIComponent(jobId)}`,
  );
  try {
    await postJsonForAction(formData, `/bulk-import/jobs/${jobId}/process`, {
      chunkSize,
    });
  } catch {
    // Process call can time out under Railway's 30 s limit while the API continues
    // processing in the background. The job moves to processing/done on its own;
    // redirect so the user can poll the status rather than seeing an error boundary.
  }
  revalidatePath("/operations/imports");
  revalidatePath("/dashboard");
  redirect(returnTo);
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
  revalidatePath("/operations/imports");
  revalidatePath("/dashboard");
}

export async function processBulkImportRowAction(formData: FormData) {
  const jobId = String(formData.get("jobId") ?? "").trim();
  const rowId = String(formData.get("rowId") ?? "").trim();
  if (!jobId || !rowId) {
    throw new Error("Bulk import job id and row id are required.");
  }
  await postJsonForAction(formData, `/bulk-import/jobs/${jobId}/rows/${rowId}/process`, {});
  revalidatePath("/operations/imports");
  revalidatePath("/dashboard");
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
  revalidatePath("/operations/repair");
  revalidatePath("/operations/imports");
  revalidatePath("/dashboard");
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
    ...(await resolveActionOptions(formData)),
  });
  revalidatePath("/catalog/products");
  revalidatePath("/operations/bulk-edit");
}

export async function uploadMediaAssetAction(formData: FormData) {
  const productId = String(formData.get("productId") ?? "").trim();
  const variantId = String(formData.get("variantId") ?? "").trim();
  const altText = String(formData.get("altText") ?? "").trim();
  const isMain = String(formData.get("isMain") ?? "false") === "true";
  const sortOrder = parseNumber(formData.get("sortOrder"));
  const channelEligibility = formData
    .getAll("channelEligibility")
    .map((value) => String(value ?? "").trim())
    .filter((value) => value.length > 0);
  const fileEntry = formData.get("sourceFile");
  const width = parseNumber(formData.get("width"));
  const height = parseNumber(formData.get("height"));
  if (!(fileEntry instanceof File) || fileEntry.size === 0) {
    throw new Error("Select an image file to upload.");
  }

  const fileName = fileEntry.name || "media.bin";
  const mimeType = fileEntry.type || "application/octet-stream";
  if (!mimeType.startsWith("image/")) {
    redirect(
      `/media?productId=${encodeURIComponent(productId)}&variantId=${encodeURIComponent(variantId)}&uploadError=invalid-file-type`,
    );
  }
  const contentBase64 = Buffer.from(await fileEntry.arrayBuffer()).toString("base64");

  try {
    await postJsonForAction(formData, "/media/assets", {
      productId: productId || undefined,
      variantId: variantId || undefined,
      fileName,
      mimeType,
      contentBase64,
      width,
      height,
      altText: altText || undefined,
      isMain,
      sortOrder,
      channelEligibility,
    });
  } catch (error: unknown) {
    const redirectPath = withPlanLimitQuery(
      `/media?productId=${encodeURIComponent(productId)}&variantId=${encodeURIComponent(variantId)}`,
      error,
    );
    if (redirectPath) {
      redirect(redirectPath);
    }
    throw error;
  }

  revalidatePath("/media");
  redirect(`/media?productId=${encodeURIComponent(productId)}&variantId=${encodeURIComponent(variantId)}`);
}

export async function updateMediaGovernanceAction(formData: FormData) {
  const assetId = String(formData.get("assetId") ?? "").trim();
  const productId = String(formData.get("productId") ?? "").trim();
  const variantId = String(formData.get("variantId") ?? "").trim();
  const assetFilterId = String(formData.get("assetFilterId") ?? "").trim();
  const channel = String(formData.get("channel") ?? "").trim();
  const altText = String(formData.get("altText") ?? "").trim();
  const isMain = String(formData.get("isMain") ?? "false") === "true";
  const sortOrder = parseNumber(formData.get("sortOrder"));
  const channelEligibility = formData
    .getAll("channelEligibility")
    .map((value) => String(value ?? "").trim())
    .filter((value) => value.length > 0);
  if (!assetId) {
    throw new Error("Media asset id is required.");
  }

  await patchJsonForAction(formData, `/media/assets/${encodeURIComponent(assetId)}/governance`, {
    altText: altText || null,
    isMain,
    sortOrder,
    channelEligibility,
  });

  revalidatePath("/media");
  redirect(
    appendQueryParams("/media", {
      productId,
      variantId,
      assetId: assetFilterId,
      channel,
    }),
  );
}

export async function bulkAssociateMediaCsvAction(formData: FormData) {
  const csvContent = String(formData.get("csvContent") ?? "").trim();
  if (!csvContent) {
    throw new Error("CSV content is required.");
  }

  await postJsonForAction(formData, "/media/bulk-associations", {
    csvContent,
  });

  revalidatePath("/media");
  redirect("/media?bulkAssociationStatus=done");
}

export async function createOndcMappingAction(formData: FormData) {
  const categoryId = String(formData.get("categoryId") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();
  const nodeType = String(formData.get("nodeType") ?? "").trim();
  const version = String(formData.get("version") ?? "").trim();
  if (!categoryId || !name || !nodeType || !version) {
    throw new Error("Category, name, node type, and version are required.");
  }

  const requiredFields = parseJsonArray(formData.get("requiredFields"), "Required fields");
  const fieldMapRaw = parseJsonObject(formData.get("fieldMap"), "Field map");
  const discoveryMetadata = parseJsonObject(formData.get("discoveryMetadata"), "Discovery metadata");
  const isDefault = String(formData.get("isDefault") ?? "false") === "true";

  const fieldMap: Record<string, string> = {};
  for (const [key, value] of Object.entries(fieldMapRaw)) {
    const source = String(key ?? "").trim();
    const target = String(value ?? "").trim();
    if (source && target) {
      fieldMap[source] = target;
    }
  }

  await postJsonForAction(formData, "/ondc/mappings", {
    name,
    categoryId,
    nodeType,
    version,
    requiredFields,
    fieldMap,
    discoveryMetadata,
    isDefault,
  });

  revalidatePath("/ondc");
  redirect(
    `/ondc?categoryId=${encodeURIComponent(categoryId)}&version=${encodeURIComponent(version)}&nodeType=${encodeURIComponent(nodeType)}`,
  );
}

export async function runOndcSimulationAction(formData: FormData) {
  const productId = String(formData.get("productId") ?? "").trim();
  const version = String(formData.get("version") ?? "").trim();
  const nodeType = String(formData.get("nodeType") ?? "").trim();
  const mappingId = String(formData.get("mappingId") ?? "").trim();
  if (!productId || !version || !nodeType) {
    throw new Error("Product, version, and node type are required.");
  }

  const simulation = await postJsonForAction<{ mappingId: string }>(
    formData,
    `/ondc/products/${productId}/simulate`,
    {
      version,
      nodeType,
      mappingId: mappingId || undefined,
    },
  );

  revalidatePath("/ondc");
  redirect(
    `/ondc?productId=${encodeURIComponent(productId)}&version=${encodeURIComponent(version)}&nodeType=${encodeURIComponent(nodeType)}&mappingId=${encodeURIComponent(simulation.mappingId)}`,
  );
}

export async function applyAiRepairAction(formData: FormData) {
  const productId = String(formData.get("productId") ?? "").trim();
  if (!productId) {
    throw new Error("Product id is required.");
  }

  await postJsonForAction(formData, `/auto-suggestions/products/${productId}/repair`, {
    apply: true,
  });
  revalidatePath("/ai");
  revalidatePath(`/products/${productId}`);
  redirect(`/ai?productId=${encodeURIComponent(productId)}&repairStatus=applied`);
}

export async function retryConnectorRecoveryGroupAction(
  installationId: string,
  errorFamily: string,
): Promise<{ queued: number }> {
  const authHeader = await getServerAuthHeader();
  const tenantKey = process.env.PIM_DEFAULT_TENANT_KEY || "default";
  const options: ApiRequestOptions = {
    authHeader,
    role: "admin",
    tenantKey,
  };
  const result = await postJson<{ queued: number }>(
    `/marketplace/connectors/shopify/${encodeURIComponent(installationId)}/recovery/retry-group`,
    { errorFamily },
    options,
  );
  revalidatePath(`/channels/connectors/${encodeURIComponent(installationId)}/recovery`);
  return result;
}



export async function importShopifyConfigAction(
  installationId: string,
): Promise<{ metafields: number; collections: number; taxonomy: number; fetchedAt: string }> {
  const authHeader = await getServerAuthHeader();
  const tenantKey = process.env.PIM_DEFAULT_TENANT_KEY || "default";
  const options: ApiRequestOptions = {
    authHeader,
    role: "admin",
    tenantKey,
  };
  const result = await postJson<{ metafields: unknown[]; collections: unknown[]; taxonomy: unknown[]; fetchedAt: string }>(
    `/marketplace/connectors/shopify/${encodeURIComponent(installationId)}/shopify-config/import`,
    {},
    options,
  );
  revalidatePath(`/channels/connectors/${encodeURIComponent(installationId)}`);
  return {
    metafields: Array.isArray(result.metafields) ? result.metafields.length : 0,
    collections: Array.isArray(result.collections) ? result.collections.length : 0,
    taxonomy: Array.isArray(result.taxonomy) ? result.taxonomy.length : 0,
    fetchedAt: result.fetchedAt,
  };
}

// ─── Sprint G: Generic connector sync + schedule actions ────────────────────

export async function queueConnectorDeltaSyncAction(formData: FormData) {
  const installationId = String(formData.get("installationId") ?? "").trim();
  const returnTo =
    String(formData.get("returnTo") ?? "").trim() ||
    `/channels/connectors/${encodeURIComponent(installationId)}?tab=sync`;
  if (!installationId) {
    throw new Error("Installation ID is required.");
  }
  try {
    await postJsonForAction(formData, `/marketplace/connectors/${encodeURIComponent(installationId)}/sync/delta`, {});
  } catch (error: unknown) {
    rethrowRedirectError(error);
    redirect(appendQueryParams(returnTo, { status: "delta-sync-error" }));
  }
  revalidatePath(`/channels/connectors/${installationId}`);
  redirect(appendQueryParams(returnTo, { status: "delta-sync-queued" }));
}

export async function upsertConnectorSyncScheduleAction(formData: FormData) {
  const installationId = String(formData.get("installationId") ?? "").trim();
  const cronExpression = String(formData.get("cronExpression") ?? "").trim();
  const scope = String(formData.get("scope") ?? "approved_only").trim();
  const returnTo =
    String(formData.get("returnTo") ?? "").trim() ||
    `/channels/connectors/${encodeURIComponent(installationId)}?tab=schedule`;
  if (!installationId) {
    throw new Error("Installation ID is required.");
  }
  if (!cronExpression) {
    throw new Error("Cron expression is required.");
  }
  try {
    await postJsonForAction(formData, `/marketplace/connectors/${encodeURIComponent(installationId)}/schedule`, {
      cronExpression,
      scope,
      status: "active",
    });
  } catch (error: unknown) {
    rethrowRedirectError(error);
    redirect(appendQueryParams(returnTo, { status: "schedule-error" }));
  }
  revalidatePath(`/channels/connectors/${installationId}`);
  redirect(appendQueryParams(returnTo, { status: "schedule-saved" }));
}

export async function deleteConnectorSyncScheduleAction(formData: FormData) {
  const installationId = String(formData.get("installationId") ?? "").trim();
  const returnTo =
    String(formData.get("returnTo") ?? "").trim() ||
    `/channels/connectors/${encodeURIComponent(installationId)}?tab=schedule`;
  if (!installationId) {
    throw new Error("Installation ID is required.");
  }
  try {
    await deleteJsonForAction(formData, `/marketplace/connectors/${encodeURIComponent(installationId)}/schedule`);
  } catch (error: unknown) {
    rethrowRedirectError(error);
    redirect(appendQueryParams(returnTo, { status: "schedule-error" }));
  }
  revalidatePath(`/channels/connectors/${installationId}`);
  redirect(appendQueryParams(returnTo, { status: "schedule-deleted" }));
}

export async function triggerBulkPublishAction(formData: FormData) {
  "use server";
  const installationId = String(formData.get("installationId") ?? "").trim();
  const productIdsRaw = String(formData.get("productIds") ?? "").trim();
  const returnTo =
    String(formData.get("returnTo") ?? "").trim() ||
    `/channels/connectors/${encodeURIComponent(installationId)}?tab=sync`;
  if (!installationId) {
    throw new Error("Installation ID is required.");
  }
  const productIds = productIdsRaw
    ? productIdsRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  try {
    await postJsonForAction(
      formData,
      `/marketplace/connectors/${encodeURIComponent(installationId)}/bulk-publish`,
      { productIds },
    );
  } catch (error: unknown) {
    rethrowRedirectError(error);
    redirect(appendQueryParams(returnTo, { status: "bulk-publish-error" }));
  }
  revalidatePath(`/channels/connectors/${installationId}`);
  redirect(appendQueryParams(returnTo, { status: "bulk-publish-queued" }));
}

export async function confirmCatalogLinksAction(
  installationId: string,
  links: Array<{ productId: string; shopifyGid: string; matchedBy: string }>,
): Promise<{ confirmed: number }> {
  "use server";
  const authHeader = await getServerAuthHeader();
  const tenantKey = process.env.PIM_DEFAULT_TENANT_KEY || "default";
  const options: ApiRequestOptions = { authHeader, role: "admin", tenantKey };
  const result = await postJson<{ confirmed: number }>(
    `/marketplace/connectors/shopify/${encodeURIComponent(installationId)}/catalog-link/confirm`,
    { links },
    options,
  );
  revalidatePath(`/channels/connectors/${encodeURIComponent(installationId)}/catalog-link`);
  return result;
}
