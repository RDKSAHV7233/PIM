// apps/api/src/connectors/nykaa/nykaa.connector.ts
//
// Capabilities: VALIDATE + EXCEL_EXPORT
// implementationStatus: partial
//
// Nykaa v1 is an export-only connector — no live API publish.
// Product catalog is submitted as a category-specific XLSX file,
// uploaded manually by the seller at seller.nykaa.com →
// Catalogue Management → Catalogue Upload.
//
// Nykaa v2 (direct API push) is gated on Nykaa issuing
// API Username / Password / Seller ID to Vexa as a platform partner
// (same external-dependency class as RD-MEESHO-1).
//
// Category templates in nykaa-category-templates.ts are indicative.
// PO must verify against real templates downloaded from seller.nykaa.com
// before enabling this connector for production sellers (gate ST-NYKAA-001).

import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import {
  ConnectorCap,
  ConnectorContext,
  ConnectorInterface,
  ConnectorIssue,
  ExportFile,
  ProductPayload,
  ProductVariantPayload,
  ValidationResult,
} from '../../connector-framework/connector.interface';
import {
  getNykaaCategoryTemplate,
  isNykaaTemplateStale,
  NykaaCategoryTemplate,
} from './nykaa-category-templates';

// ─── error map ────────────────────────────────────────────────────────────────

const NYKAA_ERROR_MAP: Record<string, { fieldPath: string; sellerMessage: string; severity: 'error' | 'warning' }> = {
  TITLE_MISSING:             { fieldPath: 'title',             severity: 'error',   sellerMessage: 'Product name is required.' },
  TITLE_TOO_LONG:            { fieldPath: 'title',             severity: 'error',   sellerMessage: 'Product name exceeds 255 characters.' },
  IMAGE_MISSING:             { fieldPath: 'images',            severity: 'error',   sellerMessage: 'At least one product image URL is required.' },
  IMAGE_NOT_HTTPS:           { fieldPath: 'images',            severity: 'error',   sellerMessage: 'Image URL must be a public HTTPS URL.' },
  HSN_REQUIRED:              { fieldPath: 'hsnCode',           severity: 'error',   sellerMessage: 'HSN code is required for all Nykaa listings.' },
  HSN_INVALID:               { fieldPath: 'hsnCode',           severity: 'error',   sellerMessage: 'HSN code must be 6–8 digits.' },
  MRP_REQUIRED:              { fieldPath: 'mrp',               severity: 'error',   sellerMessage: 'MRP is required.' },
  MRP_INVALID:               { fieldPath: 'mrp',               severity: 'error',   sellerMessage: 'MRP must be a positive number.' },
  SELLING_PRICE_EXCEEDS_MRP: { fieldPath: 'sellingPrice',      severity: 'error',   sellerMessage: 'Selling price cannot exceed MRP.' },
  BRAND_REQUIRED:            { fieldPath: 'brand',             severity: 'error',   sellerMessage: 'Brand is required.' },
  DESCRIPTION_REQUIRED:      { fieldPath: 'description',       severity: 'error',   sellerMessage: 'Product description is required.' },
  SHELF_LIFE_REQUIRED:       { fieldPath: 'attributes.shelfLife', severity: 'error', sellerMessage: 'Shelf life (months) is required for beauty and personal care products on Nykaa.' },
  NET_WEIGHT_REQUIRED:       { fieldPath: 'attributes.netWeight', severity: 'error', sellerMessage: 'Net weight or volume is required.' },
  GST_RATE_INVALID:          { fieldPath: 'gstRate',           severity: 'error',   sellerMessage: 'GST rate must be one of: 0, 5, 12, 18, 28.' },
  CATEGORY_MISMATCH:         { fieldPath: 'category',          severity: 'warning', sellerMessage: 'Product category does not map to a known Nykaa template. Verify the downloaded template matches your category.' },
  TEMPLATE_MAY_BE_STALE:     { fieldPath: '',                  severity: 'warning', sellerMessage: 'The Nykaa category template may be outdated. Re-download from seller.nykaa.com before uploading.' },
};

// ─── helper: read attribute string ────────────────────────────────────────────

function strAttr(attrs: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const v = attrs[key];
    if (v != null && String(v).trim().length > 0) return String(v).trim();
  }
  return '';
}

// ─── helper: column index to Excel letter ─────────────────────────────────────

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

// ─── helper: build one data row ───────────────────────────────────────────────

function buildExcelRow(
  product: ProductPayload,
  variant: ProductVariantPayload | null,
  template: NykaaCategoryTemplate,
  imageSlots: string[],
): Record<string, unknown> {
  const attrs: Record<string, unknown> = {
    ...(product.attributes ?? {}),
    ...(variant?.attributes ?? {}),
  };

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
    image1:          variant?.imageUrl || imageSlots[0] || '',
    image2:          imageSlots[1] || '',
    image3:          imageSlots[2] || '',
    image4:          imageSlots[3] || '',
    image5:          imageSlots[4] || '',
    // Beauty-specific
    shadeName:       strAttr(attrs, 'shadeName', 'shade', 'shade_name'),
    shadeNumber:     strAttr(attrs, 'shadeNumber', 'shade_number'),
    finish:          strAttr(attrs, 'finish'),
    coverage:        strAttr(attrs, 'coverage'),
    skinType:        strAttr(attrs, 'skinType', 'skin_type'),
    hairType:        strAttr(attrs, 'hairType', 'hair_type'),
    formulation:     strAttr(attrs, 'formulation'),
    spf:             strAttr(attrs, 'spf', 'SPF'),
    keyIngredients:  strAttr(attrs, 'keyIngredients', 'key_ingredients'),
    netWeight:       strAttr(attrs, 'netWeight', 'net_weight', 'weight', 'volume'),
    shelfLife:       strAttr(attrs, 'shelfLife', 'shelf_life'),
    fragrance:       strAttr(attrs, 'fragrance'),
    productSubtype:  strAttr(attrs, 'productSubtype', 'product_subtype', 'productType'),
  };

  const result: Record<string, unknown> = {};
  for (const col of template.columns) {
    result[col.key] = allValues[col.key] ?? '';
  }
  return result;
}

// ─── connector ────────────────────────────────────────────────────────────────

@Injectable()
export class NykaaConnector implements ConnectorInterface {
  readonly slug = 'nykaa';
  readonly displayName = 'Nykaa';
  readonly implementationStatus = 'partial' as const;
  readonly capabilities: ConnectorCap[] = [
    'VALIDATE',
    'EXCEL_EXPORT',
    // NO PUBLISH — Nykaa v1 is portal-upload only.
    // v2 (direct API push) requires Nykaa to issue API credentials to Vexa as a
    // platform partner. Promote to PUBLISH only when that partnership is confirmed.
  ];

  async validateCredentials(_ctx: ConnectorContext): Promise<boolean> {
    // Nykaa v1 has no API credentials to validate — portal-only onboarding.
    // The UI shows a "manual upload" notice rather than a credential-entry form.
    // Update this method and return true when Nykaa v2 API credentials arrive.
    return false;
  }

  async validateProduct(
    _ctx: ConnectorContext,
    product: ProductPayload,
  ): Promise<ValidationResult> {
    const errors: ConnectorIssue[] = [];
    const warnings: ConnectorIssue[] = [];

    const template = getNykaaCategoryTemplate(product.productType ?? '');
    const attrs: Record<string, unknown> = product.attributes ?? {};

    // ── Title ──────────────────────────────────────────────────────────────────
    if (!product.title || product.title.trim().length === 0) {
      errors.push(this.normaliseError('TITLE_MISSING', ''));
    } else if (product.title.trim().length > 255) {
      errors.push(this.normaliseError('TITLE_TOO_LONG', product.title));
    }

    // ── Brand ──────────────────────────────────────────────────────────────────
    if (!product.brand || product.brand.trim().length === 0) {
      errors.push(this.normaliseError('BRAND_REQUIRED', ''));
    }

    // ── Description ────────────────────────────────────────────────────────────
    if (!product.description || product.description.trim().length === 0) {
      errors.push(this.normaliseError('DESCRIPTION_REQUIRED', ''));
    }

    // ── Image ──────────────────────────────────────────────────────────────────
    if (!product.mainImageUrl || product.mainImageUrl.trim().length === 0) {
      errors.push(this.normaliseError('IMAGE_MISSING', ''));
    } else if (!product.mainImageUrl.trim().startsWith('https://')) {
      errors.push(this.normaliseError('IMAGE_NOT_HTTPS', product.mainImageUrl));
    }

    // ── HSN code ───────────────────────────────────────────────────────────────
    if (!product.hsnCode || product.hsnCode.trim().length === 0) {
      errors.push(this.normaliseError('HSN_REQUIRED', ''));
    } else if (!/^\d{6,8}$/.test(product.hsnCode.trim())) {
      errors.push(this.normaliseError('HSN_INVALID', product.hsnCode));
    }

    // ── MRP + selling price ────────────────────────────────────────────────────
    if (product.mrp == null) {
      errors.push(this.normaliseError('MRP_REQUIRED', ''));
    } else if (typeof product.mrp !== 'number' || product.mrp <= 0) {
      errors.push(this.normaliseError('MRP_INVALID', String(product.mrp)));
    } else if (
      typeof product.sellingPrice === 'number' &&
      product.sellingPrice > product.mrp
    ) {
      errors.push(this.normaliseError('SELLING_PRICE_EXCEEDS_MRP', `${product.sellingPrice} > ${product.mrp}`));
    }

    // ── GST rate ───────────────────────────────────────────────────────────────
    const validGstRates = [0, 5, 12, 18, 28];
    if (product.gstRate != null && !validGstRates.includes(product.gstRate)) {
      errors.push(this.normaliseError('GST_RATE_INVALID', String(product.gstRate)));
    }

    // ── Beauty-specific required fields ────────────────────────────────────────
    if (!strAttr(attrs, 'shelfLife', 'shelf_life')) {
      errors.push(this.normaliseError('SHELF_LIFE_REQUIRED', ''));
    }
    if (!strAttr(attrs, 'netWeight', 'net_weight', 'weight', 'volume')) {
      errors.push(this.normaliseError('NET_WEIGHT_REQUIRED', ''));
    }

    // ── Required template columns beyond base fields ───────────────────────────
    const BASE_VALIDATED_KEYS = new Set([
      'sku', 'title', 'mrp', 'sellingPrice', 'brand', 'hsnCode',
      'gstRate', 'countryOfOrigin', 'description', 'image1',
      'shelfLife', 'netWeight',
    ]);
    for (const col of template.columns) {
      if (!col.required || BASE_VALIDATED_KEYS.has(col.key)) continue;
      const value = strAttr(attrs, col.key);
      if (!value) {
        errors.push({
          code: `REQUIRED_FIELD_${col.key.toUpperCase()}`,
          fieldPath: `attributes.${col.key}`,
          sellerMessage: `"${col.header}" is required for ${template.displayName} listings on Nykaa.`,
          severity: 'error',
        });
      } else if (col.allowedValues && !col.allowedValues.includes(value)) {
        warnings.push({
          code: `ATTRIBUTE_VALUE_NOT_ALLOWED_${col.key.toUpperCase()}`,
          fieldPath: `attributes.${col.key}`,
          sellerMessage: `"${value}" may not be an accepted value for "${col.header}" on Nykaa. Check the downloaded template.`,
          severity: 'warning',
        });
      }
    }

    // ── Template staleness warning ─────────────────────────────────────────────
    if (isNykaaTemplateStale(template)) {
      warnings.push({
        code: 'TEMPLATE_MAY_BE_STALE',
        fieldPath: '',
        sellerMessage: `The Nykaa ${template.displayName} template was last verified on ${template.templateVerifiedAt}. Re-download from seller.nykaa.com before uploading.`,
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
    const mapped = NYKAA_ERROR_MAP[errorCode];
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
      sellerMessage: rawMessage || `Nykaa returned error: ${errorCode}`,
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

    const categorySlug = String(products[0]?.productType ?? '').trim().toLowerCase();
    const template = getNykaaCategoryTemplate(categorySlug);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Vexa PIM';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Products', {
      views: [{ state: 'frozen', ySplit: 2 }],
    });

    sheet.columns = template.columns.map((col) => ({
      header: col.header,
      key: col.key,
      width: col.width,
    }));

    // ── Header row — Nykaa brand pink ──────────────────────────────────────────
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFC2779' }, // Nykaa brand pink #fc2779
    };
    headerRow.alignment = { vertical: 'middle', wrapText: true };
    headerRow.height = 28;

    // ── Hint row — required / optional ────────────────────────────────────────
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

    // ── Data-validation dropdowns ──────────────────────────────────────────────
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

    // ── Data rows (one row per variant; fallback to one row per product) ───────
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

    // ── Auto-filter ────────────────────────────────────────────────────────────
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: template.columns.length },
    };

    // ── Stale-template notice sheet ────────────────────────────────────────────
    if (isNykaaTemplateStale(template)) {
      const noticeSheet = workbook.addWorksheet('!READ-ME');
      noticeSheet.getCell('A1').value =
        `NOTICE: The ${template.displayName} template was last verified on ${template.templateVerifiedAt}.`;
      noticeSheet.getCell('A2').value =
        'Re-download the latest template from seller.nykaa.com → Catalogue Management → Catalogue Upload → Download Template before uploading.';
      noticeSheet.getCell('A1').font = { bold: true, color: { argb: 'FFCC0000' } };
    }

    // ── Upload guidance sheet ──────────────────────────────────────────────────
    const guideSheet = workbook.addWorksheet('Upload Guide');
    const guideLines = [
      ['Step', 'Action'],
      ['1', 'Log in to seller.nykaa.com with your seller account credentials.'],
      ['2', 'Go to Catalogue Management → Catalogue Upload.'],
      ['3', 'Select your category and download the official Nykaa template.'],
      ['4', 'Copy the data rows from this file into the official Nykaa template.'],
      ['5', 'Upload the completed official template on the Nykaa portal.'],
      ['6', 'Wait 7–10 business days for Nykaa QC approval.'],
      ['7', 'Mark this submission as EXTERNALLY_SUBMITTED in Vexa PIM.'],
    ];
    guideLines.forEach(([step, action]) => {
      guideSheet.addRow([step, action]);
    });
    guideSheet.getRow(1).font = { bold: true };
    guideSheet.columns = [{ width: 8 }, { width: 80 }];

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    const categoryLabel = template.slug.replace(/-/g, '_');

    return {
      buffer,
      filename: `nykaa_${categoryLabel}_${date}.xlsx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  // publishProduct is intentionally NOT implemented.
  // Nykaa v1 catalog submission is portal-upload only.
  // v2 API push requires Nykaa to grant platform-partner API credentials to Vexa.
}
