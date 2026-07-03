import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl } from "@/lib/api-base-url";
import { resolveBearerToken } from "../../../../_auth";

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
  const response = await fetch(`${getApiBaseUrl()}/bulk-import/runs/${encodeURIComponent(runId)}/error-report`, {
    method: "GET",
    headers: {
      Authorization: authHeader,
      Accept: "text/csv",
    },
    cache: "no-store",
  });

  const body = await response.text();
  const contentType = response.headers.get("content-type") ?? "text/csv; charset=utf-8";
  const disposition =
    response.headers.get("content-disposition") ?? `attachment; filename="bulk-import-run-${runId}-errors.csv"`;

  return new NextResponse(body, {
    status: response.status,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": disposition,
      "Cache-Control": "no-store, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
