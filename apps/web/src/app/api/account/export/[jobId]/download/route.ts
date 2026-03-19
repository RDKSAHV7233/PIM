import { NextRequest, NextResponse } from "next/server";
import { resolveBearerToken } from "../../../../_auth";

function getApiBaseUrl(): string {
  const value = String(process.env.PIM_API_BASE_URL ?? "").trim();
  return value || "http://localhost:4000/api/v1";
}

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
      Accept: "application/octet-stream",
    },
    cache: "no-store",
  });

  const buffer = await response.arrayBuffer();
  const outgoing = new NextResponse(buffer, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("content-type") ?? "application/octet-stream",
    },
  });
  const disposition = response.headers.get("content-disposition");
  if (disposition) {
    outgoing.headers.set("Content-Disposition", disposition);
  }
  return outgoing;
}
