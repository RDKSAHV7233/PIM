"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createApiAccessKey, normalizeAppRole, revokeApiAccessKey } from "@/lib/api";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";

export type ApiKeyCreateActionState = {
  status: "idle" | "success" | "error";
  message: string | null;
  createdKey: string | null;
};

async function requireAdminRequestOptions() {
  const authHeader = await getServerAuthHeader();
  const role = await getServerActorRole();
  if (role !== "admin" || !authHeader) {
    throw new Error("Admin role is required.");
  }
  return { authHeader, role };
}

export async function createApiAccessKeyAction(
  _previousState: ApiKeyCreateActionState,
  formData: FormData,
): Promise<ApiKeyCreateActionState> {
  try {
    const label = String(formData.get("label") ?? "").trim();
    const role = normalizeAppRole(formData.get("role"));
    const expiresAtRaw = String(formData.get("expiresAt") ?? "").trim();
    if (!label) {
      return {
        status: "error",
        message: "Label is required.",
        createdKey: null,
      };
    }
    if (role === "admin") {
      return {
        status: "error",
        message: "Admin API keys are intentionally disabled.",
        createdKey: null,
      };
    }
    const created = await createApiAccessKey(
      {
        label,
        role,
        expiresAt: expiresAtRaw ? new Date(expiresAtRaw).toISOString() : undefined,
      },
      await requireAdminRequestOptions(),
    );
    revalidatePath("/admin/api-keys");
    return {
      status: "success",
      message: `API key created for ${created.label}. Copy it now; it will not be shown again.`,
      createdKey: created.plainTextKey,
    };
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Failed to create API key.";
    return {
      status: "error",
      message,
      createdKey: null,
    };
  }
}

export async function revokeApiAccessKeyAction(formData: FormData) {
  const keyId = String(formData.get("keyId") ?? "").trim();
  if (!keyId) {
    throw new Error("API key is required.");
  }
  await revokeApiAccessKey(keyId, await requireAdminRequestOptions());
  revalidatePath("/admin/api-keys");
  redirect("/admin/api-keys?status=api-key-revoked");
}
