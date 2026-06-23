import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl } from "@/lib/api-base-url";
import { resolveBearerToken, validateCsrf } from "../../_auth";

function useSecureCookies(): boolean {
  const appEnv = String(process.env.APP_ENV ?? process.env.NODE_ENV ?? "").trim().toLowerCase();
  return appEnv === "production" || appEnv === "staging";
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
  response.cookies.set("pim_refresh_token", "", {
    httpOnly: true,
    secure: secureCookies,
    sameSite: "strict",
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
      ...(request.headers.get("cookie") ? { Cookie: request.headers.get("cookie") ?? "" } : {}),
    },
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });

  // Logout is treated as idempotent at the web edge.
  if (response.status === 204 || response.status === 401) {
    return clearAuthCookies(new NextResponse(null, { status: 204 }));
  }

  const contentType = response.headers.get("content-type") ?? "application/json";
  const payload = await response.text();
  if (response.status === 403 && contentType.toLowerCase().includes("application/json")) {
    try {
      const parsed = payload ? JSON.parse(payload) : null;
      if (parsed?.error === "TENANT_SUSPENDED") {
        return clearAuthCookies(new NextResponse(null, { status: 204 }));
      }
    } catch {
      // Preserve the backend response below if parsing fails.
    }
  }
  return new NextResponse(payload, {
    status: response.status,
    headers: {
      "Content-Type": contentType,
    },
  });
}
