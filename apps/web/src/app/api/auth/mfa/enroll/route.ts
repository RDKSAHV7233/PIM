import { NextRequest, NextResponse } from "next/server";

function getApiBaseUrl(): string {
  const value = String(process.env.PIM_API_BASE_URL ?? "").trim();
  return value || "http://localhost:4000/api/v1";
}

export async function POST(request: NextRequest) {
  const body = (await request.json()) as Record<string, unknown>;
  const enrollmentToken = String(body?.enrollmentToken ?? "").trim();

  let response: Response;
  try {
    response = await fetch(`${getApiBaseUrl()}/auth/mfa/enroll`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${enrollmentToken}`,
      },
      body: JSON.stringify({}),
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
