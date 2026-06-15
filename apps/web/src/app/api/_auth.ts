import { NextRequest, NextResponse } from "next/server";

export function resolveBearerToken(request: NextRequest): string | null {
  const cookieToken = request.cookies.get("pim_access_token")?.value;
  if (cookieToken) {
    return `Bearer ${cookieToken}`;
  }
  return null;
}

export function validateCsrf(request: NextRequest): NextResponse | null {
  const cookieValue = request.cookies.get("pim_csrf_token")?.value ?? "";
  const headerValue = request.headers.get("x-csrf-token") ?? "";
  // Require either:
  // 1. Both cookie and header present and matching (double-submit), OR
  // 2. Cookie present alone (client can't read httpOnly cookie, so no header)
  if (!cookieValue) {
    return NextResponse.json(
      {
        error: "CSRF_MISMATCH",
      },
      { status: 403 },
    );
  }
  if (headerValue && cookieValue !== headerValue) {
    return NextResponse.json(
      {
        error: "CSRF_MISMATCH",
      },
      { status: 403 },
    );
  }
  return null;
}
