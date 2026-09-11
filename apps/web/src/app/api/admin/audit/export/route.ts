import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl } from "@/lib/api-base-url";
import { resolveBearerToken } from "../../../_auth";

export async function GET(request: NextRequest) {
  const authHeader = resolveBearerToken(request);
  if (!authHeader) {
    return NextResponse.json({ error: "MISSING_AUTH_TOKEN" }, { status: 401 });
  }

  const target = new URL(`${getApiBaseUrl()}/audit/events/export`);
  request.nextUrl.searchParams.forEach((value: string, key: string) => {
    if (value.trim()) {
      target.searchParams.set(key, value);
    }
  });

  const response = await fetch(target.toString(), {
    method: "GET",
    headers: {
      Authorization: authHeader,
      Accept: "text/csv",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(60_000),
  });

  const body = await response.text();
  const contentType = response.headers.get("content-type") ?? "text/csv; charset=utf-8";
  const disposition = response.headers.get("content-disposition") ?? 'attachment; filename="vexa-pim-audit-events.csv"';

  return new NextResponse(body, {
    status: response.status,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": disposition,
    },
  });
}
