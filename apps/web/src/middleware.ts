import { NextRequest, NextResponse } from "next/server";

const ACCESS_COOKIE = "pim_access_token";
const REFRESH_COOKIE = "pim_refresh_token";
const CSRF_COOKIE = "pim_csrf_token";
const REFRESH_THRESHOLD_SECONDS = 90;
const ERROR_AUTHORITY_RUNTIME_PROOF_PATH = "/internal/error-authority/runtime-proof";

// PIM security sweep (deferred item): nonce-based Content-Security-Policy.
// script-src is nonce + strict-dynamic — only Next's own framework scripts (tagged
// with this request's nonce) and anything they load run; no inline/injected script
// executes without it. style-src keeps 'unsafe-inline' because the app renders a
// handful of dynamic `style={{...}}` attributes (progress bars, etc.) that CSP has
// no nonce mechanism for on style *attributes* (only <style> elements) — this is the
// standard pragmatic tradeoff (style injection is far lower severity than script
// injection). img-src allows data: for the MFA TOTP QR code, rendered inline as a
// data URL with no network round-trip.
function buildCsp(nonce: string): string {
  // Next's dev-mode HMR/refresh runtime evaluates code via eval(), which a strict
  // script-src blocks outright — this never ships (next build doesn't use eval), so
  // the relaxation is dev-only and has no bearing on staging/production posture.
  const isDev = String(process.env.NODE_ENV ?? "").trim().toLowerCase() === "development";
  const scriptSrc = isDev
    ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'unsafe-eval'`
    : `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`;
  return [
    `default-src 'self'`,
    scriptSrc,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    `font-src 'self' https://fonts.gstatic.com`,
    `img-src 'self' data: blob:`,
    `connect-src 'self'`,
    `frame-ancestors 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `object-src 'none'`,
    `upgrade-insecure-requests`,
  ].join("; ");
}

function applySecurityHeaders(response: NextResponse, nonce: string): NextResponse {
  response.headers.set("Content-Security-Policy", buildCsp(nonce));
  return response;
}

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

const PUBLIC_PATHS = ["/login", "/signup", "/contact", "/health", "/consent", "/account-suspended"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

function isErrorAuthorityRuntimeProofPath(pathname: string): boolean {
  return pathname === ERROR_AUTHORITY_RUNTIME_PROOF_PATH || pathname.startsWith(`${ERROR_AUTHORITY_RUNTIME_PROOF_PATH}/`);
}

// PIM#601: Next.js marks a client-side Server Action invocation with a POST plus the
// `next-action` header (see next/dist/client/components/app-router-headers.js's
// ACTION_HEADER, matched against in next/dist/server/lib/server-action-request-meta.js's
// isFetchAction check - method === "POST" && the header is present). When Next's own
// action-handler wants to redirect such a request (e.g. a `redirect()` call inside a
// Server Action's catch block), it does NOT send a plain 3xx with a `Location` header -
// it sends a 303 with an `x-action-redirect` header and an RSC-shaped body, which is the
// only response shape the client's fetch-based action runtime knows how to consume.
// A raw `NextResponse.redirect()` from middleware is a valid response for a normal GET
// page navigation, but is the wrong shape for a Server Action fetch call: the client
// receives a followed-redirect 200 HTML page instead of an action-response, and throws
// Next.js error E394 ("unexpected response was received from the server").
function isServerActionFetchRequest(request: NextRequest): boolean {
  return request.method === "POST" && request.headers.get("next-action") !== null;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api") ||
    pathname.includes(".") ||
    isErrorAuthorityRuntimeProofPath(pathname)
  ) {
    return NextResponse.next();
  }

  // Nonce is per-request: forwarded to the RSC render via a request header (so the
  // root layout can read it through next/headers) and echoed on the CSP response
  // header so the browser only executes scripts Next tagged with this exact value.
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  const nextWithHeaders = () => NextResponse.next({ request: { headers: requestHeaders } });

  const accessToken = request.cookies.get(ACCESS_COOKIE)?.value;
  const refreshToken = request.cookies.get(REFRESH_COOKIE)?.value;

  // Fail-fast auth gate: no tokens at all on a protected route → redirect to login
  if (!accessToken && !refreshToken && !isPublicPath(pathname)) {
    // PIM#601: don't synthesize a raw redirect for a Server Action fetch call - that
    // response shape crashes the client action runtime (E394). Let the request fall
    // through to the action itself; it will call the API without credentials, get a 401,
    // and apps/app/actions.ts's resolveSessionExpiredRedirect/handleSessionExpired
    // (BUG-AUTH-STALE-SESSION-001) will call next/navigation's redirect() from inside the
    // action, which Next's own action-handler translates into a proper action-response
    // redirect (x-action-redirect header, no Location, RSC body) instead of a plain 3xx.
    if (isServerActionFetchRequest(request)) {
      return applySecurityHeaders(nextWithHeaders(), nonce);
    }
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.search = "";
    loginUrl.searchParams.set("next", pathname);
    return applySecurityHeaders(NextResponse.redirect(loginUrl), nonce);
  }

  // Skip refresh if: no refresh token available (can't recover), OR access token is valid and not expiring
  if (!refreshToken || (accessToken && !shouldRefresh(accessToken))) {
    return applySecurityHeaders(nextWithHeaders(), nonce);
  }
  // Fall through: refresh token present AND (access token missing OR close to expiry)

  try {
    const refreshResponse = await fetch(`${getApiBaseUrl(request)}/auth/refresh`, {
      method: "POST",
      headers: {
        Cookie: `${REFRESH_COOKIE}=${encodeURIComponent(refreshToken)}`,
      },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!refreshResponse.ok) {
      return applySecurityHeaders(nextWithHeaders(), nonce);
    }

    const payload = (await refreshResponse.json()) as {
      accessToken?: string;
      expiresInSeconds?: number;
    };
    if (!payload.accessToken) {
      return applySecurityHeaders(nextWithHeaders(), nonce);
    }

    const response = nextWithHeaders();
    const secureCookies = useSecureCookies();
    const maxAge = Number.isFinite(payload.expiresInSeconds) ? Number(payload.expiresInSeconds) : 4 * 60 * 60;
    response.cookies.set(ACCESS_COOKIE, payload.accessToken, {
      httpOnly: true,
      secure: secureCookies,
      sameSite: "lax",
      path: "/",
      maxAge,
    });

    response.cookies.set(CSRF_COOKIE, crypto.randomUUID(), {
      httpOnly: false,
      secure: secureCookies,
      sameSite: "lax",
      path: "/",
      maxAge,
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
    return applySecurityHeaders(response, nonce);
  } catch {
    return applySecurityHeaders(nextWithHeaders(), nonce);
  }
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
