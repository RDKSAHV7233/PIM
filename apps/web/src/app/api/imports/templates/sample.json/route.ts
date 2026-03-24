import { NextResponse } from "next/server";

const SAMPLE_JSON = [
  {
    title: "Classic Cotton Tee",
    description: "Soft crew-neck t-shirt",
    brand: "TEJ PIM",
    hsnCode: "61091000",
    gstRate: 12,
    status: "draft",
    attributes: {
      material: "cotton",
      color: "black",
      size: "M",
    },
  },
];

export async function GET() {
  return NextResponse.json(SAMPLE_JSON, {
    status: 200,
    headers: {
      "Content-Disposition": 'attachment; filename="tej-pim-bulk-import-sample.json"',
      "Cache-Control": "no-store",
    },
  });
}
