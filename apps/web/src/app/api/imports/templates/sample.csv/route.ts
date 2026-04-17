import { NextResponse } from "next/server";

const SAMPLE_CSV = [
  "title,description,brand,hsnCode,gstRate,status,attributes",
  "\"Classic Cotton Tee\",\"Soft crew-neck t-shirt\",\"Vexa PIM\",\"61091000\",12,\"draft\",\"{\"\"material\"\":\"\"cotton\"\",\"\"color\"\":\"\"black\"\",\"\"size\"\":\"\"M\"\"}\"",
].join("\n");

export async function GET() {
  return new NextResponse(SAMPLE_CSV, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="vexa-pim-bulk-import-sample.csv"',
      "Cache-Control": "no-store",
    },
  });
}
