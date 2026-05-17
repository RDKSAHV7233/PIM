import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl } from "@/lib/api-base-url";

export async function POST(request: NextRequest) {
  const cookieToken = request.cookies.get("pim_access_token")?.value ?? "";
  if (!cookieToken) {
    return NextResponse.json({ error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const body = (await request.json()) as Record<string, unknown>;
  const code = String(body?.code ?? "").trim();

  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}/auth/mfa/backup-codes/regenerate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cookieToken}`,
      },
      body: JSON.stringify({ code }),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json({ error: "AUTH_UPSTREAM_UNAVAILABLE" }, { status: 503 });
  }

  const rawBody = await response.text();
  return new NextResponse(rawBody, {
    status: response.status,
    headers: { "Content-Type": response.headers.get("content-type") ?? "application/json" },
  });
}
