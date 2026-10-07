import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl } from "@/lib/api-base-url";
import { MEDIA_FILE_TOKEN_PATTERN } from "@/lib/media-file-url";

const ASSET_ID_PATTERN = /^[a-z0-9-]{20,50}$/;

const FORWARDED_HEADERS = new Set([
  "content-type",
  "content-length",
  "content-disposition",
  "cache-control",
  "etag",
  "last-modified",
]);

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!ASSET_ID_PATTERN.test(id)) {
    return NextResponse.json({ error: "INVALID_ASSET_ID" }, { status: 400 });
  }

  const apiBase = getApiBaseUrl();
  // SEC-DB-RLS-001 D1: forward the signed token the API's public file route requires once its signing key is configured. Only a
  // well-formed token is forwarded; anything else is dropped rather than passed upstream.
  const rawToken = request.nextUrl.searchParams.get("t") ?? "";
  const token = MEDIA_FILE_TOKEN_PATTERN.test(rawToken) ? rawToken : "";
  const upstream = `${apiBase}/media/assets/${encodeURIComponent(id)}/file${token ? `?t=${encodeURIComponent(token)}` : ""}`;

  const fetchHeaders: Record<string, string> = {};
  const accessToken = request.cookies.get("pim_access_token")?.value;
  if (accessToken) {
    fetchHeaders["Authorization"] = `Bearer ${accessToken}`;
  }

  let response: globalThis.Response;
  try {
    response = await fetch(upstream, { headers: fetchHeaders, redirect: "follow" });
  } catch {
    return NextResponse.json(
      { error: "MEDIA_UPSTREAM_UNREACHABLE" },
      { status: 502 },
    );
  }

  if (!response.ok) {
    return new NextResponse(null, { status: response.status });
  }

  const headers = new Headers();
  for (const name of FORWARDED_HEADERS) {
    const value = response.headers.get(name);
    if (value) {
      headers.set(name, value);
    }
  }

  if (!headers.has("cache-control")) {
    headers.set("Cache-Control", "public, max-age=3600, immutable");
  }

  return new NextResponse(response.body, { status: 200, headers });
}
