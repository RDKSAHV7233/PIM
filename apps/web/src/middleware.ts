import { NextRequest, NextResponse } from "next/server";

const ACCESS_COOKIE = "pim_access_token";
const REFRESH_COOKIE = "pim_refresh_token";
const REFRESH_THRESHOLD_SECONDS = 10 * 60;

function useSecureCookies(): boolean {
  const appEnv = String(process.env.APP_ENV ?? process.env.NODE_ENV ?? "").trim().toLowerCase();
  return appEnv === "production" || appEnv === "staging";
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(normalized.length + ((4 - (normalized.length % 4)) % 4), "=");
  return atob(padded);
}

function getTokenExpiry(token: string): number | null {
  try {
    const [, payloadSegment] = token.split(".");
    if (!payloadSegment) return null;
    const payload = JSON.parse(decodeBase64Url(payloadSegment)) as Record<string, unknown>;
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

function shouldRefresh(accessToken: string): boolean {
  const exp = getTokenExpiry(accessToken);
  if (!exp) return true;
  return exp - Math.floor(Date.now() / 1000) < REFRESH_THRESHOLD_SECONDS;
}

function getApiBaseUrl(request: NextRequest): string {
  const configured = String(process.env.PIM_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_URL ?? "").trim();
  if (configured) {
    try {
      const parsed = new URL(configured);
      const pathname = parsed.pathname.replace(/\/+$/, "");
      parsed.pathname = !pathname || pathname === "/" ? "/api/v1" : pathname;
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString().replace(/\/$/, "");
    } catch {
      return configured.replace(/\/+$/, "");
    }
  }
  const url = new URL(request.url);
  return `${url.protocol}//${url.hostname}:4000/api/v1`;
}

function extractCookieValue(setCookieHeader: string | null, name: string): string | null {
  if (!setCookieHeader) return null;
  const pattern = new RegExp(`(?:^|,\\s*)${name}=([^;]+)`);
  const match = setCookieHeader.match(pattern);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

const PUBLIC_PATHS = ["/login", "/signup", "/contact", "/health", "/consent", "/rejection", "/account-suspended"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (pathname.startsWith("/_next") || pathname.startsWith("/api") || pathname.includes(".")) {
    return NextResponse.next();
  }

  const accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;

  // Fail-fast auth gate: no tokens at all on a protected route → redirect to login
  if (!accessToken && !refreshToken && !isPublicPath(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("reason", "session_expired");
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  // Skip refresh if: no refresh token available (can't recover), OR access token is valid and not expiring
  if (!refreshToken || (accessToken && !shouldRefresh(accessToken))) {
    return NextResponse.next();
  }
  // Fall through: refresh token present AND (access token missing OR close to expiry)

  try {
    const refreshResponse = await fetch(`${getApiBaseUrl(request)}/auth/refresh`, {
      method: "POST",
      headers: {
        Cookie: `${REFRESH_COOKIE}=${encodeURIComponent(refreshToken)}`,
      },
      cache: "no-store",
    });
    if (!refreshResponse.ok) {
      return NextResponse.next();
    }

    const payload = (await refreshResponse.json()) as {
      accessToken?: string;
      expiresInSeconds?: number;
    };
    if (!payload.accessToken) {
      return NextResponse.next();
    }

    const response = NextResponse.next();
    const secureCookies = useSecureCookies();
    response.cookies.set(ACCESS_COOKIE, payload.accessToken, {
      httpOnly: true,
      secure: secureCookies,
      sameSite: "lax",
      path: "/",
      maxAge: Number.isFinite(payload.expiresInSeconds) ? Number(payload.expiresInSeconds) : 4 * 60 * 60,
    });

    const nextRefreshToken = extractCookieValue(refreshResponse.headers.get("set-cookie"), REFRESH_COOKIE);
    if (nextRefreshToken) {
      response.cookies.set(REFRESH_COOKIE, nextRefreshToken, {
        httpOnly: true,
        secure: secureCookies,
        sameSite: "strict",
        path: "/",
        maxAge: 7 * 24 * 60 * 60,
      });
    }
    return response;
  } catch {
    return NextResponse.next();
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
