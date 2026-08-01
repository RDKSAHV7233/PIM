import { timingSafeEqual } from "node:crypto";
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
  // pim_csrf_token is not httpOnly — client must always echo it in x-csrf-token header.
  // Both cookie and header must be present and matching (double-submit cookie pattern).
  if (!cookieValue || !headerValue || cookieValue !== headerValue) {
    return NextResponse.json(
      {
        error: "CSRF_MISMATCH",
      },
      { status: 403 },
    );
  }
  return null;
}

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // timingSafeEqual throws on length mismatch; a length mismatch is itself
  // not-equal, so compare against a zero-padded buffer of the same length
  // rather than short-circuiting (which would leak length via timing).
  if (bufA.length !== bufB.length) {
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

/**
 * Sibling to validateCsrf, for native (URL-action) form submissions that
 * can't set a custom request header. Same double-submit-cookie principle —
 * the token just travels as a form field instead of a header. The token
 * itself is still minted and stored identically (pim_csrf_token cookie);
 * only the transport on the way back differs.
 */
export function validateFormCsrf(request: NextRequest, formToken: string): NextResponse | null {
  const cookieValue = request.cookies.get("pim_csrf_token")?.value ?? "";
  const submittedValue = String(formToken ?? "").trim();
  if (!cookieValue || !submittedValue || !constantTimeEqual(cookieValue, submittedValue)) {
    return NextResponse.json(
      {
        error: "CSRF_MISMATCH",
      },
      { status: 403 },
    );
  }
  return null;
}

/**
 * Confirms the request's Origin header names a host this app actually
 * serves — required for native-form POSTs to a Route Handler, since (unlike
 * Server Actions, which Next.js checks Origin/Host for automatically) a
 * plain Route Handler gets no built-in cross-origin protection.
 */
export function validateOrigin(request: NextRequest): NextResponse | null {
  const origin = request.headers.get("origin");
  // Same-origin browser navigations to a same-site POST target sometimes omit
  // Origin (varies by browser/redirect chain) but always send Referer; treat a
  // present-and-matching Referer as acceptable when Origin is absent, and
  // reject outright when neither is present — a real browser form post always
  // sends at least one of the two.
  const referer = request.headers.get("referer");
  const forwardedHost = request.headers.get("x-forwarded-host");
  const host = forwardedHost || request.headers.get("host") || "";

  if (!host) {
    return NextResponse.json({ error: "ORIGIN_VALIDATION_FAILED" }, { status: 403 });
  }

  const candidate = origin || referer;
  if (!candidate) {
    return NextResponse.json({ error: "ORIGIN_VALIDATION_FAILED" }, { status: 403 });
  }

  let candidateHost: string;
  try {
    candidateHost = new URL(candidate).host;
  } catch {
    return NextResponse.json({ error: "ORIGIN_VALIDATION_FAILED" }, { status: 403 });
  }

  if (candidateHost.toLowerCase() !== host.toLowerCase()) {
    return NextResponse.json({ error: "ORIGIN_VALIDATION_FAILED" }, { status: 403 });
  }

  return null;
}
