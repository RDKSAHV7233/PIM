import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      error: "ENDPOINT_DEPRECATED",
      message: "This endpoint is deprecated. Use the staged upload flow: POST /api/bulk-import/runs/upload, then POST /api/bulk-import/runs/:id/validate.",
    },
    { status: 410 },
  );
}
