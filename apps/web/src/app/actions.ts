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
  getJson,
  getProduct,
  getProductVariants,
  getPlanLimitExceededPayload,
  issueStepUp,
  patchJson,
  postJson,
  rollbackConnectorMappingVersion,
} from "@/lib/api";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerSession } from "@/lib/server-session";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import {
  IN_DEVELOPMENT_CHANNEL_NOTICE,
  isChannelInDevelopment,
  isMarketplaceChannel,
} from "@/lib/marketplace-channels";
import { canEditPricing, canManageConnectors, canPublishToChannels } from "@/lib/role-capabilities";
import { extractErrorCode } from "@/lib/errors";

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

/** International (non-India) market rows that can be edited in the content-tab form. */
const INTL_TAX_CODE_ROWS = [
  { market: "GB", key: "COMMODITY_CODE" },
  { market: "AE", key: "HS_CODE" },
  { market: "US", key: "TAX_CATEGORY" },
  { market: "AU", key: "COMMODITY_CODE" },
] as const;

/**
 * Build the `taxCodes` array for a product PATCH from FormData.
 * Combines the India flat-field entry (from hsnCode/gstRate inputs) with the
 * international market rows (taxCode_{MARKET}_{KEY}_value inputs).
 * Returns undefined when the form carries no tax data at all (preserves existing rows).
 */
function parseTaxCodes(
  formData: FormData,
): Array<{ regimeKey: string; key: string; value: string; rate?: number }> | undefined {
  const entries: Array<{ regimeKey: string; key: string; value: string; rate?: number }> = [];

  // India — from flat hsnCode / gstRate fields
  const hsnCodeVal = String(formData.get("hsnCode") ?? "").trim();
  if (hsnCodeVal) {
    const rate = parseNumber(formData.get("gstRate"));
    entries.push({ regimeKey: "IN", key: "HSN_CODE", value: hsnCodeVal, ...(rate !== undefined ? { rate } : {}) });
  }

  // International markets — from named table inputs
  for (const { market, key } of INTL_TAX_CODE_ROWS) {
    const value = String(formData.get(`taxCode_${market}_${key}_value`) ?? "").trim();
    if (value) {
      const rate = parseNumber(formData.get(`taxCode_${market}_${key}_rate`));
      entries.push({ regimeKey: market, key, value, ...(rate !== undefined ? { rate } : {}) });
    }
  }

  // If the form doesn't include the international tax code inputs at all (e.g. the quality
  // tab's submit-for-review form, or any other partial-update context that doesn't render
  // the international tax section), return undefined so existing ProductTaxCode rows are
  // preserved untouched. The India hsnCode entry is handled independently via the flat
  // Product.hsnCode column — it does NOT govern whether a full-replace is triggered.
  const hasIntlInputs = INTL_TAX_CODE_ROWS.some(
    ({ market, key }) => formData.has(`taxCode_${market}_${key}_value`),
  );
  if (!hasIntlInputs) return undefined;

  return entries;
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

function appendMappingTarget(
  fieldMappings: Record<string, string | string[]>,
  sourceField: string,
  targetField: string,
) {
  const existing = fieldMappings[sourceField];
  if (!existing) {
    fieldMappings[sourceField] = targetField;
    return;
  }
  const targets = Array.isArray(existing) ? existing : [existing];
  if (!targets.includes(targetField)) {
    fieldMappings[sourceField] = [...targets, targetField];
  }
}

function parseStructuredConnectorMappingRules(formData: FormData, categoryScope: string): Record<string, unknown> {
  const fieldMappings: Record<string, string | string[]> = {};
  for (const [key, rawValue] of formData.entries()) {
    if (!key.startsWith("mapTarget::")) {
      continue;
    }
    const targetField = String(key.slice("mapTarget::".length)).trim();
    const sourceField = String(rawValue ?? "").trim();
    if (targetField && sourceField) {
      appendMappingTarget(fieldMappings, sourceField, targetField);
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

function extractApiErrorMessage(error: ApiHttpError): string {
  const body = error.body;
  if (body && typeof body === "object" && !Array.isArray(body)) {
    const obj = body as Record<string, unknown>;
    if (typeof obj.code === "string" && obj.code) {
      const message = typeof obj.message === "string" && obj.message ? obj.message : `Request failed (${error.status}).`;
      return `${obj.code}: ${message}`;
    }
    if (typeof obj.message === "string" && obj.message) {
      return obj.message;
    }
    if (Array.isArray(obj.message) && obj.message.length > 0) {
      return obj.message.map(String).join("; ");
    }
  }
  return `Request failed (${error.status}).`;
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

async function getJsonForAction<T>(formData: FormData, path: string): Promise<T> {
  return getJson<T>(path, await resolveActionOptions(formData));
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

// BUG-AUTH-STALE-SESSION-001: a mutation action's API call can fail with 401
// when the caller's session expired after the page was loaded but before this
// submission (e.g. a stale tab left open past token expiry). Before this,
// every server action either had no 401 handling at all (uncaught -> generic
// error boundary), or - in a few cases - a catch block that swallows or
// misclassifies any error it receives, which would turn a 401 into a false
// "success" redirect or a misleading retry-failure message.
//
// Deliberately mirrors withPlanLimitQuery's exact contract above: pure,
// synchronous, no side effects, never calls redirect() itself. The calling
// action decides whether and how to redirect, exactly like the 402 path
// already does - this only adds a new classification, not a new control-flow
// mechanism. A NEXT_REDIRECT control-flow signal (thrown by an in-flight
// redirect() call elsewhere in the same try block) is not an ApiHttpError
// instance, so this returns null for it and never interferes with the
// existing rethrowRedirectError convention.
function resolveSessionExpiredRedirect(basePath: string, error: unknown): string | null {
  if (!(error instanceof ApiHttpError) || error.status !== 401) {
    return null;
  }
  return buildLoginRedirect(basePath, error);
}

// BUG-AUTH-STALE-SESSION-001 (A1): the action-level primitive every migrated
// catch block calls. Its only responsibility is resolveSessionExpiredRedirect
// + redirect() - it never inspects any other error shape, so it can be
// inserted into a catch block without touching that action's existing
// semantics for 402/403/500/plain errors. Call this AFTER rethrowRedirectError
// (where present) and BEFORE any other error-specific handling in the catch,
// so a session-expiry redirect takes priority over, e.g., building a
// retry-failure message from the same error.
function handleSessionExpired(error: unknown, basePath: string): void {
  const redirectPath = resolveSessionExpiredRedirect(basePath, error);
  if (redirectPath) {
    redirect(redirectPath);
  }
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
    revalidatePath("/dashboard");
    redirect(
      appendQueryParams(returnTo, {
        deleteStatus: "deleted",
        deletedCategory: categoryId,
      }),
    );
  } catch (error: unknown) {
    rethrowRedirectError(error);
    const sessionRedirectPath = resolveSessionExpiredRedirect(returnTo, error);
    if (sessionRedirectPath) {
      if (String(formData.get("__viaTransition") ?? "") === "1") {
        return { sessionExpired: true as const, loginPath: sessionRedirectPath };
      }
      redirect(sessionRedirectPath);
    }
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

  const returnTo = sanitizePath(String(formData.get("returnTo") ?? ""), "/quality/issues");
  redirect(returnTo);
}

function sanitizePath(raw: string, fallback: string): string {
  const trimmed = raw.trim();
  return /^\/(?!\/)/.test(trimmed) ? trimmed : fallback;
}

function resolveReturnToPath(formData: FormData, fallback: string): string {
  return sanitizePath(String(formData.get("returnTo") ?? ""), fallback);
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
    // Structured response body but no `error` code (e.g. the default NestJS
    // {statusCode, message} shape for an unmapped exception) — don't fall
    // through to the raw JSON-stringified body below; treat as unmapped.
    return "install_failed";
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
  const returnTo = /^\/(?!\/)/.test(returnToRaw) ? returnToRaw : "/quality/approvals";

  try {
    await decideProductReviewRequest(
      productId,
      {
        status,
        note: note || undefined,
      },
      await resolveActionOptions(formData),
    );
    revalidatePath(`/products/${productId}`);
    redirect(appendQueryParams(returnTo, { decisionStatus: status }));
  } catch (error: unknown) {
    rethrowRedirectError(error);
    handleSessionExpired(error, returnTo);
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

export async function createProductAction(
  formData: FormData,
): Promise<{ error: string; planLimitExceeded?: true; upgradeUrl?: string } | { productId: string } | undefined> {
  const title = String(formData.get("title") ?? "").trim();
  const categoryId = String(formData.get("categoryId") ?? "").trim();
  if (!title || !categoryId) {
    return { error: "Product title and category are required." };
  }
  const { actorRole } = await getServerSession();
  const pricingAllowed = canEditPricing(actorRole);

  const baseAttributes = parseJsonObject(formData.get("attributes"), "Product attributes");
  const rawMrp = parseNumber(formData.get("mrp"));
  const rawSellingPrice = parseNumber(formData.get("sellingPrice"));

  if (!pricingAllowed && (rawMrp !== undefined || rawSellingPrice !== undefined)) {
    return { error: "You do not have permission to set pricing." };
  }

  const mrp = pricingAllowed ? rawMrp : undefined;
  const sellingPrice = pricingAllowed ? rawSellingPrice : undefined;

  if (mrp !== undefined && mrp < 0) {
    return { error: "MRP cannot be negative." };
  }
  if (sellingPrice !== undefined && sellingPrice < 0) {
    return { error: "Selling Price cannot be negative." };
  }
  if (pricingAllowed && sellingPrice === undefined) {
    return { error: "Selling Price is required." };
  }
  if (mrp !== undefined && sellingPrice !== undefined && sellingPrice > mrp) {
    return { error: "Selling Price cannot exceed MRP." };
  }

  const attributes: Record<string, unknown> = { ...baseAttributes };
  delete attributes.mrp;
  delete attributes.sellingPrice;
  delete attributes.selling_price;

  if (pricingAllowed && sellingPrice !== undefined) {
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
  }

  try {
    const created = await postJsonForAction<{ id: string }>(formData, "/catalog/products", {
      title,
      description: String(formData.get("description") ?? "").trim(),
      brand: String(formData.get("brand") ?? "").trim(),
      categoryId,
      hsnCode: String(formData.get("hsnCode") ?? "").trim() || undefined,
      gstRate: parseNumber(formData.get("gstRate")),
      attributes,
      status: "draft",
    });
    revalidatePath("/catalog/products");
    revalidatePath("/dashboard");
    return { productId: created?.id };
  } catch (error: unknown) {
    const planPayload = getPlanLimitExceededPayload(error);
    if (planPayload) {
      return {
        error: `Plan limit reached: you have ${planPayload.current} of ${planPayload.limit} allowed ${planPayload.resource}.`,
        planLimitExceeded: true,
        upgradeUrl: planPayload.upgrade_url,
      };
    }
    const message =
      error instanceof ApiHttpError
        ? extractApiErrorMessage(error)
        : error instanceof Error
          ? error.message
          : "Unable to create product.";
    return { error: message };
  }
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
  const returnTo = /^\/(?!\/)/.test(returnToRaw) ? returnToRaw : undefined;
  const currentTab = String(formData.get("currentTab") ?? "").trim() || undefined;
  const statusAt = Date.now().toString();

  const taxCodes = parseTaxCodes(formData);
  const rawStatus = String(formData.get("status") ?? "draft");
  const productStatus = ["draft", "in_review", "approved", "rejected", "active", "archived"].includes(rawStatus)
    ? rawStatus
    : "draft";

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
      status: productStatus,
      ...(taxCodes !== undefined ? { taxCodes } : {}),
    });
    revalidatePath(`/products/${productId}`);
    redirect(
      appendQueryParams(basePath, {
        tab: currentTab,
        returnTo,
        updateStatus: "updated",
        statusAt,
      }),
    );
  } catch (error: unknown) {
    rethrowRedirectError(error);
    handleSessionExpired(error, basePath);
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
        errorMessage: error instanceof ApiHttpError ? extractApiErrorMessage(error) : undefined,
      }),
    );
  }
}

export async function revertProductToDraftAction(formData: FormData) {
  const productId = String(formData.get("productId") ?? "").trim();
  const expectedVersion = parseNumber(formData.get("expectedVersion"));
  if (!productId || !expectedVersion) {
    throw new Error("Product id and expected version are required.");
  }
  const note = String(formData.get("statusChangeNote") ?? "").trim();
  const basePath = `/products/${encodeURIComponent(productId)}`;

  try {
    await patchJsonForAction(formData, `/catalog/products/${productId}`, {
      expectedVersion,
      status: "draft",
      ...(note ? { statusChangeNote: note } : {}),
    });
    revalidatePath(basePath);
    redirect(appendQueryParams(basePath, { tab: "quality", updateStatus: "reverted-to-draft" }));
  } catch (error: unknown) {
    rethrowRedirectError(error);
    handleSessionExpired(error, basePath);
    const errorMessage =
      error instanceof ApiHttpError
        ? extractApiErrorMessage(error)
        : error instanceof Error
          ? error.message
          : undefined;
    redirect(appendQueryParams(basePath, { tab: "quality", updateStatus: "error", errorMessage }));
  }
}

// Archive/Restore both go through this single action (status carried as a hidden
// form field), mirroring decideProductReviewAction's approve/reject shape rather
// than duplicating the try/catch/redirect boilerplate per direction. This replaces
// the old DELETE-based "Archive product" flow (BUG-ARCHIVE-SOFTDELETE-001): that
// button silently soft-deleted the row (deletedAt) instead of setting status, which
// made archived products globally invisible via the tenant-scope soft-delete filter,
// with no restore path. This PATCHes status instead — deletedAt is never touched, so
// the product stays reachable and can move back to draft afterward.
//
// deleteProductAction (DELETE /catalog/products/:id, true soft-delete) is intentionally
// left in place and untouched by this fix — it's still a legitimate capability, just no
// longer wired to anything labeled "Archive." Nothing in the UI calls it as of this
// change; if/when a real "delete" surface is reintroduced it should stay clearly
// destructive (confirmation, distinct copy) and never share a label with this action.
//
// Concurrency note — the two callers have different staleness guarantees, not just
// different plumbing: the detail-page Archive/Restore controls pass expectedVersion
// from the version actually rendered to the operator (standard optimistic concurrency
// — a stale click 409s). The catalog list's row-level Archive action has no version in
// its list payload, so it fetches the current version immediately before patching —
// meaning it archives whatever the latest version is, not necessarily the version the
// operator was looking at when they clicked. This is a deliberate scope trade-off for
// a coarse status-only action, not an oversight, but it means the list path does NOT
// protect against a stale-view double-archive the way the detail page does. If that
// gap ever matters for this action, the fix is threading `version` through
// ProductListItem rather than adding another special case here.
export async function updateProductStatusAction(formData: FormData) {
  const productId = String(formData.get("productId") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  if (!productId || (status !== "archived" && status !== "draft")) {
    throw new Error("Product id and a valid target status (archived or draft) are required.");
  }
  const note = String(formData.get("statusChangeNote") ?? "").trim();
  const basePath = `/products/${encodeURIComponent(productId)}`;
  // The detail-page controls submit without a returnTo (stay on the product page after
  // archiving/restoring). The catalog list's row-level Archive action passes one so the
  // user stays on the list instead of being navigated to the product's own detail page.
  const returnToRaw = String(formData.get("returnTo") ?? "").trim();
  const returnTo = /^\/(?!\/)/.test(returnToRaw) ? returnToRaw : basePath;

  try {
    // The detail-page Archive/Restore controls already know the product's current
    // version and pass it explicitly. The catalog list's row-level Archive action
    // doesn't carry version in its list payload, so fall back to a fresh fetch —
    // updateProduct()'s optimistic-concurrency check still applies either way.
    const formExpectedVersion = parseNumber(formData.get("expectedVersion"));
    const expectedVersion =
      formExpectedVersion !== undefined
        ? formExpectedVersion
        : (await getProduct(productId, await resolveActionOptions(formData))).version;

    await patchJsonForAction(formData, `/catalog/products/${productId}`, {
      expectedVersion,
      status,
      ...(note ? { statusChangeNote: note } : {}),
    });
    revalidatePath(basePath);
    revalidatePath("/catalog/products");
    redirect(
      appendQueryParams(returnTo, {
        ...(returnTo === basePath ? { tab: "overview" } : {}),
        updateStatus: status === "archived" ? "archived" : "restored",
      }),
    );
  } catch (error: unknown) {
    rethrowRedirectError(error);
    // Mirrors deleteProductAction's BUG-AUTH-STALE-SESSION-001 handling: the catalog
    // list's row-level Archive action invokes this via startTransition rather than a
    // native form submission, so a session-expiry redirect needs to be returned as a
    // value (for the caller to window.location.assign) instead of thrown.
    const sessionRedirectPath = resolveSessionExpiredRedirect(basePath, error);
    if (sessionRedirectPath) {
      if (String(formData.get("__viaTransition") ?? "") === "1") {
        return { sessionExpired: true as const, loginPath: sessionRedirectPath };
      }
      redirect(sessionRedirectPath);
    }
    const errorMessage =
      error instanceof ApiHttpError
        ? extractApiErrorMessage(error)
        : error instanceof Error
          ? error.message
          : undefined;
    redirect(
      appendQueryParams(returnTo, {
        ...(returnTo === basePath ? { tab: "overview" } : {}),
        updateStatus: "error",
        errorMessage,
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
  revalidatePath("/channels/mappings");
}

export async function validateProductAction(formData: FormData) {
  const productId = String(formData.get("productId") ?? "").trim();
  if (!productId) {
    throw new Error("Product id is required.");
  }
  const basePath = `/products/${encodeURIComponent(productId)}`;
  const returnToRaw = String(formData.get("returnTo") ?? "").trim();
  const returnTo = /^\/(?!\/)/.test(returnToRaw) ? returnToRaw : undefined;
  const currentTab = String(formData.get("currentTab") ?? "").trim() || "quality";
  const statusAt = Date.now().toString();

  try {
    await postJsonForAction(formData, `/compliance/products/${productId}/validate`, {});
    revalidatePath(`/products/${productId}`);
    redirect(
      appendQueryParams(basePath, {
        tab: currentTab,
        returnTo,
        updateStatus: "validated",
        statusAt,
      }),
    );
  } catch (error: unknown) {
    rethrowRedirectError(error);
    handleSessionExpired(error, basePath);
    redirect(
      appendQueryParams(basePath, {
        tab: currentTab,
        returnTo,
        updateStatus: "validate-error",
        statusAt,
      }),
    );
  }
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
    const sessionRedirectPath = resolveSessionExpiredRedirect(returnTo, error);
    if (sessionRedirectPath) {
      if (String(formData.get("__viaTransition") ?? "") === "1") {
        return { sessionExpired: true as const, loginPath: sessionRedirectPath };
      }
      redirect(sessionRedirectPath);
    }
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

  const { actorRole } = await getServerSession();
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
    handleSessionExpired(error, returnTo);
    const deleteError = resolveDeleteErrorMessage(error);
    redirect(
      appendQueryParams(returnTo, {
        deleteError,
        deletedId: productId,
      }),
    );
  }
}

/**
 * Shared by createVariantAction/updateVariantAction: maps a caught error to the query params
 * their catch blocks redirect with. Known governance codes pass through as-is (they already
 * have entries in lib/errors.ts ERROR_MAP); anything else runs through extractErrorCode() so a
 * generic backend message like "SKU code already exists" resolves to a real, informative code
 * (e.g. SKU_DUPLICATE) instead of an opaque bucket — and the raw message is always included too,
 * so the UI never has to guess when a code isn't precise enough.
 */
function resolveVariantErrorParams(error: unknown): { error: string; errorMessage?: string } {
  const message = error instanceof Error ? error.message : String(error ?? "");
  if (message.includes("must be valid JSON object")) {
    return { error: "VARIANT_ATTRIBUTES_INVALID", errorMessage: message };
  }
  if (message.includes("WORKFLOW_CONTENT_LOCKED")) {
    return { error: "WORKFLOW_CONTENT_LOCKED" };
  }
  if (message.includes("FIELD_WRITE_RESTRICTED")) {
    return { error: "FIELD_WRITE_RESTRICTED" };
  }
  const rawMessage = error instanceof ApiHttpError ? extractApiErrorMessage(error) : message;
  return { error: extractErrorCode(rawMessage), errorMessage: rawMessage || undefined };
}

export async function createVariantAction(formData: FormData) {
  const productId = String(formData.get("productId") ?? "").trim();
  const skuCode = String(formData.get("skuCode") ?? "").trim();
  if (!productId || !skuCode) {
    throw new Error("Product and SKU are required.");
  }
  const basePath = `/products/${encodeURIComponent(productId)}`;

  try {
    const attributes = parseJsonObject(formData.get("variantAttributes"), "Attributes");
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
    handleSessionExpired(error, basePath);
    redirect(appendQueryParams(basePath, { tab: "variants", ...resolveVariantErrorParams(error) }));
  }
}

export async function updateVariantAction(formData: FormData) {
  const productId = String(formData.get("productId") ?? "").trim();
  const variantId = String(formData.get("variantId") ?? "").trim();
  const skuCode = String(formData.get("skuCode") ?? "").trim();
  if (!productId || !variantId || !skuCode) {
    throw new Error("Product, variant, and SKU are required.");
  }
  const basePath = `/products/${encodeURIComponent(productId)}`;

  try {
    const attributes = parseJsonObject(formData.get("variantAttributes"), "Attributes");
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
    handleSessionExpired(error, basePath);
    redirect(appendQueryParams(basePath, { tab: "variants", ...resolveVariantErrorParams(error) }));
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
  const redirectTo = sanitizePath(String(formData.get("redirectTo") ?? ""), "");

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
    redirect(redirectTo);
  }
}

export async function cloneMappingTemplateAction(formData: FormData) {
  const templateId = String(formData.get("templateId") ?? "").trim();
  if (!templateId) {
    throw new Error("Template id is required.");
  }
  const redirectTo = sanitizePath(String(formData.get("redirectTo") ?? ""), "");
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
    redirect(redirectTo);
  }
}

export async function deleteMappingTemplateAction(formData: FormData) {
  const templateId = String(formData.get("templateId") ?? "").trim();
  if (!templateId) {
    throw new Error("Template id is required.");
  }
  const redirectTo = sanitizePath(String(formData.get("redirectTo") ?? ""), "");

  await deleteJsonForAction(formData, `/marketplace/templates/${templateId}`);
  revalidatePath("/channels/mappings");
  revalidatePath("/catalog/products");
  if (redirectTo) {
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
    handleSessionExpired(error, returnTo);
    const installError = resolveInstallConnectorError(error);
    redirect(
      appendQueryParams(returnTo, {
        installError,
        connectorSlug: slug,
      }),
    );
  }

  revalidatePath("/connectors");
  revalidatePath("/channels");
  revalidatePath("/dashboard");
  redirect(
    appendQueryParams(returnTo, {
      status: "installed",
      connectorSlug: slug,
    }),
  );
}

export async function configureAmazonAction(formData: FormData) {
  const { actorRole } = await getServerSession();
  if (!canManageConnectors(actorRole)) {
    throw new Error("Forbidden: connector management role required.");
  }
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
    handleSessionExpired(error, returnTo);
    throw error;
  }
  revalidatePath("/channels/connectors");
  redirect(appendQueryParams(returnTo, { status: "amazon-configured" }));
}

// Reconnect is a native-form POST to a Route Handler
// (apps/web/src/app/connector-operations/[installationId]/reconnect/route.ts),
// not a Server Action — see that route's doc comment for why (#564: a
// Server Action's redirect() here interacted badly with this app's global
// middleware and silently dropped the outcome query params on every call).

export async function initiateOAuthAction(formData: FormData) {
  const { actorRole } = await getServerSession();
  if (!canManageConnectors(actorRole)) {
    throw new Error("Forbidden: connector management role required.");
  }
  const installationId = String(formData.get("installationId") ?? "").trim();
  if (!installationId) {
    throw new Error("Connector installation id is required.");
  }

  let authorizationUrl: string;
  try {
    const result = await postJsonForAction<{ authorizationUrl: string }>(
      formData,
      `/connectors/${encodeURIComponent(installationId)}/oauth/initiate`,
      {},
    );
    authorizationUrl = result.authorizationUrl;
  } catch (error: unknown) {
    rethrowRedirectError(error);
    handleSessionExpired(error, "/channels/connectors");
    let code = "oauth_initiate_failed";
    if (error instanceof ApiHttpError && error.body && typeof error.body === "object") {
      const payload = error.body as Record<string, unknown>;
      if (String(payload.error ?? "") === "CONNECTOR_OAUTH_NOT_SUPPORTED") {
        code = "oauth_not_supported";
      }
    }
    redirect(appendQueryParams("/channels/connectors", { status: code }));
  }

  redirect(authorizationUrl);
}

export async function updateConnectorPublicationTargetsAction(formData: FormData) {
  const { actorRole } = await getServerSession();
  if (!canManageConnectors(actorRole)) {
    throw new Error("Forbidden: connector management role required.");
  }
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
    handleSessionExpired(error, returnTo);
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
  redirect(appendQueryParams(returnTo, { status: "publication-targets-saved" }));
}

export async function uninstallConnectorAction(formData: FormData) {
  const installationId = String(formData.get("installationId") ?? "").trim();
  if (!installationId) {
    throw new Error("Connector installation id is required.");
  }

  await postJsonForAction(formData, `/connectors/${encodeURIComponent(installationId)}/uninstall`, {});
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
    handleSessionExpired(error, "/admin/connectors");
    const status = resolveConnectorPermissionGrantStatus(error);
    if (status) {
      redirect(`/admin/connectors?status=${status}`);
    }
    throw error;
  }
  revalidatePath("/channels/connectors");
  redirect("/admin/connectors?status=permission-granted");
}

export async function revokeConnectorPermissionAction(formData: FormData) {
  const permissionId = String(formData.get("permissionId") ?? "").trim();
  if (!permissionId) {
    throw new Error("Permission id is required.");
  }
  await deleteJsonForAction(formData, `/connectors/permissions/${permissionId}`);
  revalidatePath("/channels/connectors");
  redirect("/admin/connectors?status=permission-revoked");
}

export async function createExportJobAction(formData: FormData) {
  const productId = String(formData.get("productId") ?? "").trim();
  const channel = String(formData.get("channel") ?? "").trim();
  const templateId = String(formData.get("templateId") ?? "").trim();
  const returnToRaw = String(formData.get("returnTo") ?? "").trim();
  const returnTo = /^\/(?!\/)/.test(returnToRaw) ? returnToRaw : undefined;
  const installationId = String(formData.get("installationId") ?? "").trim();
  const maxRetries = parseNumber(formData.get("maxRetries"));
  const fallbackAcknowledged = String(formData.get("fallbackAcknowledged") ?? "").trim() === "true";
  const statusAt = Date.now().toString();
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
    const sessionRedirectPath = resolveSessionExpiredRedirect(`/products/${encodeURIComponent(productId)}`, error);
    if (sessionRedirectPath) {
      if (String(formData.get("__viaTransition") ?? "") === "1") {
        return { sessionExpired: true as const, loginPath: sessionRedirectPath };
      }
      redirect(sessionRedirectPath);
    }
    const redirectPath = withPlanLimitQuery(`/products/${encodeURIComponent(productId)}`, error);
    if (redirectPath) {
      redirect(redirectPath);
    }
    if (error instanceof ApiHttpError && error.status === 403) {
      redirect(
        replaceQueryParams(`/products/${encodeURIComponent(productId)}`, {
          tab: "channels",
          channel,
          templateId: templateId || null,
          returnTo: returnTo || null,
          updateStatus: "export-forbidden",
          statusAt,
        }),
      );
    }
    throw error;
  }
  revalidatePath(`/products/${productId}`);
  redirect(
    replaceQueryParams(`/products/${encodeURIComponent(productId)}`, {
      tab: "channels",
      channel,
      templateId: templateId || null,
      returnTo: returnTo || null,
      updateStatus: "export-queued",
      statusAt,
      focus: "simulator",
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
  const installationId = String(formData.get("installationId") ?? "").trim();
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
  const redirectTo = sanitizePath(String(formData.get("redirectTo") ?? ""), "/channels/mappings");

  await postJsonForAction(formData, `/marketplace/connectors/${encodeURIComponent(connectorSlug)}/mappings/versions`, {
    categoryScope,
    mappingLevel,
    connectorDefinitionId,
    connectorDefinitionVersion,
    compatibilityState: compatibilityState || undefined,
    mappingRules,
    fallbackPolicy,
    fallbackAckRequired,
    installationId: installationId || undefined,
  });
  redirect(redirectTo);
}

export async function validateConnectorMappingVersionAction(formData: FormData) {
  const connectorSlug = String(formData.get("connectorSlug") ?? "").trim().toLowerCase();
  const versionId = String(formData.get("versionId") ?? "").trim();
  const redirectTo = sanitizePath(String(formData.get("redirectTo") ?? ""), "/channels/mappings");
  if (!connectorSlug || !versionId) {
    throw new Error("Connector slug and version id are required.");
  }
  await postJsonForAction(
    formData,
    `/marketplace/connectors/${encodeURIComponent(connectorSlug)}/mappings/versions/${encodeURIComponent(versionId)}/validate`,
    {},
  );
  redirect(redirectTo);
}

export async function setMappingFallbackAcknowledgementAction(formData: FormData) {
  const redirectTo = sanitizePath(String(formData.get("redirectTo") ?? ""), "/channels/mappings");
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
  const redirectTo = sanitizePath(String(formData.get("redirectTo") ?? ""), "/channels/mappings");
  const confirm = String(formData.get("confirm") ?? "").trim() === "true";
  const fallbackAckRequired = String(formData.get("fallbackAckRequired") ?? "").trim() === "true";
  const fallbackAcknowledged = String(formData.get("fallbackAcknowledged") ?? "").trim() === "true";
  const installationId = String(formData.get("installationId") ?? "").trim();
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
      { confirm: true, installationId: installationId || undefined },
      { headers: { [STEP_UP_TOKEN_HEADER]: stepUpToken } },
    );
  } catch (error: unknown) {
    handleSessionExpired(error, redirectTo);
    const redirectPath = withStepUpErrorQuery(redirectTo, "publish", versionId, error);
    if (redirectPath) {
      redirect(redirectPath);
    }
    throw error;
  }
  redirect(redirectTo);
}

export async function archiveConnectorMappingVersionAction(formData: FormData) {
  const connectorSlug = String(formData.get("connectorSlug") ?? "").trim().toLowerCase();
  const versionId = String(formData.get("versionId") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const redirectTo = sanitizePath(String(formData.get("redirectTo") ?? ""), "/channels/mappings");
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
    handleSessionExpired(error, redirectTo);
    const redirectPath = withStepUpErrorQuery(redirectTo, "archive", versionId, error);
    if (redirectPath) {
      redirect(redirectPath);
    }
    throw error;
  }
  redirect(redirectTo);
}

export async function rollbackConnectorMappingVersionAction(formData: FormData) {
  const connectorSlug = String(formData.get("connectorSlug") ?? "").trim().toLowerCase();
  const versionId = String(formData.get("versionId") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const redirectTo = sanitizePath(String(formData.get("redirectTo") ?? ""), "/channels/mappings");
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
  redirect(redirectTo);
}

export async function processExportJobAction(formData: FormData) {
  const jobId = String(formData.get("jobId") ?? "").trim();
  const productId = String(formData.get("productId") ?? "").trim();
  const channel = String(formData.get("channel") ?? "").trim();
  const templateId = String(formData.get("templateId") ?? "").trim();
  const focus = String(formData.get("focus") ?? "").trim();
  const returnToRaw = String(formData.get("returnTo") ?? "").trim();
  const returnTo = /^\/(?!\/)/.test(returnToRaw) ? returnToRaw : undefined;
  const statusAt = Date.now().toString();
  if (!jobId || !productId) {
    throw new Error("Job id and product id are required.");
  }
  await postJsonForAction(formData, `/marketplace/export-jobs/${jobId}/process`, {});
  revalidatePath(`/products/${productId}`);
  redirect(
    replaceQueryParams(`/products/${encodeURIComponent(productId)}`, {
      tab: "channels",
      channel: channel || null,
      templateId: templateId || null,
      returnTo: returnTo || null,
      focus: focus || null,
      updateStatus: "export-processed",
      statusAt,
    }),
  );
}

export async function requeueExportJobAction(formData: FormData) {
  const jobId = String(formData.get("jobId") ?? "").trim();
  const productId = String(formData.get("productId") ?? "").trim();
  const channel = String(formData.get("channel") ?? "").trim();
  const templateId = String(formData.get("templateId") ?? "").trim();
  const focus = String(formData.get("focus") ?? "").trim();
  const returnToRaw = String(formData.get("returnTo") ?? "").trim();
  const returnTo = /^\/(?!\/)/.test(returnToRaw) ? returnToRaw : undefined;
  const statusAt = Date.now().toString();
  if (!jobId || !productId) {
    throw new Error("Job id and product id are required.");
  }
  await postJsonForAction(formData, `/marketplace/export-jobs/${jobId}/requeue`, {});
  revalidatePath(`/products/${productId}`);
  redirect(
    replaceQueryParams(`/products/${encodeURIComponent(productId)}`, {
      tab: "channels",
      channel: channel || null,
      templateId: templateId || null,
      returnTo: returnTo || null,
      focus: focus || null,
      updateStatus: "export-requeued",
      statusAt,
    }),
  );
}

export async function retrySubmissionAction(formData: FormData) {
  const submissionId = String(formData.get("submissionId") ?? "").trim();
  if (!submissionId) {
    throw new Error("Submission id is required.");
  }

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
  try {
    await postJsonForAction(formData, `/submissions/${submissionId}/retry`, {});
    revalidatePath("/dashboard");
  } catch (error: unknown) {
    handleSessionExpired(error, `/operations/jobs?${jobsParams.toString()}`);
    const rawMessage = error instanceof ApiHttpError
      ? extractApiErrorMessage(error)
      : error instanceof Error ? error.message : "Retry request failed.";
    jobsParams.set("retryError", extractErrorCode(rawMessage));
    jobsParams.set("retryErrorMessage", rawMessage);
  }
  redirect(`/operations/jobs?${jobsParams.toString()}`);
}

/**
 * Same retry as retrySubmissionAction, but for the Submission Log drawer
 * (submissions-grid.tsx), which stays on /channels/submissions and refreshes
 * in place rather than navigating to /operations/jobs. Callable directly from
 * a client component — this is what actually attaches the auth header;
 * calling the API client's retrySubmission() straight from the browser has
 * no session to attach and 401s.
 */
export async function retrySubmissionInlineAction(
  submissionId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const trimmedId = submissionId.trim();
  if (!trimmedId) {
    return { ok: false, error: "Submission id is required." };
  }
  try {
    await postJson(`/submissions/${encodeURIComponent(trimmedId)}/retry`, {}, {
      tenantKey: String(process.env.PIM_DEFAULT_TENANT_KEY ?? "").trim() || "default",
      authHeader: await getServerAuthHeader(),
    });
    revalidatePath("/channels/submissions");
    return { ok: true };
  } catch (error: unknown) {
    const message =
      error instanceof ApiHttpError ? extractApiErrorMessage(error) : error instanceof Error ? error.message : "Retry request failed.";
    return { ok: false, error: message };
  }
}

async function getBulkImportRun(formData: FormData, runId: string): Promise<{ id: string; status: string; effectiveMode: string | null }> {
  return getJsonForAction<{ id: string; status: string; effectiveMode: string | null }>(formData, `/bulk-import/runs/${encodeURIComponent(runId)}`);
}

async function startBulkImportRun(formData: FormData, runId: string): Promise<void> {
  await postJsonForAction(formData, `/bulk-import/runs/${encodeURIComponent(runId)}/start`, {});
}

export async function createBulkImportJobAction(formData: FormData) {
  const categoryId = String(formData.get("categoryId") ?? "").trim();
  let sourceFormat = String(formData.get("sourceFormat") ?? "").trim().toLowerCase();
  let sourceName = String(formData.get("sourceName") ?? "").trim();
  const mapping = parseJsonObject(formData.get("mapping"), "Mapping");
  const chunkSize = parseNumber(formData.get("chunkSize"));
  const maxRetries = parseNumber(formData.get("maxRetries"));

  if (!categoryId) {
    throw new Error("Category is required for bulk import.");
  }

  // The browser wizard must stage the run via the multipart Route Handler before
  // form submission. The Server Action never receives raw file bytes — only metadata.
  const stagedRunId = String(formData.get("stagedRunId") ?? "").trim();
  if (!stagedRunId) {
    throw new Error("Import must be validated before submission. Please validate your file first.");
  }

  const linkedRunId = stagedRunId;
  const validatedRun = await getBulkImportRun(formData, linkedRunId);

  // Large import runs start only after validation
  if (validatedRun.effectiveMode === "large" && validatedRun.status === "preflight_ready") {
    await startBulkImportRun(formData, linkedRunId);
    redirect(`/operations/imports?bulkRunId=${encodeURIComponent(validatedRun.id)}`);
  }

  if (validatedRun.status !== "preflight_ready") {
    throw new Error(`Bulk import preflight did not pass validation. Status: ${validatedRun.status}`);
  }

  // The backend reads rows from the staged CSV when runId is provided
  // and no inline data is sent — no need to retransmit the file.
  const createdJob = await postJsonForAction<{ id: string }>(formData, "/bulk-import/jobs", {
    categoryId,
    runId: linkedRunId,
    sourceFormat: sourceFormat || "csv",
    sourceName: sourceName || undefined,
    mapping,
    chunkSize,
    maxRetries,
  });
  try {
    await postJsonForAction(formData, `/bulk-import/jobs/${createdJob.id}/process`, {
      chunkSize,
    });
  } catch (error: unknown) {
    // BUG-AUTH-STALE-SESSION-001: a session-expiry 401 must never enter this
    // timeout-tolerant swallow - it isn't a background-continuing timeout, and
    // silently falling through to the success redirect below would report a
    // failed authentication as a completed import.
    handleSessionExpired(error, `/operations/imports?bulkJobId=${encodeURIComponent(createdJob.id)}`);
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
  } catch (error: unknown) {
    // BUG-AUTH-STALE-SESSION-001: a session-expiry 401 must never enter this
    // timeout-tolerant swallow - see below for why the swallow itself exists.
    handleSessionExpired(error, returnTo);
    // Process call can time out under Railway's 30 s limit while the API continues
    // processing in the background. The job moves to processing/done on its own;
    // redirect so the user can poll the status rather than seeing an error boundary.
  }
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

export async function retryStuckRunAction(formData: FormData) {
  const runId = String(formData.get("runId") ?? "").trim();
  if (!runId) {
    throw new Error("Bulk import run id is required.");
  }
  try {
    await postJsonForAction(formData, `/bulk-import/runs/${runId}/retry-stuck`, {});
  } catch (error: unknown) {
    // BUG-AUTH-STALE-SESSION-001: a session-expiry 401 must never enter this
    // timeout-tolerant swallow (see processBulkImportJobAction for why the
    // swallow itself exists).
    handleSessionExpired(error, "/operations/imports");
    // Retry can time out while processing continues in the background.
  }
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
  const returnTo = resolveReturnToPath(
    formData,
    `/media?productId=${encodeURIComponent(productId)}&variantId=${encodeURIComponent(variantId)}`,
  );
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
    redirect(appendQueryParams(returnTo, { uploadError: "invalid-file-type" }));
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
    handleSessionExpired(error, returnTo);
    const redirectPath = withPlanLimitQuery(
      returnTo,
      error,
    );
    if (redirectPath) {
      redirect(redirectPath);
    }
    throw error;
  }

  if (productId) {
    revalidatePath(`/products/${productId}`);
  }
  redirect(appendQueryParams(returnTo, { mediaUploadStatus: "uploaded" }));
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
  revalidatePath(`/products/${productId}`);
  redirect(`/ai?productId=${encodeURIComponent(productId)}&repairStatus=applied`);
}

export async function retryConnectorRecoveryGroupAction(
  installationId: string,
  errorFamily: string,
): Promise<{ queued: number }> {
  const { authHeader, actorRole } = await getServerSession();
  if (actorRole !== "admin") {
    throw new Error("Forbidden: admin role required.");
  }
  const tenantKey = process.env.PIM_DEFAULT_TENANT_KEY || "default";
  const options: ApiRequestOptions = {
    authHeader,
    role: actorRole,
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
  const { authHeader, actorRole } = await getServerSession();
  if (actorRole !== "admin") {
    throw new Error("Forbidden: admin role required.");
  }
  const tenantKey = process.env.PIM_DEFAULT_TENANT_KEY || "default";
  const options: ApiRequestOptions = {
    authHeader,
    role: actorRole,
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
  const { actorRole } = await getServerSession();
  if (!canPublishToChannels(actorRole)) {
    throw new Error("Forbidden: publishing role required.");
  }
  const installationId = String(formData.get("installationId") ?? "").trim();
  const returnTo =
    String(formData.get("returnTo") ?? "").trim() ||
    `/channels/connectors/${encodeURIComponent(installationId)}?tab=sync`;
  if (!installationId) {
    throw new Error("Installation ID is required.");
  }
  let result: { queued: number; skipped: number };
  try {
    result = await postJsonForAction<{ queued: number; skipped: number }>(
      formData,
      `/marketplace/connectors/${encodeURIComponent(installationId)}/sync/delta`,
      {},
    );
  } catch (error: unknown) {
    rethrowRedirectError(error);
    handleSessionExpired(error, returnTo);
    redirect(appendQueryParams(returnTo, { status: "delta-sync-error" }));
  }
  revalidatePath(`/channels/connectors/${installationId}`);
  // A 200 response only means the request was accepted, not that anything was queued —
  // every candidate can fail (missing category, expired credentials blocking the
  // connector elsewhere in the flow, etc.) and queueDeltaSync still returns normally
  // with queued: 0. Surface that split instead of a flat "queued" banner that reads as
  // success when nothing was actually handed to a worker.
  if (result.queued === 0 && result.skipped > 0) {
    redirect(
      appendQueryParams(returnTo, {
        status: "delta-sync-none-queued",
        excludedCount: String(result.skipped),
      }),
    );
  }
  redirect(
    appendQueryParams(returnTo, {
      status: "delta-sync-queued",
      queuedCount: String(result.queued),
      excludedCount: String(result.skipped),
    }),
  );
}

export async function upsertConnectorSyncScheduleAction(formData: FormData) {
  const { actorRole } = await getServerSession();
  if (!canManageConnectors(actorRole)) {
    throw new Error("Forbidden: connector management role required.");
  }
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
    handleSessionExpired(error, returnTo);
    redirect(appendQueryParams(returnTo, { status: "schedule-error" }));
  }
  revalidatePath(`/channels/connectors/${installationId}`);
  redirect(appendQueryParams(returnTo, { status: "schedule-saved" }));
}

export async function deleteConnectorSyncScheduleAction(formData: FormData) {
  const { actorRole } = await getServerSession();
  if (!canManageConnectors(actorRole)) {
    throw new Error("Forbidden: connector management role required.");
  }
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
    handleSessionExpired(error, returnTo);
    redirect(appendQueryParams(returnTo, { status: "schedule-error" }));
  }
  revalidatePath(`/channels/connectors/${installationId}`);
  redirect(appendQueryParams(returnTo, { status: "schedule-deleted" }));
}

export async function triggerBulkPublishAction(formData: FormData) {
  "use server";
  const { actorRole } = await getServerSession();
  if (!canPublishToChannels(actorRole)) {
    throw new Error("Forbidden: publishing role required.");
  }
  const installationId = String(formData.get("installationId") ?? "").trim();
  const channel = String(formData.get("channel") ?? "").trim();
  const productIdsRaw = String(formData.get("productIds") ?? "").trim();
  const returnTo =
    String(formData.get("returnTo") ?? "").trim() ||
    `/channels/connectors/${encodeURIComponent(installationId)}?tab=sync`;
  if (!installationId) {
    throw new Error("Installation ID is required.");
  }
  if (isMarketplaceChannel(channel) && isChannelInDevelopment(channel)) {
    throw new Error(IN_DEVELOPMENT_CHANNEL_NOTICE);
  }
  const productIds = productIdsRaw
    ? productIdsRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : [];
  let result: { submissionIds: string[]; excluded: Array<{ productId: string; reason: string }> };
  try {
    result = await postJsonForAction<{ submissionIds: string[]; excluded: Array<{ productId: string; reason: string }> }>(
      formData,
      `/marketplace/connectors/${encodeURIComponent(installationId)}/bulk-publish`,
      { productIds },
    );
  } catch (error: unknown) {
    rethrowRedirectError(error);
    handleSessionExpired(error, returnTo);
    // no_eligible_products means every product in the batch failed the approval/readiness
    // gate — distinct from a transport/connector-health failure, so the operator sees why
    // nothing was queued instead of a generic failure message.
    if (error instanceof ApiHttpError && error.body && typeof error.body === "object") {
      const payload = error.body as Record<string, unknown>;
      if (payload.error === "no_eligible_products") {
        const excludedCount = Array.isArray(payload.excluded) ? payload.excluded.length : 0;
        redirect(
          appendQueryParams(returnTo, {
            status: "bulk-publish-none-eligible",
            excludedCount: String(excludedCount),
          }),
        );
      }
      // batch_too_large (TC-06 / #545): the batch exceeded the non-native-BULK_PUBLISH
      // ceiling and was rejected before any per-product work ran. Distinct from a timeout —
      // this is an immediate, cheap rejection, not the request dying partway through.
      if (payload.error === "batch_too_large") {
        const ceiling = typeof payload.ceiling === "number" ? payload.ceiling : 0;
        const submittedCount = typeof payload.submittedCount === "number" ? payload.submittedCount : 0;
        redirect(
          appendQueryParams(returnTo, {
            status: "bulk-publish-too-large",
            ceiling: String(ceiling),
            submittedCount: String(submittedCount),
          }),
        );
      }
    }
    // TC-06 (#545): AbortSignal.timeout on the web->API call surfaces as a raw DOMException
    // (never wrapped into an ApiHttpError, since no HTTP response was ever received) — show
    // the operator "this timed out," not the same generic message as an unrelated failure.
    if (error instanceof DOMException && (error.name === "TimeoutError" || error.name === "AbortError")) {
      redirect(appendQueryParams(returnTo, { status: "bulk-publish-timeout" }));
    }
    redirect(appendQueryParams(returnTo, { status: "bulk-publish-error" }));
  }
  revalidatePath(`/channels/connectors/${installationId}`);
  // Every excluded product failed approval status or destination readiness silently on the
  // backend — surface the split so an operator can't read "8 approved products selected"
  // followed by a flat success banner as "all 8 were queued" when most were dropped.
  redirect(
    appendQueryParams(returnTo, {
      status: "bulk-publish-queued",
      queuedCount: String(result.submissionIds.length),
      excludedCount: String(result.excluded.length),
    }),
  );
}

export async function confirmCatalogLinksAction(
  installationId: string,
  links: Array<{ productId: string; shopifyGid: string; matchedBy: string }>,
): Promise<{ confirmed: number }> {
  "use server";
  const { authHeader, actorRole } = await getServerSession();
  if (actorRole !== "admin") {
    throw new Error("Forbidden: admin role required.");
  }
  const tenantKey = process.env.PIM_DEFAULT_TENANT_KEY || "default";
  const options: ApiRequestOptions = { authHeader, role: actorRole, tenantKey };
  const result = await postJson<{ confirmed: number }>(
    `/marketplace/connectors/shopify/${encodeURIComponent(installationId)}/catalog-link/confirm`,
    { links },
    options,
  );
  revalidatePath(`/channels/connectors/${encodeURIComponent(installationId)}/catalog-link`);
  return result;
}
