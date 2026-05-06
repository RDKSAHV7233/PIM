// apps/api/src/connectors/meesho/meesho.connector.ts
// Phase 5-S2: stub — P5-S3: static credentials — P5-S4: Excel export
// IMPORTANT: Meesho has NO publishProduct(). Export-only connector.
// See RD_CONNECTORS.md §Meesho for all R&D requirements

import { Injectable } from '@nestjs/common';
import {
  ConnectorInterface,
  ConnectorCap,
  ConnectorContext,
  ConnectorIssue,
  ExportFile,
  ProductPayload,
  ValidationResult,
} from '../../connector-framework/connector.interface';

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

  async validateCredentials(ctx: ConnectorContext): Promise<boolean> {
    // TODO P5-S3: call Meesho ping/health endpoint with stored API key
    // Credentials obtained from: meesholink-integration@meesho.com (1-2 week lead time)
    // See RD_CONNECTORS.md §Meesho.1
    return true;
  }

  async validateProduct(
    ctx: ConnectorContext,
    product: ProductPayload,
  ): Promise<ValidationResult> {
    // TODO P5-S3: local rules only — Meesho has no live validation API
    // Key rules: title max 70 chars, image must be square (1:1), HSN code required
    // See RD_CONNECTORS.md §Meesho.2 for full field requirements by category
    return {
      isValid: true,
      errors: [],
      warnings: [],
      source: 'LOCAL_RULES',
    };
  }

  normaliseError(errorCode: string, rawMessage: string): ConnectorIssue {
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

    const mapped = MEESHO_ERROR_MAP[errorCode];
    if (mapped) {
      return {
        code: errorCode,
        fieldPath: mapped.fieldPath,
        sellerMessage: mapped.sellerMessage,
        severity: mapped.severity,
      };
    }

    // Fallback: surface raw message with unknown code
    return {
      code: errorCode,
      fieldPath: '',
      sellerMessage: rawMessage || `Meesho returned error: ${errorCode}`,
      severity: 'error',
    };
  }

  async generateExportFile(
    ctx: ConnectorContext,
    products: ProductPayload[],
  ): Promise<ExportFile> {
    // TODO P5-S4: build Excel using ExcelJS
    // CRITICAL: Download the LATEST Meesho supplier template from Supplier Panel before implementing
    // Meesho changes column names with category updates — build a template version check
    // Column mapping: see RD_CONNECTORS.md §Meesho.4
    // Filename format: meesho_upload_{category}_{YYYYMMDD}.xlsx
    throw new Error('Not implemented — requires Meesho template R&D (P5-S4). See RD_CONNECTORS.md §Meesho.4');
  }

  // publishProduct is intentionally NOT implemented.
  // Meesho new product creation is Excel-upload-only through the Supplier Panel.
  // The UI shows a step-by-step guide for manual upload — this is not a limitation, it is the model.
}
