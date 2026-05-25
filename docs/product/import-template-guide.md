---
title: Import Template Guide
audience: sellers
status: active
last_updated: 2026-05-26
owner: Product
---

Use this guide to prepare your product data file for import into Vexa PIM. A correctly structured file means fewer errors and faster processing.

## 1. Supported Formats

| Format | Standard mode | Large file mode |
|--------|--------------|-----------------|
| CSV | Up to 10,000 rows | 10,001–30,000 rows |
| XLSX | Up to 10,000 rows | Not supported |
| JSON | Up to 10,000 rows | Not supported |

Imports above 30,000 rows are blocked. Split large catalogs into multiple files.

---

## 2. Required Columns

Every import file must include these columns. Rows missing required columns are rejected.

| Column name | Accepted aliases | Format | Example |
|-------------|-----------------|--------|---------|
| `title` | `name`, `product_name`, `item_name` | Text, max 500 chars | `Classic Cotton Kurta` |
| `category` | `category_id`, `categoryPath` | Vexa category path or ID | `Apparel/Men/Kurtas` |
| `hsnCode` | `hsn`, `hsn_code`, `tax_code` | 4–8 digit string | `62034200` |
| `gstRate` | `gst`, `gst_rate`, `gstrate` | Number (%) | `12` |
| `skuCode` | `sku`, `sku_code` | Alphanumeric, unique per workspace | `KUR-001-RED-M` |

---

## 3. Optional Columns

Include these to enrich your products during import.

| Column name | Format | Notes |
|-------------|--------|-------|
| `brand` | `brand_name`, `maker` | Text |
| `description` | Text | Product description; HTML stripped |
| `mrp` | Number | Maximum retail price in INR (no currency symbol) |
| `sellingPrice` | Number | Selling price in INR |
| `inventoryQty` | Integer | Stock quantity |
| `imageUrl` | Comma-separated URLs | Public image URLs; Vexa downloads and stores them |

Any additional columns not listed above are stored as product `attributes` and can be mapped to channel fields later.

---

## 4. CSV Formatting Rules

- Encoding: UTF-8 (no BOM)
- Delimiter: comma `,` (semicolons not supported)
- Header row: required on row 1 — matches column names case-insensitively
- Quotes: enclose fields with commas or line breaks in double quotes `"`
- Date format: `YYYY-MM-DD` for any date fields

---

## 5. Large File Mode (10,001–30,000 rows)

Large file mode applies automatically when your CSV exceeds 10,000 rows. It is CSV-only.

Rules for large file mode:
- Maximum file size: 32 MB
- Maximum rows: 30,000
- Processing: server-side validation → batched in 1,000-row background jobs
- Progress: one parent import run in **Operations → Imports**; do not manage child batches directly
- Error report: download one combined report for the full run after completion

If your file exceeds 30,000 rows, split it before uploading.

---

## 6. Common Errors and Fixes

| Error | Cause | Fix |
|-------|-------|-----|
| `hsnCode: required` | Missing or blank HSN column | Add `hsnCode` column with 4–8 digit values |
| `gstRate: must be a number` | GST rate includes `%` symbol | Remove the `%` and enter only the number |
| `skuCode: duplicate` | Same SKU appears twice in the file | Deduplicate before upload |
| `category: not found` | Category path does not match any existing category | Check **Catalog → Categories** for the exact path |
| `File exceeds 32 MB` | File too large for large file mode | Compress data or split into multiple files |
| `Rows exceed 30,000` | File is above the row ceiling | Split file and upload in multiple runs |
| `XLSX large import not supported` | Trying to use large file mode with XLSX | Convert to CSV first |

---

## 7. Downloadable Template

A blank CSV template with the correct headers is available from the import page:

**Operations → Imports → New Import → Download template**

The template is pre-populated with the required columns and two example rows.
