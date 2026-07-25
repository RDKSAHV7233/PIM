"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createOutboundWebhookEndpoint,
  deleteOutboundWebhookEndpoint,
  retryOutboundWebhookDelivery,
  sendOutboundWebhookTest,
  updateOutboundWebhookEndpoint,
} from "@/lib/api";
import { getServerSession } from "@/lib/server-session";
import { WEBHOOK_EVENT_TYPES } from "@/lib/constants/webhook-events";

async function requireAdminRequestOptions() {
  const { authHeader, actorRole: role } = await getServerSession();
  if (role !== "admin" || !authHeader) {
    throw new Error("Admin role is required.");
  }
  return { authHeader, role };
}

function sanitizeWebhookRedirectPath(value: FormDataEntryValue | null) {
  const path = String(value ?? "").trim();
  return path.startsWith("/admin/webhooks") ? path : "/admin/webhooks";
}

function redirectWithStatus(status: string, redirectTo = "/admin/webhooks") {
  redirect(buildWebhookRedirect(status, undefined, redirectTo));
}

function buildWebhookRedirect(status: string, message?: string, path = "/admin/webhooks") {
  const [basePath, existingQuery = ""] = path.split("?");
  const params = new URLSearchParams(existingQuery);
  params.set("status", status);
  if (message) {
    params.set("message", message);
  } else {
    params.delete("message");
  }
  return `${basePath}?${params.toString()}`;
}

function redirectWithError(message: string, redirectTo = "/admin/webhooks") {
  redirect(buildWebhookRedirect("webhook-error", message, redirectTo));
}

export async function createOutboundWebhookAction(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const eventType = String(formData.get("eventType") ?? "").trim();
  const targetUrl = String(formData.get("targetUrl") ?? "").trim();
  const signingSecret = String(formData.get("signingSecret") ?? "").trim();
  try {
    if (!name || !targetUrl || !signingSecret) {
      throw new Error("Name, target URL, and signing secret are required.");
    }
    if (!WEBHOOK_EVENT_TYPES.has(eventType)) {
      throw new Error("Choose a valid webhook event type.");
    }
    await createOutboundWebhookEndpoint(
      {
        name,
        eventType: eventType as never,
        targetUrl,
        signingSecret,
        isActive: true,
      },
      await requireAdminRequestOptions(),
    );
    revalidatePath("/admin/webhooks");
  } catch (error) {
    redirectWithError(error instanceof Error ? error.message : "Unable to create webhook endpoint.");
  }
  redirectWithStatus("webhook-created");
}

export async function toggleOutboundWebhookAction(formData: FormData) {
  const endpointId = String(formData.get("endpointId") ?? "").trim();
  const nextState = String(formData.get("isActive") ?? "").trim().toLowerCase();
  const redirectTo = sanitizeWebhookRedirectPath(formData.get("redirectTo"));
  try {
    if (!endpointId) {
      throw new Error("Webhook endpoint is required.");
    }
    await updateOutboundWebhookEndpoint(
      endpointId,
      { isActive: nextState === "true" },
      await requireAdminRequestOptions(),
    );
    revalidatePath("/admin/webhooks");
  } catch (error) {
    redirectWithError(error instanceof Error ? error.message : "Unable to update webhook endpoint.", redirectTo);
  }
  redirectWithStatus(nextState === "true" ? "webhook-resumed" : "webhook-paused", redirectTo);
}

export async function deleteOutboundWebhookAction(formData: FormData) {
  const endpointId = String(formData.get("endpointId") ?? "").trim();
  const redirectTo = sanitizeWebhookRedirectPath(formData.get("redirectTo"));
  try {
    if (!endpointId) {
      throw new Error("Webhook endpoint is required.");
    }
    await deleteOutboundWebhookEndpoint(endpointId, await requireAdminRequestOptions());
    revalidatePath("/admin/webhooks");
  } catch (error) {
    redirectWithError(error instanceof Error ? error.message : "Unable to delete webhook endpoint.", redirectTo);
  }
  redirectWithStatus("webhook-deleted", redirectTo);
}

export async function sendTestOutboundWebhookAction(formData: FormData) {
  const endpointId = String(formData.get("endpointId") ?? "").trim();
  const redirectTo = sanitizeWebhookRedirectPath(formData.get("redirectTo"));
  try {
    if (!endpointId) {
      throw new Error("Webhook endpoint is required.");
    }
    await sendOutboundWebhookTest(endpointId, await requireAdminRequestOptions());
    revalidatePath("/admin/webhooks");
  } catch (error) {
    redirectWithError(error instanceof Error ? error.message : "Unable to queue webhook test delivery.", redirectTo);
  }
  redirectWithStatus("webhook-test-queued", redirectTo);
}

export async function rotateOutboundWebhookSecretAction(formData: FormData) {
  const endpointId = String(formData.get("endpointId") ?? "").trim();
  const signingSecret = String(formData.get("signingSecret") ?? "").trim();
  const redirectTo = sanitizeWebhookRedirectPath(formData.get("redirectTo"));
  try {
    if (!endpointId) {
      throw new Error("Webhook endpoint is required.");
    }
    if (signingSecret.length < 16) {
      throw new Error("Webhook signing secret must be at least 16 characters.");
    }
    await updateOutboundWebhookEndpoint(endpointId, { signingSecret }, await requireAdminRequestOptions());
    revalidatePath("/admin/webhooks");
  } catch (error) {
    redirectWithError(error instanceof Error ? error.message : "Unable to rotate webhook signing secret.", redirectTo);
  }
  redirectWithStatus("webhook-secret-rotated", redirectTo);
}

export async function retryOutboundWebhookDeliveryAction(formData: FormData) {
  const deliveryId = String(formData.get("deliveryId") ?? "").trim();
  const redirectTo = sanitizeWebhookRedirectPath(formData.get("redirectTo"));
  try {
    if (!deliveryId) {
      throw new Error("Webhook delivery is required.");
    }
    await retryOutboundWebhookDelivery(deliveryId, await requireAdminRequestOptions());
    revalidatePath("/admin/webhooks");
  } catch (error) {
    redirectWithError(error instanceof Error ? error.message : "Unable to retry webhook delivery.", redirectTo);
  }
  redirectWithStatus("webhook-retry-queued", redirectTo);
}
