import { NextResponse } from "next/server";

// Flat international tax code columns are optional.
// Leave blank for markets that don't apply to the product.
//   gb_commodity_code  — UK Trade Tariff commodity code (10-digit), e.g. 6204420000
//   ae_hs_code         — UAE HS code (6-digit), e.g. 620442
//   us_tax_category    — Avalara/AvaTax tax category string, e.g. CLOTHING
//   au_commodity_code  — Australia commodity code
// Rate columns (gb_tax_rate, ae_tax_rate, au_tax_rate) are also accepted but rarely needed.
const SAMPLE_CSV = [
  "title,skuCode,description,brand,hsnCode,gstRate,gb_commodity_code,ae_hs_code,us_tax_category,au_commodity_code,status,attributes",
  '"Classic Cotton Tee","TEE-BLK-M","Soft crew-neck t-shirt","Vexa PIM","61091000",12,"6204420000","620442","CLOTHING","62044200","draft","{""material"":""cotton"",""color"":""black"",""size"":""M""}"',
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
