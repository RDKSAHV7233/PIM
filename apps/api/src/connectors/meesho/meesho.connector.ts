// apps/api/src/connectors/meesho/meesho.connector.ts
// P5-S3 (local validation) + P5-S4 (Excel export) — implemented.
// IMPORTANT: Meesho has NO publishProduct(). Export-only connector.
// See RD_CONNECTORS.md §Meesho for all R&D requirements

import { Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import {
  ConnectorInterface,
  ConnectorCap,
  ConnectorContext,
  ConnectorIssue,
  ExportFile,
  ProductPayload,
  ValidationResult,
} from '../../connector-framework/connector.interface';

// Meesho errors surface in Excel upload feedback columns, not live API responses.
// Error codes follow the pattern in Supplier Panel upload result sheets.
const MEESHO_ERROR_MAP: Record<string, { fieldPath: string; sellerMessage: string; severity: 'error' | 'warning' }> = {
  'TITLE_TOO_LONG':        { fieldPath: 'title',             sellerMessage: 'Product title exceeds 70 characters. Shorten to 70 characters or fewer.',                                                              severity: 'error' },
  'IMAGE_NOT_SQUARE':      { fieldPath: 'images',            sellerMessage: 'Primary image must be square (1:1 aspect ratio) with minimum 500×500px.',                                                               severity: 'error' },
  'IMAGE_MISSING':         { fieldPath: 'images',            sellerMessage: 'At least one product image is required.',                                                                                                 severity: 'error' },
  'HSN_REQUIRED':          { fieldPath: 'hsnCode',           sellerMessage: 'HSN code is required for all Meesho listings.',                                                                                          severity: 'error' },
  'HSN_INVALID':           { fieldPath: 'hsnCode',           sellerMessage: 'HSN code format is invalid. Provide a valid 6–8 digit HSN code.',                                                                       severity: 'error' },
  'MRP_REQUIRED':          { fieldPath: 'mrp',               sellerMessage: 'MRP (maximum retail price) is required.',                                                                                                severity: 'error' },
  'MRP_INVALID':           { fieldPath: 'mrp',               sellerMessage: 'MRP must be a positive number.',                                                                                                         severity: 'error' },
  'CATEGORY_MISMATCH':     { fieldPath: 'category',          sellerMessage: "Product category does not match Meesho's active category template. Re-download the latest template from Supplier Panel.",               severity: 'error' },
  'BRAND_NOT_APPROVED':    { fieldPath: 'brand',             sellerMessage: "Brand is not approved for this Meesho seller account. Apply for brand approval in Supplier Panel.",                                     severity: 'warning' },
  'DESCRIPTION_TOO_SHORT': { fieldPath: 'description',       sellerMessage: 'Description is too short. Provide at least 20 characters.',                                                                             severity: 'warning' },
  'COLOUR_INVALID':        { fieldPath: 'attributes.colour', sellerMessage: "Colour value is not in Meesho's accepted colour list for this category.",                                                               severity: 'warning' },
  'SIZE_INVALID':          { fieldPath: 'attributes.size',   sellerMessage: "Size value does not match Meesho's accepted size chart for this category.",                                                             severity: 'warning' },
};

// Standard Meesho template columns (general template; category-specific templates may add
// additional columns — verify against the downloaded template from Supplier Panel).
const MEESHO_COLUMNS: Array<{ header: string; key: string; width: number }> = [
  { header: 'SKU ID',            key: 'sku',            width: 20 },
  { header: 'Product Name',      key: 'title',          width: 50 },
  { header: 'Brand',             key: 'brand',          width: 20 },
  { header: 'Category',          key: 'productType',    width: 25 },
  { header: 'MRP',               key: 'mrp',            width: 12 },
  { header: 'Selling Price',     key: 'sellingPrice',   width: 14 },
  { header: 'HSN Code',          key: 'hsnCode',        width: 14 },
  { header: 'GST Rate (%)',      key: 'gstRate',        width: 13 },
  { header: 'Description',       key: 'description',    width: 60 },
  { header: 'Colour',            key: 'colour',         width: 15 },
  { header: 'Size',              key: 'size',           width: 10 },
  { header: 'Material',          key: 'material',       width: 20 },
  { header: 'Country of Origin', key: 'countryOfOrigin',width: 18 },
  { header: 'Image URL 1',       key: 'image1',         width: 60 },
  { header: 'Image URL 2',       key: 'image2',         width: 60 },
  { header: 'Image URL 3',       key: 'image3',         width: 60 },
  { header: 'Image URL 4',       key: 'image4',         width: 60 },
  { header: 'Image URL 5',       key: 'image5',         width: 60 },
];

function strAttr(attrs: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const v = attrs[key];
    if (v != null && String(v).trim().length > 0) return String(v).trim();
  }
  return '';
}

@Injectable()
export class MeeshoConnector implements ConnectorInterface {
  readonly slug = 'meesho';
  readonly displayName = 'Meesho';
  readonly implementationStatus = 'partial' as const;
  readonly capabilities: ConnectorCap[] = [
    'VALIDATE',
    'EXCEL_EXPORT',
    // NO ConnectorCap.PUBLISH — Meesho is Excel-upload-only
    // ConnectorFrameworkService.publish() must check capabilities before calling publishProduct()
  ];

  async validateCredentials(_ctx: ConnectorContext): Promise<boolean> {
    // P5-S3 note: Meesho credential ping endpoint is not public. A live check requires
    // onboarding approval from meesholink-integration@meesho.com (1-2 week lead time).
    // See RD_CONNECTORS.md §Meesho.1
    return true;
  }

  async validateProduct(
    _ctx: ConnectorContext,
    product: ProductPayload,
  ): Promise<ValidationResult> {
    const errors: ConnectorIssue[] = [];
    const warnings: ConnectorIssue[] = [];

    // Title: max 70 characters
    if (!product.title || product.title.trim().length === 0) {
      errors.push(this.normaliseError('TITLE_TOO_LONG', 'Title is required.'));
    } else if (product.title.trim().length > 70) {
      errors.push(this.normaliseError('TITLE_TOO_LONG', product.title));
    }

    // At least one image required
    if (!product.mainImageUrl || product.mainImageUrl.trim().length === 0) {
      errors.push(this.normaliseError('IMAGE_MISSING', 'mainImageUrl is missing.'));
    }

    // HSN code required; must be 6–8 digits
    if (!product.hsnCode || product.hsnCode.trim().length === 0) {
      errors.push(this.normaliseError('HSN_REQUIRED', 'hsnCode is missing.'));
    } else if (!/^\d{6,8}$/.test(product.hsnCode.trim())) {
      errors.push(this.normaliseError('HSN_INVALID', product.hsnCode));
    }

    // MRP required and positive
    if (product.mrp == null) {
      errors.push(this.normaliseError('MRP_REQUIRED', 'mrp is missing.'));
    } else if (typeof product.mrp !== 'number' || product.mrp <= 0) {
      errors.push(this.normaliseError('MRP_INVALID', String(product.mrp)));
    }

    // Description: at least 20 chars (warning)
    if (!product.description || product.description.trim().length < 20) {
      warnings.push(this.normaliseError('DESCRIPTION_TOO_SHORT', product.description ?? ''));
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
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Vexa PIM';
    workbook.created = new Date();

    const sheet = workbook.addWorksheet('Products');
    sheet.columns = MEESHO_COLUMNS;

    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFE0CC' },
    };

    for (const product of products) {
      const attrs = product.attributes ?? {};
      const images = [product.mainImageUrl, ...(product.additionalImageUrls ?? [])];

      sheet.addRow({
        sku:            product.sku,
        title:          product.title,
        brand:          product.brand,
        productType:    product.productType,
        mrp:            product.mrp,
        sellingPrice:   product.sellingPrice,
        hsnCode:        product.hsnCode,
        gstRate:        product.gstRate,
        description:    product.description,
        colour:         strAttr(attrs, 'colour', 'color'),
        size:           strAttr(attrs, 'size'),
        material:       strAttr(attrs, 'material'),
        countryOfOrigin: product.countryOfOrigin ?? 'India',
        image1:         images[0] ?? '',
        image2:         images[1] ?? '',
        image3:         images[2] ?? '',
        image4:         images[3] ?? '',
        image5:         images[4] ?? '',
      });
    }

    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: MEESHO_COLUMNS.length },
    };

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');

    return {
      buffer,
      filename: `meesho_upload_${date}.xlsx`,
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }

  // publishProduct is intentionally NOT implemented.
  // Meesho new product creation is Excel-upload-only through the Supplier Panel.
  // The UI shows a step-by-step guide for manual upload — this is not a limitation, it is the model.
}
