import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl } from "@/lib/api-base-url";
import { resolveBearerToken } from "../../../api/_auth";

interface RouteContext {
  params: Promise<{
    installationId: string;
  }>;
}

const RESULT_HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Cache-Control": "no-store",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy": "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
} as const;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderPage(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 32rem; margin: 4rem auto; padding: 0 1.5rem; color: #1e293b; }
  h1 { font-size: 1.25rem; }
  dl { margin: 1.5rem 0; }
  dt { font-size: 0.75rem; text-transform: uppercase; color: #64748b; margin-top: 0.75rem; }
  dd { margin: 0; font-size: 1rem; }
  a { color: #4338ca; }
</style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

/**
 * Shell-independent result page for the native-form Disable action — a
 * plain Route Handler returning raw HTML, not a Next.js page. It never
 * mounts AuthenticatedShell/AppSidebar/NotificationCenter and never runs
 * through React hydration, so the outcome is visible even if the app's
 * shared-shell hydration race (see the PR416 investigation) strikes.
 *
 * Deliberately does not trust ?status=disabled or any other URL param —
 * re-queries the installation's authoritative current status from the API
 * on every load.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const authHeader = resolveBearerToken(request);
  if (!authHeader) {
    return NextResponse.redirect(new URL("/login", request.url), { status: 303 });
  }

  const { installationId } = await context.params;

  const apiResponse = await fetch(`${getApiBaseUrl()}/connectors/installed/${encodeURIComponent(installationId)}`, {
    method: "GET",
    headers: {
      Authorization: authHeader,
      Accept: "application/json",
    },
    cache: "no-store",
    signal: AbortSignal.timeout(15_000),
  });

  if (apiResponse.status === 404) {
    return new NextResponse(
      renderPage(
        "Connector not found",
        `<h1>Connector not found</h1>
<p>This installation no longer exists, or you don't have access to it.</p>
<p><a href="/channels/connectors">Back to Connectors</a></p>`,
      ),
      { status: 404, headers: RESULT_HEADERS },
    );
  }

  if (!apiResponse.ok) {
    return new NextResponse(
      renderPage(
        "Unable to load result",
        `<h1>Unable to load result</h1>
<p>The disable request may have gone through — check the Connectors page for the current status.</p>
<p><a href="/channels/connectors">Back to Connectors</a></p>`,
      ),
      { status: 502, headers: RESULT_HEADERS },
    );
  }

  const installation = (await apiResponse.json()) as {
    id: string;
    slug: string;
    displayName: string;
    accountAlias: string;
    status: string;
  };

  const isDisabled = String(installation.status ?? "").trim().toUpperCase() === "DISABLED";
  const heading = isDisabled ? "Connector disabled successfully" : "Connector is not disabled";

  return new NextResponse(
    renderPage(
      heading,
      `<h1>${escapeHtml(heading)}</h1>
<dl>
  <dt>Connector</dt>
  <dd>${escapeHtml(installation.displayName ?? installation.slug)}</dd>
  <dt>Installation</dt>
  <dd>${escapeHtml(installation.accountAlias ?? installation.id)}</dd>
  <dt>Current status</dt>
  <dd>${escapeHtml(installation.status ?? "UNKNOWN")}</dd>
</dl>
<p><a href="/channels/connectors">Back to Connectors</a></p>`,
    ),
    { status: 200, headers: RESULT_HEADERS },
  );
}
