"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  ApiHttpError,
  createAccessScopeAssignment,
  createWorkspaceUser,
  deleteAccessScopeAssignment,
  deactivateWorkspaceUser,
  lockWorkspaceUser,
  unlockWorkspaceUser,
  updateWorkspaceUserRole,
  normalizeAppRole,
} from "@/lib/api";
import { getServerSession } from "@/lib/server-session";

async function requireAdminRequestOptions() {
  const { authHeader, actorRole } = await getServerSession();
  if (!authHeader) {
    throw new Error("Authenticated session is required.");
  }
  if (actorRole !== "admin") {
    throw new Error("Admin role is required.");
  }
  return { role: actorRole, authHeader };
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
  return /^\/(?!\/)/.test(raw) ? raw : fallback;
}

function resolveCreateUserErrorMessage(error: unknown): string {
  if (error instanceof ApiHttpError) {
    const body = error.body;
    if (body && typeof body === "object") {
      const { error: code, limit, current, role, planTier } = body as Record<string, unknown>;
      if (code === "PLAN_USERS_LIMIT_EXCEEDED") {
        const limitStr = typeof limit === "number" ? String(limit) : "";
        const currentStr = typeof current === "number" ? String(current) : "";
        const suffix = limitStr ? ` (${currentStr}/${limitStr} users)` : "";
        return `User limit reached${suffix}. Review your plan on the Plan & Usage page to invite more users.`;
      }
      if (code === "PLAN_LIMIT_EXCEEDED") {
        return "Plan limit reached. Review your plan on the Plan & Usage page.";
      }
      if (code === "ROLE_NOT_AVAILABLE_IN_PLAN") {
        const roleStr = typeof role === "string" ? role : "this role";
        const tierStr = typeof planTier === "string" ? planTier : "your current plan";
        return `Role "${roleStr}" is not available on the ${tierStr} plan. Upgrade to assign it.`;
      }
      if (code === "USER_ALREADY_EXISTS") {
        return "A user with this email already exists in the workspace.";
      }
      if (code === "USER_ID_REQUIRED") {
        return "An email address is required to invite a user.";
      }
      if (code === "ACCESS_POLICY_DENIED") {
        return "You do not have permission to perform this action.";
      }
    }
  }
  return error instanceof Error ? error.message : "Unable to invite workspace user.";
}

function resolveUpdateRoleErrorMessage(error: unknown): string {
  if (error instanceof ApiHttpError) {
    const body = error.body;
    if (body && typeof body === "object") {
      const { error: code, role, planTier } = body as Record<string, unknown>;
      if (code === "ROLE_NOT_AVAILABLE_IN_PLAN") {
        const roleStr = typeof role === "string" ? role : "this role";
        const tierStr = typeof planTier === "string" ? planTier : "your current plan";
        return `Role "${roleStr}" is not available on the ${tierStr} plan. Upgrade to assign it.`;
      }
    }
  }
  return error instanceof Error ? error.message : "Unable to update workspace user.";
}

export async function createWorkspaceUserAction(formData: FormData) {
  const userId = String(formData.get("userId") ?? "").trim();
  const role = normalizeAppRole(formData.get("role"));
  const errorRedirectTo = resolveRedirectTarget(formData, "errorRedirectTo", "/admin/users?showInvite=true");
  try {
    if (!userId) {
      throw new Error("User ID is required.");
    }
    if (role === null) {
      throw new Error("A valid role is required.");
    }
    await createWorkspaceUser({ userId, role }, await requireAdminRequestOptions());
    revalidatePath("/admin/users");
  } catch (error) {
    redirectWithError(resolveCreateUserErrorMessage(error), errorRedirectTo);
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
    if (role === null) {
      throw new Error("A valid role is required.");
    }
    await updateWorkspaceUserRole(userId, { role }, await requireAdminRequestOptions());
    revalidatePath("/admin/users");
  } catch (error) {
    redirectWithError(resolveUpdateRoleErrorMessage(error));
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
  const confirmUserId = String(formData.get("confirmUserId") ?? "").trim();
  try {
    if (!userId) {
      throw new Error("User ID is required.");
    }
    if (confirmUserId !== userId) {
      throw new Error("User ID does not match. Type the exact User ID to confirm deactivation.");
    }
    await deactivateWorkspaceUser(userId, await requireAdminRequestOptions());
    revalidatePath("/admin/users");
  } catch (error) {
    if (error instanceof ApiHttpError) {
      const body = error.body as Record<string, unknown> | null;
      if (body?.error === "LAST_ADMIN_GUARD") {
        redirectWithError("Cannot deactivate the last active admin. Promote another user to admin first.");
      }
    }
    redirectWithError(error instanceof Error ? error.message : "Unable to deactivate workspace user.");
  }
  redirectWithStatus("user-deactivated");
}

export async function createAccessScopeAssignmentAction(formData: FormData) {
  const subjectType = String(formData.get("subjectType") ?? "").trim().toLowerCase() as "user" | "role";
  const subjectId = String(formData.get("subjectId") ?? "").trim();
  const scopeType = String(formData.get("scopeType") ?? "").trim().toLowerCase() as
    | "category"
    | "brand"
    | "channel"
    | "connector_account";
  const categoryId = String(formData.get("categoryId") ?? "").trim();
  const connectorInstallationId = String(formData.get("connectorInstallationId") ?? "").trim();
  const scopeValue = String(formData.get("scopeValue") ?? "").trim();
  const actionsRaw = String(formData.get("actions") ?? "").trim();
  const actions = actionsRaw
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  try {
    if (!subjectId) {
      throw new Error("Subject ID is required.");
    }
    await createAccessScopeAssignment(
      {
        subjectType,
        subjectId,
        scopeType,
        ...(categoryId ? { categoryId } : {}),
        ...(connectorInstallationId ? { connectorInstallationId } : {}),
        ...(scopeValue ? { scopeValue } : {}),
        ...(actions.length > 0 ? { actions: actions as NonNullable<Parameters<typeof createAccessScopeAssignment>[0]["actions"]> } : {}),
      },
      await requireAdminRequestOptions(),
    );
    revalidatePath("/admin/users");
  } catch (error) {
    redirectWithError(error instanceof Error ? error.message : "Unable to create scope assignment.");
  }
  redirectWithStatus("scope-created");
}

export async function deleteAccessScopeAssignmentAction(formData: FormData) {
  const assignmentId = String(formData.get("assignmentId") ?? "").trim();
  try {
    if (!assignmentId) {
      throw new Error("Assignment ID is required.");
    }
    await deleteAccessScopeAssignment(assignmentId, await requireAdminRequestOptions());
    revalidatePath("/admin/users");
  } catch (error) {
    redirectWithError(error instanceof Error ? error.message : "Unable to delete scope assignment.");
  }
  redirectWithStatus("scope-deleted");
}
