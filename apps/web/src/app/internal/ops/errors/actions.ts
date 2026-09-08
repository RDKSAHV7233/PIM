"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ApiHttpError } from "@/lib/api";
import { resolveErrorAuthorityIssue } from "@/lib/api/error-authority-ops";
import { buildLoginRedirect } from "@/lib/auth-redirect";
import { isSystemAdminBoundary } from "@/lib/role-capabilities";
import { getServerSession } from "@/lib/server-session";

const PRESERVED_QUERY_KEYS = [
  "runtime",
  "service",
  "severity",
  "state",
  "release",
  "errorCode",
  "route",
  "dateFrom",
  "dateTo",
  "limit",
  "cursor",
  "issueId",
  "occurrenceCursor",
];

function buildReturnTo(formData: FormData): URL {
  const url = new URL("/internal/ops/errors", "https://local.vexa");
  for (const key of PRESERVED_QUERY_KEYS) {
    const value = String(formData.get(key) ?? "").trim();
    if (value) {
      url.searchParams.set(key, value);
    }
  }
  return url;
}

function currentPath(url: URL): string {
  const query = url.searchParams.toString();
  return query ? `${url.pathname}?${query}` : url.pathname;
}

function redirectTo(url: URL): never {
  redirect(currentPath(url));
}

/**
 * PIM#766 Part 1: manual resolve, invoked from the confirmation dialog on
 * the internal ops errors page. Affects retention — a resolved issue becomes
 * purge-eligible once it also crosses ERROR_AUTHORITY_RETENTION_DAYS — so the
 * UI confirms before calling this, and this action re-checks the same
 * server-session role/boundary gate the page itself renders behind (a
 * server action is a public endpoint; the page's client-side gating alone
 * is not enforcement).
 */
export async function resolveErrorIssueAction(formData: FormData) {
  const returnTo = buildReturnTo(formData);
  const issueId = String(formData.get("issueId") ?? "").trim();
  const { authHeader, actorRole, adminBoundaryRoles } = await getServerSession();

  if (!authHeader) {
    redirect(buildLoginRedirect(currentPath(returnTo)));
  }
  if (actorRole !== "admin" || !isSystemAdminBoundary(adminBoundaryRoles)) {
    returnTo.searchParams.set("resolveStatus", "forbidden");
    redirectTo(returnTo);
  }
  if (!issueId) {
    returnTo.searchParams.set("resolveStatus", "error");
    redirectTo(returnTo);
  }

  try {
    await resolveErrorAuthorityIssue(issueId, { authHeader });
    revalidatePath("/internal/ops/errors");
    returnTo.searchParams.set("issueId", issueId);
    returnTo.searchParams.set("resolveStatus", "resolved");
    redirectTo(returnTo);
  } catch (error) {
    if (error instanceof ApiHttpError && (error.status === 401 || error.status === 403)) {
      redirect(buildLoginRedirect(currentPath(returnTo), error));
    }
    if (error instanceof ApiHttpError) {
      returnTo.searchParams.set("resolveStatus", "error");
      redirectTo(returnTo);
    }
    throw error;
  }
}
