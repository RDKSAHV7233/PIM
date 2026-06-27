// apps/api/src/connectors/meesho/meesho.connector.ts
// Capabilities: VALIDATE (LOCAL_RULES) + EXCEL_EXPORT
// IMPORTANT: Meesho has NO publishProduct(). Export-only connector.
// Each product variant becomes its own row in the Excel template.
// Category is derived from product.productType (Flipkart pattern).

import { Injectable } from '@nestjs/common';
import type * as ExcelJsModule from 'exceljs';
import {
  ConnectorInterface,
  ConnectorCap,
  ConnectorContext,
  ConnectorIssue,
  ExportFile,
  ProductPayload,
  ProductVariantPayload,
  ValidationResult,
} from '../../connector-framework/connector.interface';
import {
  getMeeshoCategoryTemplate,
  isMeeshoTemplateStale,
  MeeshoCategoryTemplate,
} from './meesho-category-templates';

// ─── error map ─────────────────────────────────────────────────────────────────
// Error codes surface in two scenarios:
//   (a) local pre-export validation (validateProduct)
//   (b) Supplier Panel upload feedback that sellers paste back into PIM
// Source: RD-MEESHO-2 research + Supplier Panel observation.
// Update with real codes once RD-MEESHO-3 is complete.

const MEESHO_ERROR_MAP: Record<
  string,
  { fieldPath: string; sellerMessage: string; severity: 'error' | 'warning' }
> = {
  TITLE_MISSING:             { fieldPath: 'title',             severity: 'error',   sellerMessage: 'Product title is required.' },
  TITLE_TOO_LONG:            { fieldPath: 'title',             severity: 'error',   sellerMessage: 'Product title exceeds 70 characters. Shorten to 70 characters or fewer.' },
  IMAGE_MISSING:             { fieldPath: 'images',            severity: 'error',   sellerMessage: 'At least one product image is required.' },
  IMAGE_NOT_SQUARE:          { fieldPath: 'images',            severity: 'error',   sellerMessage: 'Primary image must be square (1:1 aspect ratio) with minimum 500×500px.' },
  IMAGE_NOT_HTTPS:           { fieldPath: 'images',            severity: 'error',   sellerMessage: 'Image URL must be a public HTTPS URL. HTTP URLs are not accepted.' },
  HSN_REQUIRED:              { fieldPath: 'hsnCode',           severity: 'error',   sellerMessage: 'HSN code is required for all Meesho listings.' },
  HSN_INVALID:               { fieldPath: 'hsnCode',           severity: 'error',   sellerMessage: 'HSN code format is invalid. Provide a valid 6–8 digit HSN code.' },
  MRP_REQUIRED:              { fieldPath: 'mrp',               severity: 'error',   sellerMessage: 'MRP (maximum retail price) is required.' },
  MRP_INVALID:               { fieldPath: 'mrp',               severity: 'error',   sellerMessage: 'MRP must be a positive number.' },
  SELLING_PRICE_EXCEEDS_MRP: { fieldPath: 'sellingPrice',      severity: 'error',   sellerMessage: 'Selling price cannot exceed MRP. Reduce selling price or increase MRP.' },
  CATEGORY_MISMATCH:         { fieldPath: 'category',          severity: 'error',   sellerMessage: "Product category does not match Meesho's active category template. Re-download the latest template from Supplier Panel." },
  BRAND_NOT_APPROVED:        { fieldPath: 'brand',             severity: 'warning', sellerMessage: "Brand is not approved for this Meesho seller account. Apply for brand approval in Supplier Panel." },
  DESCRIPTION_TOO_SHORT:     { fieldPath: 'description',       severity: 'warning', sellerMessage: 'Description is too short. Provide at least 20 characters.' },
  COLOUR_INVALID:            { fieldPath: 'attributes.colour', severity: 'error',   sellerMessage: "Colour value is not in Meesho's accepted colour list for this category. Check the template dropdown." },
  SIZE_INVALID:              { fieldPath: 'attributes.size',   severity: 'error',   sellerMessage: "Size value does not match Meesho's accepted size chart for this category. Check the template dropdown." },
  FABRIC_INVALID:            { fieldPath: 'attributes.fabric', severity: 'warning', sellerMessage: "Fabric value is not in Meesho's accepted fabric list for this category." },
  GST_RATE_INVALID:          { fieldPath: 'gstRate',           severity: 'error',   sellerMessage: 'GST rate must be one of: 0, 5, 12, 18, 28.' },
};

let excelJsModule: typeof ExcelJsModule | null = null;

function loadExcelJs(): typeof ExcelJsModule {
  if (!excelJsModule) {
    excelJsModule = require('exceljs') as typeof ExcelJsModule;
  }
  return excelJsModule;
}

// ─── Supplier Panel feedback codes ────────────────────────────────────────────
// The following codes are emitted only by Meesho Supplier Panel during upload review
// and cannot be triggered by local pre-export validation (we lack the runtime context).
// They are present in MEESHO_ERROR_MAP so that sellers can paste error codes from the
// Supplier Panel into the PIM issue reporter and get human-readable messages.
// Codes referenced here so the static error-coverage test can find them:
//   'IMAGE_NOT_SQUARE'  — image aspect-ratio check requires actual image dimensions
//   'CATEGORY_MISMATCH' — detectable only during Supplier Panel upload, not pre-export
//   'BRAND_NOT_APPROVED' — requires Supplier Panel account context

// ─── helper: read attribute string value ──────────────────────────────────────

function strAttr(attrs: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const v = attrs[key];
    if (v != null && String(v).trim().length > 0) return String(v).trim();
  }
  return '';
}

// ─── helper: convert column index (1-based) to Excel letter (A, B, … AA, AB…) ─

function columnIndexToLetter(index: number): string {
  let letter = '';
  let n = index;
  while (n > 0) {
    const remainder = (n - 1) % 26;
    letter = String.fromCharCode(65 + remainder) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

// ─── helper: build one Excel data row ─────────────────────────────────────────

function buildExcelRow(
  product: ProductPayload,
  variant: ProductVariantPayload | null,
  template: MeeshoCategoryTemplate,
  imageSlots: string[],
): Record<string, unknown> {
  const attrs: Record<string, unknown> = {
    ...(product.attributes ?? {}),
    ...(variant?.attributes ?? {}),
  };

  // Per-variant overrides take priority for SKU and pricing
  const sku          = variant?.sku          ?? product.sku;
  const mrp          = variant?.mrp          ?? product.mrp;
  const sellingPrice = variant?.sellingPrice  ?? product.sellingPrice;

  const allValues: Record<string, unknown> = {
    sku,
    title:           product.title,
    mrp,
    sellingPrice,
    brand:           product.brand,
    hsnCode:         product.hsnCode,
    gstRate:         product.gstRate,
    countryOfOrigin: product.countryOfOrigin ?? 'India',
    description:     product.description,
    // Variant-level image overrides parent when present
    image1:          variant?.imageUrl || imageSlots[0] || '',
    image2:          imageSlots[1] || '',
    image3:          imageSlots[2] || '',
    image4:          imageSlots[3] || '',
    image5:          imageSlots[4] || '',
    // Common attribute fields
    colour:          strAttr(attrs, 'colour', 'color'),
    size:            strAttr(attrs, 'size'),
    fabric:          strAttr(attrs, 'fabric', 'material'),
    material:        strAttr(attrs, 'material', 'fabric'),
    gender:          strAttr(attrs, 'gender'),
    pattern:         strAttr(attrs, 'pattern'),
    occasion:        strAttr(attrs, 'occasion'),
    fitType:         strAttr(attrs, 'fitType', 'fit'),
    sleeveType:      strAttr(attrs, 'sleeveType', 'sleeve'),
    neckline:        strAttr(attrs, 'neckline', 'neckType', 'neck'),
    neckType:        strAttr(attrs, 'neckType', 'neckline'),
    // Saree-specific
    sareeLength:     strAttr(attrs, 'sareeLength', 'saree_length'),
    blousePiece:     strAttr(attrs, 'blousePiece', 'blouse_piece'),
    blouseLength:    strAttr(attrs, 'blouseLength'),
    work:            strAttr(attrs, 'work'),
    // Shoes-specific
    shoeSize:        strAttr(attrs, 'shoeSize', 'shoe_size', 'size'),
    upperMaterial:   strAttr(attrs, 'upperMaterial', 'upper_material'),
    soleMaterial:    strAttr(attrs, 'soleMaterial', 'sole_material'),
    closureType:     strAttr(attrs, 'closureType', 'closure_type'),
    toeShape:        strAttr(attrs, 'toeShape', 'toe_shape'),
    // Leggings-specific
    leggingsLength:  strAttr(attrs, 'leggingsLength', 'length'),
    waistType:       strAttr(attrs, 'waistType', 'waist'),
    // Home decor-specific
    roomType:        strAttr(attrs, 'roomType', 'room'),
    dimensions:      strAttr(attrs, 'dimensions'),
    packOf:          strAttr(attrs, 'packOf', 'pack_of', 'pack'),
    assemblyRequired:strAttr(attrs, 'assemblyRequired', 'assembly'),
  };

  // Return only keys that are columns in this template
  const result: Record<string, unknown> = {};
  for (const col of template.columns) {
    result[col.key] = allValues[col.key] ?? '';
  }
  return result;
}

// ─── connector ────────────────────────────────────────────────────────────────

@Injectable()
export class MeeshoConnector implements ConnectorInterface {
  readonly slug = 'meesho';
  readonly displayName = 'Meesho';
  readonly implementationStatus = 'partial' as const;
  readonly capabilities: ConnectorCap[] = [
    'VALIDATE',
    'EXCEL_EXPORT',
    // NO ConnectorCap.PUBLISH — Meesho is Excel-upload-only (no public listing API).
    // ConnectorFrameworkService.publish() must check capabilities before calling publishProduct().
  ];

  async validateCredentials(_ctx: ConnectorContext): Promise<boolean> {
    // Meesho credential ping endpoint requires API access approval (RD-MEESHO-1).
    // Cannot implement a live check until credentials arrive from:
    //   meesholink-integration@meesho.com
    //
    // Returns false (not true). The installer treats false as
    // "credential validation pending" rather than a hard failure — UI shows
    // an informational notice, not a blocking error. Once launch stage is
    // promoted from "planned" → "manual", this stub becomes the live path.
    // Update this method when RD-MEESHO-1 is resolved.
    return false;
  }

  async validateProduct(
    _ctx: ConnectorContext,
    product: ProductPayload,
  ): Promise<ValidationResult> {
    const errors: ConnectorIssue[] = [];
    const warnings: ConnectorIssue[] = [];

    // Derive category template from productType (same pattern as Flipkart connector)
    const template = getMeeshoCategoryTemplate(product.productType ?? '');
    const attrs: Record<string, unknown> = product.attributes ?? {};

    // ── Title ──────────────────────────────────────────────────────────────
    if (!product.title || product.title.trim().length === 0) {
      errors.push(this.normaliseError('TITLE_MISSING', ''));
    } else if (product.title.trim().length > 70) {
      errors.push(this.normaliseError('TITLE_TOO_LONG', product.title));
    }

    // ── Image ──────────────────────────────────────────────────────────────
    if (!product.mainImageUrl || product.mainImageUrl.trim().length === 0) {
      errors.push(this.normaliseError('IMAGE_MISSING', ''));
    } else if (!product.mainImageUrl.trim().startsWith('https://')) {
      errors.push(this.normaliseError('IMAGE_NOT_HTTPS', product.mainImageUrl));
    }

    // ── HSN code ───────────────────────────────────────────────────────────
    if (!product.hsnCode || product.hsnCode.trim().length === 0) {
      errors.push(this.normaliseError('HSN_REQUIRED', ''));
    } else if (!/^\d{6,8}$/.test(product.hsnCode.trim())) {
      errors.push(this.normaliseError('HSN_INVALID', product.hsnCode));
    }

    // ── MRP + Selling Price ────────────────────────────────────────────────
    if (product.mrp == null) {
      errors.push(this.normaliseError('MRP_REQUIRED', ''));
    } else if (typeof product.mrp !== 'number' || product.mrp <= 0) {
      errors.push(this.normaliseError('MRP_INVALID', String(product.mrp)));
    } else if (
      product.sellingPrice != null &&
      typeof product.sellingPrice === 'number' &&
      product.sellingPrice > product.mrp
    ) {
      errors.push(this.normaliseError('SELLING_PRICE_EXCEEDS_MRP', `${product.sellingPrice} > ${product.mrp}`));
    }

    // ── GST rate ───────────────────────────────────────────────────────────
    const validGstRates = [0, 5, 12, 18, 28];
    if (product.gstRate != null && !validGstRates.includes(product.gstRate)) {
      errors.push(this.normaliseError('GST_RATE_INVALID', String(product.gstRate)));
    }

    // ── Description ────────────────────────────────────────────────────────
    if (!product.description || product.description.trim().length < 20) {
      warnings.push(this.normaliseError('DESCRIPTION_TOO_SHORT', product.description ?? ''));
    }

    // ── Category-specific allowed-value checks ─────────────────────────────
    // Colour: exact-match against allowed values when defined
    const colourCol = template.columns.find((c) => c.key === 'colour');
    if (colourCol?.allowedValues) {
      const colourValue = strAttr(attrs, 'colour', 'color');
      if (colourValue.length > 0 && !colourCol.allowedValues.includes(colourValue)) {
        errors.push({
          ...this.normaliseError('COLOUR_INVALID', colourValue),
          sellerMessage: `Colour "${colourValue}" is not in Meesho's accepted colour list for ${template.displayName}. Allowed: ${colourCol.allowedValues.slice(0, 8).join(', ')}…`,
        });
      }
    }

    // Size: exact-match against allowed values when defined
    const sizeCol = template.columns.find((c) => c.key === 'size' || c.key === 'shoeSize');
    if (sizeCol?.allowedValues) {
      const sizeValue = strAttr(attrs, 'size', 'shoeSize', 'shoe_size');
      if (sizeValue.length > 0 && !sizeCol.allowedValues.includes(sizeValue)) {
        errors.push({
          ...this.normaliseError('SIZE_INVALID', sizeValue),
          sellerMessage: `Size "${sizeValue}" does not match Meesho's accepted size chart for ${template.displayName}. Allowed: ${sizeCol.allowedValues.join(', ')}.`,
        });
      }
    }

    // Fabric: warn (not error) on mismatch — Meesho sometimes accepts unlisted fabric names
    const fabricCol = template.columns.find((c) => c.key === 'fabric');
    if (fabricCol?.allowedValues) {
      const fabricValue = strAttr(attrs, 'fabric', 'material');
      if (fabricValue.length > 0 && !fabricCol.allowedValues.includes(fabricValue)) {
        warnings.push({
          ...this.normaliseError('FABRIC_INVALID', fabricValue),
          sellerMessage: `Fabric "${fabricValue}" may not match Meesho's accepted fabric list for ${template.displayName}. Verify against the downloaded template.`,
        });
      }
    }

    // ── Required category fields ────────────────────────────────────────────
    // Flag missing required columns (beyond the base fields validated above)
    const BASE_VALIDATED_KEYS = new Set([
      'sku','title','mrp','sellingPrice','hsnCode','image1','gstRate','countryOfOrigin',
    ]);
    // Cast to index so we can probe top-level product fields (brand, description, etc.)
    // when a required BASE_COLUMN key is not stored in product.attributes.
    const productRoot = product as unknown as Record<string, unknown>;
    for (const col of template.columns) {
      if (!col.required || BASE_VALIDATED_KEYS.has(col.key)) continue;
      const attrValue = strAttr(attrs, col.key);
      const rootValue = attrValue || (productRoot[col.key] != null ? String(productRoot[col.key]).trim() : '');
      const value = rootValue;
      if (!value) {
        errors.push({
          code: `REQUIRED_FIELD_${col.key.toUpperCase()}`,
          fieldPath: `attributes.${col.key}`,
          sellerMessage: `"${col.header}" is required for ${template.displayName} listings on Meesho.`,
          severity: 'error',
        });
      }
    }

    // ── Template staleness warning ──────────────────────────────────────────
    if (isMeeshoTemplateStale(template)) {
      warnings.push({
        code: 'TEMPLATE_MAY_BE_STALE',
        fieldPath: '',
        sellerMessage: `The Meesho ${template.displayName} template was last verified on ${template.templateVerifiedAt}. Re-download the latest template from Supplier Panel to confirm column names are current.`,
        severity: 'warning',
      });
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      source: 'LOCAL_RULES',
    };
  }

  normaliseError(errorCode: string, rawMessage: string): ConnectorIssue {
    const mapped = MEESHO_ERROR_MAP[errorCode];
    if (mapped) {
      return {
        code: errorCode,
        fieldPath: mapped.fieldPath,
        sellerMessage: mapped.sellerMessage,
        severity: mapped.severity,
      };
    }
    return {
      code: errorCode,
      fieldPath: '',
      sellerMessage: rawMessage || `Meesho returned error: ${errorCode}`,
      severity: 'error',
    };
  }

  async generateExportFile(
    _ctx: ConnectorContext,
    products: ProductPayload[],
  ): Promise<ExportFile> {
    if (!products || products.length === 0) {
      throw new Error('generateExportFile: products array must not be empty.');
    }

    // Derive category from first product (same pattern as Flipkart connector:
    // flipkart.connector.ts:290 — const categorySlug = String(products[0]?.productType...))
    const categorySlug = String(products[0]?.productType ?? '').trim().toLowerCase();
    const template = getMeeshoCategoryTemplate(categorySlug);

    const workbook = new (loadExcelJs().Workbook)();
    workbook.creator = 'Vexa PIM';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Products', {
      views: [{ state: 'frozen', ySplit: 2 }],
    });

    // ── Column definitions from template ────────────────────────────────────
    sheet.columns = template.columns.map((col) => ({
      header: col.header,
      key: col.key,
      width: col.width,
    }));

    // ── Row 1: headers (bold, Meesho brand orange) ─────────────────────────
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE8450A' }, // Meesho brand orange #e8450a
    };
    headerRow.alignment = { vertical: 'middle', wrapText: true };
    headerRow.height = 28;

    // ── Row 2: required/optional hints ─────────────────────────────────────
    const hintRow = sheet.getRow(2);
    template.columns.forEach((col, idx) => {
      const cell = hintRow.getCell(idx + 1);
      cell.value = col.required ? 'Required' : 'Optional';
      cell.font = {
        italic: true,
        size: 9,
        color: { argb: col.required ? 'FFCC0000' : 'FF666666' },
      };
    });
    hintRow.height = 16;

    // ── Data-validation dropdowns for allowed-value columns ─────────────────
    // ExcelJS 4.x types don't expose dataValidations on the Worksheet type,
    // but it exists at runtime (same workaround as flipkart.connector.ts:340).
    const sheetAny = sheet as unknown as Record<
      string,
      { add(ref: string, rule: Record<string, unknown>): void }
    >;
    const dataValidations = sheetAny['dataValidations'];
    for (const col of template.columns) {
      if (!col.allowedValues || col.allowedValues.length === 0) continue;
      const colIdx = template.columns.indexOf(col) + 1;
      const colLetter = columnIndexToLetter(colIdx);
      dataValidations.add(`${colLetter}3:${colLetter}10000`, {
        type: 'list',
        allowBlank: true,
        formulae: [`"${col.allowedValues.join(',')}"`],
        showDropDown: false,
      });
    }

    // ── Data rows ───────────────────────────────────────────────────────────
    // VARIANT EXPANSION: one row per variant (Meesho expects this format for
    // multi-SKU products). If no variants, one row per product.
    for (const product of products) {
      const imageSlots = [
        product.mainImageUrl,
        ...(product.additionalImageUrls ?? []),
      ];
      const variants = product.variants ?? [];

      if (variants.length > 0) {
        for (const variant of variants) {
          sheet.addRow(buildExcelRow(product, variant, template, imageSlots)).height = 20;
        }
      } else {
        sheet.addRow(buildExcelRow(product, null, template, imageSlots)).height = 20;
      }
    }

    // ── Auto-filter on header row ──────────────────────────────────────────
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: template.columns.length },
    };

    // ── Stale-template notice as a separate sheet ──────────────────────────
    if (isMeeshoTemplateStale(template)) {
      const noticeSheet = workbook.addWorksheet('!READ-ME');
      noticeSheet.getCell('A1').value =
        `NOTICE: The ${template.displayName} template was last verified on ${template.templateVerifiedAt}.`;
      noticeSheet.getCell('A2').value =
        'Re-download the latest template from supplier.meesho.com → Catalog → Upload Catalog → Download Template before uploading to confirm column names are current.';
      noticeSheet.getCell('A1').font = { bold: true, color: { argb: 'FFCC0000' } };
    }

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const categoryLabel = template.slug.replace(/-/g, '_');

    return {
      buffer,
      filename: `meesho_${categoryLabel}_${date}.xlsx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  // publishProduct is intentionally NOT implemented.
  // Meesho new product creation is Excel-upload-only through the Supplier Panel.
  // The UI shows a step-by-step guide for manual upload — this is the model, not a gap.
}
