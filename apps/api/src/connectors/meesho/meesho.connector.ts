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
    // TODO P5-S3: map Meesho-specific error codes
    // Meesho errors surface in Excel upload feedback, not API responses
    // See RD_CONNECTORS.md §Meesho.3
    return {
      code: errorCode,
      fieldPath: '',
      sellerMessage: rawMessage,
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
