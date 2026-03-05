import { NextRequest, NextResponse } from "next/server";
import { resolveBearerToken, validateCsrf } from "../../_auth";

function getApiBaseUrl(): string {
  const value = String(process.env.PIM_API_BASE_URL ?? "").trim();
  return value || "http://localhost:4000/api/v1";
}

function useSecureCookies(): boolean {
  return String(process.env.APP_ENV ?? process.env.NODE_ENV ?? "").trim().toLowerCase() === "production";
}

function clearAuthCookies(response: NextResponse): NextResponse {
  const secureCookies = useSecureCookies();
  response.cookies.set("pim_access_token", "", {
    httpOnly: true,
    secure: secureCookies,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  response.cookies.set("pim_csrf_token", "", {
    httpOnly: false,
    secure: secureCookies,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}

export async function POST(request: NextRequest) {
  const csrfError = validateCsrf(request);
  if (csrfError) {
    return csrfError;
  }

  const authHeader = resolveBearerToken(request);
  if (!authHeader) {
    return clearAuthCookies(new NextResponse(null, { status: 204 }));
  }

  const response = await fetch(`${getApiBaseUrl()}/auth/logout`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
    },
    cache: "no-store",
  });

  // Logout is treated as idempotent at the web edge.
  if (response.status === 204 || response.status === 401) {
    return clearAuthCookies(new NextResponse(null, { status: 204 }));
  }

  const contentType = response.headers.get("content-type") ?? "application/json";
  const payload = await response.text();
  return new NextResponse(payload, {
    status: response.status,
    headers: {
      "Content-Type": contentType,
    },
  });
}
