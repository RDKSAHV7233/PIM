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
  if (authHeader) {
    try {
      await fetch(`${getApiBaseUrl()}/auth/logout`, {
        method: "POST",
        headers: {
          Authorization: authHeader,
          ...(request.headers.get("cookie") ? { Cookie: request.headers.get("cookie") ?? "" } : {}),
        },
        cache: "no-store",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      // Best-effort server-side invalidation. The local session must still be
      // cleared below even if the backend call errors, times out, or the
      // network is unavailable — otherwise the browser silently stays
      // authenticated after the user believes they logged out.
    }
  }

  // Logout is idempotent at the web edge: local cookies are always cleared,
  // regardless of the backend call's outcome.
  return clearAuthCookies(new NextResponse(null, { status: 204 }));
}
