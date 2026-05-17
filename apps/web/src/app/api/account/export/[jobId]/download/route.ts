import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl } from "@/lib/api-base-url";
import { resolveBearerToken } from "../../../../_auth";

interface RouteContext {
  params: Promise<{
    jobId: string;
  }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const authHeader = resolveBearerToken(request);
  if (!authHeader) {
    return NextResponse.json(
      {
        error: "MISSING_AUTH_TOKEN",
      },
      { status: 401 },
    );
  }

  const { jobId } = await context.params;
  const response = await fetch(`${getApiBaseUrl()}/auth/account/export/${encodeURIComponent(jobId)}/download`, {
    method: "GET",
    headers: {
      Authorization: authHeader,
      Accept: "application/json, application/octet-stream",
    },
    cache: "no-store",
  });

  const contentType = response.headers.get("content-type") ?? "application/json";
  if (contentType.includes("application/json")) {
    const payload = await response.json().catch(() => ({
      status: "unavailable",
      reason: "Export not yet ready or has expired.",
    }));
    if (response.ok && typeof payload?.downloadUrl === "string" && payload.downloadUrl.trim().length > 0) {
      return NextResponse.redirect(payload.downloadUrl, { status: 307 });
    }
    if (response.status === 202) {
      const fallbackUrl = new URL("/settings/privacy", request.url);
      return NextResponse.redirect(fallbackUrl, { status: 303 });
    }
    return NextResponse.json(payload, {
      status: response.status,
    });
  }

  const buffer = await response.arrayBuffer();
  const outgoing = new NextResponse(buffer, {
    status: response.status,
    headers: {
      "Content-Type": contentType || "application/octet-stream",
    },
  });
  const disposition = response.headers.get("content-disposition");
  if (disposition) {
    outgoing.headers.set("Content-Disposition", disposition);
  }
  return outgoing;
}
