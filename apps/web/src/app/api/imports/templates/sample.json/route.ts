import { NextResponse } from "next/server";

const SAMPLE_JSON = [
  {
    title: "Classic Cotton Tee",
    description: "Soft crew-neck t-shirt",
    brand: "Vexa PIM",
    hsnCode: "61091000",
    gstRate: 12,
    // International tax codes are optional — include only markets you sell in.
    // regimeKey: "GB" | "AE" | "US" | "AU"
    // key: "COMMODITY_CODE" (GB/AU) | "HS_CODE" (AE) | "TAX_CATEGORY" (US)
    taxCodes: [
      { regimeKey: "GB", key: "COMMODITY_CODE", value: "6204420000" },
      { regimeKey: "AE", key: "HS_CODE", value: "620442" },
      { regimeKey: "US", key: "TAX_CATEGORY", value: "CLOTHING" },
      { regimeKey: "AU", key: "COMMODITY_CODE", value: "62044200" },
    ],
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
      "Content-Disposition": 'attachment; filename="vexa-pim-bulk-import-sample.json"',
      "Cache-Control": "no-store",
    },
  });
}
