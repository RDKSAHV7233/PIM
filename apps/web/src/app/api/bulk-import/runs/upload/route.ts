import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl } from "@/lib/api-base-url";
import { resolveBearerToken, validateCsrf } from "../../../_auth";

export const dynamic = "force-dynamic";

const MAX_FILE_BYTES = 32 * 1024 * 1024;
const MAX_REQUEST_ENVELOPE_BYTES = MAX_FILE_BYTES + 1024 * 1024;
const INCOMPLETE_UPLOAD_MESSAGE =
  "Upload was interrupted before the entire file arrived. Select the file and try again.";

function incompleteUploadResponse() {
  return NextResponse.json(
    {
      code: "UPLOAD_BODY_INCOMPLETE",
      message: INCOMPLETE_UPLOAD_MESSAGE,
    },
    { status: 400 },
  );
}

export async function POST(request: NextRequest) {
  const csrfError = validateCsrf(request);
  if (csrfError) {
    return csrfError;
  }

  const authHeader = resolveBearerToken(request);
  if (!authHeader) {
    return NextResponse.json({ error: "MISSING_AUTH_TOKEN" }, { status: 401 });
  }

  const contentType = request.headers.get("content-type");
  if (!contentType || !contentType.includes("multipart/form-data")) {
    return NextResponse.json({ error: "Content-Type must be multipart/form-data" }, { status: 400 });
  }

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_REQUEST_ENVELOPE_BYTES) {
    return NextResponse.json({ error: "File too large (max 32 MB)" }, { status: 413 });
  }

  let body: ArrayBuffer;
  try {
    body = await request.arrayBuffer();
  } catch {
    return NextResponse.json({ error: "Failed to read request body" }, { status: 400 });
  }

  if (body.byteLength > MAX_REQUEST_ENVELOPE_BYTES) {
    return NextResponse.json({ error: "File too large (max 32 MB)" }, { status: 413 });
  }
  if (contentLength > 0 && body.byteLength < contentLength) {
    return incompleteUploadResponse();
  }

  const response = await fetch(`${getApiBaseUrl()}/bulk-import/runs/upload`, {
    method: "POST",
    headers: {
      Authorization: authHeader,
      Accept: "application/json",
      "Content-Type": contentType,
    },
    body,
    cache: "no-store",
    signal: AbortSignal.timeout(120_000),
  });

  const payload = await response.text();
  if (!response.ok && payload.includes("Unexpected end of form")) {
    return incompleteUploadResponse();
  }
  return new NextResponse(payload, {
    status: response.status,
    headers: {
      "Content-Type": response.headers.get("content-type") ?? "application/json; charset=utf-8",
    },
  });
}
