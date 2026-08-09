import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl } from "@/lib/api-base-url";

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
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  if (!ASSET_ID_PATTERN.test(id)) {
    return NextResponse.json({ error: "INVALID_ASSET_ID" }, { status: 400 });
  }

  const apiBase = getApiBaseUrl();
  const upstream = `${apiBase}/media/assets/${encodeURIComponent(id)}/file`;

  let response: globalThis.Response;
  try {
    response = await fetch(upstream, { redirect: "follow" });
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
