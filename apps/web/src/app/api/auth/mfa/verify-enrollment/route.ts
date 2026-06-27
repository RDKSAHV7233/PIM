import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl } from "@/lib/api-base-url";

export async function POST(request: NextRequest) {
  const body = (await request.json()) as Record<string, unknown>;
  const enrollmentToken = request.cookies.get("pim_mfa_enrollment_token")?.value ?? "";
  const code = String(body?.code ?? "").trim();

  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}/auth/mfa/verify-enrollment`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${enrollmentToken}`,
      },
      body: JSON.stringify({ code }),
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return NextResponse.json({ error: "AUTH_UPSTREAM_UNAVAILABLE" }, { status: 503 });
  }

  const rawBody = await response.text();
  const outgoing = new NextResponse(rawBody, {
    status: response.status,
    headers: { "Content-Type": response.headers.get("content-type") ?? "application/json" },
  });
  if (response.ok) {
    outgoing.cookies.set("pim_mfa_enrollment_token", "", {
      httpOnly: true,
      path: "/",
      maxAge: 0,
    });
  }
  return outgoing;
}
