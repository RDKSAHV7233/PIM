// apps/web/src/app/api/marketplace/connectors/[installationId]/export/route.ts
//
// Server-side proxy for Meesho Excel export downloads.
// Auth and CSRF are enforced here; the binary response is piped back to the browser.

import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl } from "@/lib/api-base-url";
import { resolveBearerToken, validateCsrf } from "@/app/api/_auth";

interface RouteContext {
  params: Promise<{ installationId: string }>;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const csrfError = validateCsrf(request);
  if (csrfError) {
    return csrfError;
  }

  const authHeader = resolveBearerToken(request);
  if (!authHeader) {
    return NextResponse.json({ error: "MISSING_AUTH_TOKEN" }, { status: 401 });
  }

  const { installationId } = await context.params;
  if (!installationId) {
    return NextResponse.json({ error: "MISSING_INSTALLATION_ID" }, { status: 400 });
  }

  const body = await request.json();

  const upstream = await fetch(
    `${getApiBaseUrl()}/marketplace/connectors/${encodeURIComponent(installationId)}/export`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(60_000),
    },
  );

  if (!upstream.ok) {
    const errorText = await upstream.text();
    return new NextResponse(errorText, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Pipe the binary Excel file straight back to the browser
  const arrayBuffer = await upstream.arrayBuffer();
  const contentDisposition =
    upstream.headers.get("content-disposition") ??
    "attachment; filename=\"meesho_export.xlsx\"";
  const contentType =
    upstream.headers.get("content-type") ??
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

  return new NextResponse(arrayBuffer, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": contentDisposition,
      "Cache-Control": "no-store",
    },
  });
}
