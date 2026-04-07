"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  createWorkspaceUser,
  deactivateWorkspaceUser,
  lockWorkspaceUser,
  normalizeAppRole,
  type AppRole,
  unlockWorkspaceUser,
  updateWorkspaceUserRole,
} from "@/lib/api";
import { getServerAuthHeader } from "@/lib/server-auth";
import { getServerActorRole } from "@/lib/server-session";

const INVITE_ROLES: readonly AppRole[] = ["editor", "reviewer", "viewer"];

async function requireAdminRequestOptions() {
  const authHeader = await getServerAuthHeader();
  const role = await getServerActorRole();
  if (role !== "admin" || !authHeader) {
    throw new Error("Admin role is required.");
  }
  return { authHeader, role };
}

function redirectWithStatus(status: string) {
  redirect(`/admin/users?status=${encodeURIComponent(status)}`);
}

function buildUsersRedirect(status: string, message?: string, redirectTo = "/admin/users") {
  const url = new URL(redirectTo, "http://localhost");
  url.searchParams.set("status", status);
  if (message) {
    url.searchParams.set("message", message);
  }
  return `${url.pathname}${url.search}`;
}

function redirectWithError(message: string, redirectTo = "/admin/users") {
  redirect(buildUsersRedirect("user-error", message, redirectTo));
}

function resolveRedirectTarget(formData: FormData, key: string, fallback: string) {
  const raw = String(formData.get(key) ?? "").trim();
  return raw.startsWith("/") ? raw : fallback;
}

export async function createWorkspaceUserAction(formData: FormData) {
  const userId = String(formData.get("userId") ?? "").trim();
  const role = normalizeAppRole(formData.get("role"));
  const errorRedirectTo = resolveRedirectTarget(formData, "errorRedirectTo", "/admin/users?showInvite=true");
  try {
    if (!userId) {
      throw new Error("User ID is required.");
    }
    if (!INVITE_ROLES.includes(role)) {
      throw new Error("Role must be editor, reviewer, or viewer.");
    }
    await createWorkspaceUser({ userId, role }, await requireAdminRequestOptions());
    revalidatePath("/admin/users");
  } catch (error) {
    redirectWithError(error instanceof Error ? error.message : "Unable to invite workspace user.", errorRedirectTo);
  }
  redirectWithStatus("user-created");
}

export async function updateWorkspaceUserRoleAction(formData: FormData) {
  const userId = String(formData.get("userId") ?? "").trim();
  const role = normalizeAppRole(formData.get("role"));
  try {
    if (!userId) {
      throw new Error("User ID is required.");
    }
    await updateWorkspaceUserRole(userId, { role }, await requireAdminRequestOptions());
    revalidatePath("/admin/users");
  } catch (error) {
    redirectWithError(error instanceof Error ? error.message : "Unable to update workspace user.");
  }
  redirectWithStatus("role-updated");
}

export async function lockWorkspaceUserAction(formData: FormData) {
  const userId = String(formData.get("userId") ?? "").trim();
  const durationRaw = String(formData.get("durationMinutes") ?? "").trim();
  const durationMinutes = durationRaw ? Number.parseInt(durationRaw, 10) : undefined;
  const reason = String(formData.get("reason") ?? "").trim();
  try {
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
  } catch (error) {
    redirectWithError(error instanceof Error ? error.message : "Unable to lock workspace user.");
  }
  redirectWithStatus("user-locked");
}

export async function unlockWorkspaceUserAction(formData: FormData) {
  const userId = String(formData.get("userId") ?? "").trim();
  try {
    if (!userId) {
      throw new Error("User ID is required.");
    }
    await unlockWorkspaceUser(userId, await requireAdminRequestOptions());
    revalidatePath("/admin/users");
  } catch (error) {
    redirectWithError(error instanceof Error ? error.message : "Unable to unlock workspace user.");
  }
  redirectWithStatus("user-unlocked");
}

export async function deactivateWorkspaceUserAction(formData: FormData) {
  const userId = String(formData.get("userId") ?? "").trim();
  try {
    if (!userId) {
      throw new Error("User ID is required.");
    }
    await deactivateWorkspaceUser(userId, await requireAdminRequestOptions());
    revalidatePath("/admin/users");
  } catch (error) {
    redirectWithError(error instanceof Error ? error.message : "Unable to deactivate workspace user.");
  }
  redirectWithStatus("user-deactivated");
}
