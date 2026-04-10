"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createWorkspaceUser,
  deactivateWorkspaceUser,
  lockWorkspaceUser,
  unlockWorkspaceUser,
  updateWorkspaceUserRole,
  normalizeAppRole,
  type AppRole,
} from "@/lib/api";
import { getServerAuthHeader } from "@/lib/server-auth";

const INVITE_ROLES: readonly AppRole[] = ["editor", "reviewer", "viewer"];

async function requireAdminRequestOptions() {
  const authHeader = await getServerAuthHeader();
  if (!authHeader) {
    throw new Error("Authenticated session is required.");
  }
  return { authHeader };
}

function redirectWithStatus(status: string) {
  redirect(`/admin/users?status=${encodeURIComponent(status)}`);
}

export async function createWorkspaceUserAction(formData: FormData) {
  const userId = String(formData.get("userId") ?? "").trim();
  const role = normalizeAppRole(formData.get("role"));
  if (!userId) {
    throw new Error("User ID is required.");
  }
  if (!INVITE_ROLES.includes(role)) {
    throw new Error("Role must be editor, reviewer, or viewer.");
  }
  await createWorkspaceUser({ userId, role }, await requireAdminRequestOptions());
  revalidatePath("/admin/users");
  redirectWithStatus("user-created");
}

export async function updateWorkspaceUserRoleAction(formData: FormData) {
  const userId = String(formData.get("userId") ?? "").trim();
  const role = normalizeAppRole(formData.get("role"));
  if (!userId) {
    throw new Error("User ID is required.");
  }
  await updateWorkspaceUserRole(userId, { role }, await requireAdminRequestOptions());
  revalidatePath("/admin/users");
  redirectWithStatus("role-updated");
}

export async function lockWorkspaceUserAction(formData: FormData) {
  const userId = String(formData.get("userId") ?? "").trim();
  const durationRaw = String(formData.get("durationMinutes") ?? "").trim();
  const durationMinutes = durationRaw ? Number.parseInt(durationRaw, 10) : undefined;
  const reason = String(formData.get("reason") ?? "").trim();
  if (!userId) {
    throw new Error("User ID is required.");
  }
  await lockWorkspaceUser(
    userId,
    {
      durationMinutes: Number.isFinite(durationMinutes) ? durationMinutes : undefined,
      reason: reason || undefined,
    },
    await requireAdminRequestOptions(),
  );
  revalidatePath("/admin/users");
  redirectWithStatus("user-locked");
}

export async function unlockWorkspaceUserAction(formData: FormData) {
  const userId = String(formData.get("userId") ?? "").trim();
  if (!userId) {
    throw new Error("User ID is required.");
  }
  await unlockWorkspaceUser(userId, await requireAdminRequestOptions());
  revalidatePath("/admin/users");
  redirectWithStatus("user-unlocked");
}

export async function deactivateWorkspaceUserAction(formData: FormData) {
  const userId = String(formData.get("userId") ?? "").trim();
  if (!userId) {
    throw new Error("User ID is required.");
  }
  await deactivateWorkspaceUser(userId, await requireAdminRequestOptions());
  revalidatePath("/admin/users");
  redirectWithStatus("user-deactivated");
}
