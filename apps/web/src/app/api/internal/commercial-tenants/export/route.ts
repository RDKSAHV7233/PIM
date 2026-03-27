import { NextResponse } from "next/server";
import { getServerActorRole, getServerSessionClaims } from "@/lib/server-session";

function getApiBaseUrl() {
  const value = String(process.env.PIM_API_BASE_URL ?? "").trim();
  return value || "http://localhost:4000/api/v1";
}

export async function GET(request: Request) {
  const role = await getServerActorRole();
  const claims = await getServerSessionClaims();
  if (!claims?.sub || role !== "admin" || process.env.APP_ENV === "production") {
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
      "x-pim-operator-role": role,
    },
    cache: "no-store",
  });

  const body = await response.text();
  const contentType = response.headers.get("content-type") ?? "text/csv; charset=utf-8";
  const disposition =
    response.headers.get("content-disposition") ?? 'attachment; filename="tej-pim-commercial-tenants.csv"';

  return new NextResponse(body, {
    status: response.status,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": disposition,
    },
  });
}
