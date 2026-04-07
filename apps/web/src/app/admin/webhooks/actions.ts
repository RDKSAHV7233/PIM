"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createOutboundWebhookEndpoint,
  deleteOutboundWebhookEndpoint,
  sendOutboundWebhookTest,
  updateOutboundWebhookEndpoint,
} from "@/lib/api";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";

const WEBHOOK_EVENTS = new Set([
  "import_completed",
  "import_failed",
  "publish_succeeded",
  "publish_failed",
  "approval_decision",
]);

async function requireAdminRequestOptions() {
  const authHeader = await getServerAuthHeader();
  const role = await getServerActorRole();
  if (role !== "admin" || !authHeader) {
    throw new Error("Admin role is required.");
  }
  return { authHeader, role };
}

function redirectWithStatus(status: string) {
  redirect(`/admin/webhooks?status=${encodeURIComponent(status)}`);
}

function buildWebhookRedirect(status: string, message?: string, redirectTo = "/admin/webhooks") {
  const url = new URL(redirectTo, "http://localhost");
  url.searchParams.set("status", status);
  if (message) {
    url.searchParams.set("message", message);
  }
  return `${url.pathname}${url.search}`;
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
    if (!WEBHOOK_EVENTS.has(eventType)) {
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
    redirectWithError(error instanceof Error ? error.message : "Unable to update webhook endpoint.");
  }
  redirectWithStatus(nextState === "true" ? "webhook-resumed" : "webhook-paused");
}

export async function deleteOutboundWebhookAction(formData: FormData) {
  const endpointId = String(formData.get("endpointId") ?? "").trim();
  try {
    if (!endpointId) {
      throw new Error("Webhook endpoint is required.");
    }
    await deleteOutboundWebhookEndpoint(endpointId, await requireAdminRequestOptions());
    revalidatePath("/admin/webhooks");
  } catch (error) {
    redirectWithError(error instanceof Error ? error.message : "Unable to delete webhook endpoint.");
  }
  redirectWithStatus("webhook-deleted");
}

export async function sendTestOutboundWebhookAction(formData: FormData) {
  const endpointId = String(formData.get("endpointId") ?? "").trim();
  try {
    if (!endpointId) {
      throw new Error("Webhook endpoint is required.");
    }
    await sendOutboundWebhookTest(endpointId, await requireAdminRequestOptions());
    revalidatePath("/admin/webhooks");
  } catch (error) {
    redirectWithError(error instanceof Error ? error.message : "Unable to queue webhook test delivery.");
  }
  redirectWithStatus("webhook-test-queued");
}
