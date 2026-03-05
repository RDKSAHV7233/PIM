// apps/api/src/connectors/flipkart/flipkart.connector.ts
// Phase 5-S2: stub — P5-S3: OAuth — P5-S4: publish + poll
// See RD_CONNECTORS.md §Flipkart for all R&D requirements

import { Injectable } from '@nestjs/common';
import { ConnectorCap } from '@prisma/client';
import {
  ConnectorInterface,
  ConnectorContext,
  ConnectorIssue,
  ProductPayload,
  SubmissionRef,
  SubmissionStatusUpdate,
  ValidationResult,
} from '../../connector-framework/connector.interface';

@Injectable()
export class FlipkartConnector implements ConnectorInterface {
  readonly slug = 'flipkart';
  readonly displayName = 'Flipkart';
  readonly capabilities: ConnectorCap[] = [
    ConnectorCap.PUBLISH,
    ConnectorCap.VALIDATE,
    ConnectorCap.STATUS_SYNC,
    // No WEBHOOK_RECEIVE — Flipkart uses polling for status
  ];

  async validateCredentials(ctx: ConnectorContext): Promise<boolean> {
    // TODO P5-S3: call Flipkart ping/health endpoint with stored token
    // See RD_CONNECTORS.md §Flipkart.1
    return true;
  }

  async validateProduct(
    ctx: ConnectorContext,
    product: ProductPayload,
  ): Promise<ValidationResult> {
    // TODO P5-S3: local rules only (Flipkart has no dry-run equivalent)
    // See RD_CONNECTORS.md §Flipkart.2 for required attribute rules by category
    return {
      isValid: true,
      errors: [],
      warnings: [],
      source: 'LOCAL_RULES',
    };
  }

  normaliseError(errorCode: string, rawMessage: string): ConnectorIssue {
    // TODO P5-S3: map Flipkart error codes to seller messages
    // See RD_CONNECTORS.md §Flipkart.3 for known error code list
    return {
      code: errorCode,
      fieldPath: '',
      sellerMessage: rawMessage,
      severity: 'error',
    };
  }

  async handleOAuthCallback(
    ctx: ConnectorContext,
    params: Record<string, string>,
  ): Promise<void> {
    // TODO P5-S3: Authorization Code flow
    // IMPORTANT: Flipkart refresh tokens expire after 30 days
    // Credential heartbeat must catch and set failureReason = "Token expired (Flipkart 30-day limit)"
    // See RD_CONNECTORS.md §Flipkart.4
    throw new Error('Not implemented (P5-S3)');
  }

  async publishProduct(
    ctx: ConnectorContext,
    product: ProductPayload,
  ): Promise<SubmissionRef> {
    // TODO P5-S4: POST /sellers/listings/v3
    // NOTE: Flipkart returns result synchronously for some categories
    // Fetch category attribute schema before building payload — attributes differ by category
    // See RD_CONNECTORS.md §Flipkart.5
    throw new Error('Not implemented (P5-S4)');
  }

  async updateProduct(
    ctx: ConnectorContext,
    product: ProductPayload,
    externalRef: string,
  ): Promise<SubmissionRef> {
    // TODO P5-S4
    throw new Error('Not implemented (P5-S4)');
  }

  async syncSubmissionStatus(
    ctx: ConnectorContext,
    externalRef: string,
  ): Promise<SubmissionStatusUpdate> {
    // TODO P5-S4: poll Flipkart listing status API
    // Called by status-sync worker every 10 min for PENDING submissions
    // See RD_CONNECTORS.md §Flipkart.6
    throw new Error('Not implemented (P5-S4)');
  }
}
