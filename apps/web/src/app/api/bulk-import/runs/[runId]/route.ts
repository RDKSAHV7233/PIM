import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl } from "@/lib/api-base-url";
import { resolveBearerToken } from "@/app/api/_auth";

interface RouteContext {
  params: Promise<{
    runId: string;
  }>;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const authHeader = resolveBearerToken(request);
  if (!authHeader) {
    return NextResponse.json({ error: "MISSING_AUTH_TOKEN" }, { status: 401 });
  }

  const { runId } = await context.params;
  const response = await fetch(`${getApiBaseUrl()}/bulk-import/runs/${encodeURIComponent(runId)}`, {
    method: "GET",
    headers: {
      Authorization: authHeader,
      Accept: "application/json",
    },
    cache: "no-store",
  });

  const payload = await response.text();
  return new NextResponse(payload, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("content-type") ?? "application/json; charset=utf-8",
    },
  });
}
