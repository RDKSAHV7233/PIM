import { NextRequest, NextResponse } from "next/server";
import { validateOrigin } from "../../../_auth";
import { forwardBrowserErrorToAuthority } from "@/lib/server/browser-error-capture";

export async function POST(request: NextRequest) {
  const originError = validateOrigin(request);
  if (originError) {
    return originError;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  await forwardBrowserErrorToAuthority(body);
  return NextResponse.json({ accepted: true }, { status: 202 });
}
