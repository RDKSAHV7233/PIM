import { NextResponse } from "next/server";
import { getApiBaseUrl } from "@/lib/api-base-url";
import { getServerSessionClaims } from "@/lib/server-session";

export async function GET(request: Request) {
  const claims = await getServerSessionClaims();
  const role = String(claims?.role ?? "").trim();
  const boundaryRoles = claims?.adminBoundaryRoles ?? [];
  const isOpsOperator = boundaryRoles.includes("system_admin") || boundaryRoles.includes("super_admin");

  if (!claims?.sub || role !== "admin" || !isOpsOperator || process.env.APP_ENV === "production") {
    return NextResponse.json({ error: "NOT_FOUND" }, { status: 404 });
  }

  const commercialOpsToken = String(process.env.PIM_COMMERCIAL_OPS_TOKEN ?? "").trim();
  if (!commercialOpsToken) {
    return NextResponse.json({ error: "COMMERCIAL_OPS_TOKEN_NOT_CONFIGURED" }, { status: 503 });
  }

  const sourceUrl = new URL(request.url);
  const target = new URL(`${getApiBaseUrl()}/billing/internal/tenants/export`);
  sourceUrl.searchParams.forEach((value, key) => {
    if (value.trim()) {
      target.searchParams.set(key, value);
    }
  });

  const response = await fetch(target.toString(), {
    method: "GET",
    headers: {
      Accept: "text/csv",
      "x-pim-commercial-ops-token": commercialOpsToken,
      "x-pim-operator-id": claims.sub,
      "x-pim-operator-role": boundaryRoles.includes("super_admin") ? "super_admin" : "system_admin",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(30_000),
  });

  const body = await response.text();
  const contentType = response.headers.get("content-type") ?? "text/csv; charset=utf-8";
  const disposition =
    response.headers.get("content-disposition") ?? 'attachment; filename="vexa-pim-commercial-tenants.csv"';

  return new NextResponse(body, {
    status: response.status,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": disposition,
    },
  });
}
