"use server";

import { revalidatePath } from "next/cache";
import { postJson, patchJson } from "@/lib/api";
import { getServerAuthHeader } from "@/lib/server-auth";

function resolveTenantKey(formData: FormData): string {
  const fromForm = String(formData.get("tenantKey") ?? "").trim();
  if (fromForm) return fromForm;
  return String(process.env.PIM_DEFAULT_TENANT_KEY ?? "").trim() || "default";
}

async function resolveQualityActionOptions(formData: FormData) {
  return { tenantKey: resolveTenantKey(formData), authHeader: await getServerAuthHeader() };
}

/**
 * Create a change request on an in-review product.
 * FormData: productId, reason
 * API: POST /catalog/products/:id/change-requests
 */
export async function createChangeRequestAction(formData: FormData) {
  const productId = String(formData.get("productId") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  if (!productId || !reason) {
    throw new Error("productId and reason are required to create a change request.");
  }
  const options = await resolveQualityActionOptions(formData);
  await postJson(
    `/catalog/products/${encodeURIComponent(productId)}/change-requests`,
    { reason },
    options,
  );
  revalidatePath("/quality/approvals");
  revalidatePath(`/products/${productId}`);
}

/**
 * Resolve an open change request.
 * FormData: productId, requestId
 * API: POST /catalog/products/:id/change-requests/:requestId/resolve
 */
export async function resolveChangeRequestAction(formData: FormData) {
  const productId = String(formData.get("productId") ?? "").trim();
  const requestId = String(formData.get("requestId") ?? "").trim();
  if (!productId || !requestId) {
    throw new Error("productId and requestId are required.");
  }
  const options = await resolveQualityActionOptions(formData);
  await postJson(
    `/catalog/products/${encodeURIComponent(productId)}/change-requests/${encodeURIComponent(requestId)}/resolve`,
    {},
    options,
  );
  revalidatePath("/quality/approvals");
  revalidatePath(`/products/${productId}`);
}

/**
 * Assign or unassign a reviewer on a product.
 * FormData: productId, assigneeId (empty string = unassign)
 * API: PATCH /catalog/products/:id/assignee
 */
export async function assignProductAction(formData: FormData) {
  const productId = String(formData.get("productId") ?? "").trim();
  const assigneeId = String(formData.get("assigneeId") ?? "").trim() || null;
  if (!productId) {
    throw new Error("productId is required.");
  }
  const options = await resolveQualityActionOptions(formData);
  await patchJson(
    `/catalog/products/${encodeURIComponent(productId)}/assignee`,
    { assigneeId },
    options,
  );
  revalidatePath("/quality/approvals");
  revalidatePath(`/products/${productId}`);
}
