import {
  ConnectorCap,
  ConnectorImplementationStatus,
  ProductPayload,
  ValidationResult,
} from "./connector.interface";
import { ConnectorLaunchStage } from "./connector-launch-policy";
import type { ConnectorValidationState } from "./credential-validation";

export type ConnectorInstallationStatus = "ACTIVE" | "PAUSED" | "CREDENTIAL_EXPIRED" | "DISABLED";

export interface ConnectorDefinitionRecord {
  id: string;
  slug: string;
  displayName: string;
  authType: string;
  capabilities: ConnectorCap[];
  implementationStatus: ConnectorImplementationStatus;
  launchStage: ConnectorLaunchStage;
  launchNote: string | null;
  marketplaceId: string | null;
  connectorVersion: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  actions?: ConnectorActionMatrix;
  /**
   * Internal launch-pipeline detail (owner, milestone, open blockers, and
   * free-text engineering notes) from resolveConnectorPipelineMetadata().
   * Populated by listAvailableDefinitions() only for callers with
   * system_admin/super_admin boundary roles — this can name unresolved
   * security holds (e.g. WooCommerce's P1-1/P1-2) and other detail that must
   * never reach an ordinary tenant call to this same shared endpoint.
   * Omitted (not merely empty) for every other caller.
   */
  pipelineMetadata?: {
    owner: string;
    milestone: string | null;
    blockers: string[];
    internalNotes: string | null;
  };
}

export interface ConnectorActionRule {
  allowed: boolean;
  reason: string | null;
}

export interface ConnectorActionMatrix {
  install: ConnectorActionRule;
  reconnect: ConnectorActionRule;
  uninstall: ConnectorActionRule;
}

export interface ConnectorInstallationRecord {
  id: string;
  tenantKey: string;
  connectorId: string;
  slug: string;
  displayName: string;
  accountAlias: string;
  externalAccountRef: string | null;
  status: ConnectorInstallationStatus;
  capabilities: ConnectorCap[];
  implementationStatus: ConnectorImplementationStatus;
  launchStage: ConnectorLaunchStage;
  launchNote: string | null;
  metadata: Record<string, unknown>;
  installedAt: string;
  installedBy: string;
  lastSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
  actions?: ConnectorActionMatrix;
  /**
   * VEXA-202/VEXA-301-interim: true when at least one stored credential row for
   * this installation has completed a successful validateCredentials() pass
   * (last_validated_at set, no failure_reason). Distinct from `status ===
   * 'ACTIVE'`, which is set at row-creation time regardless of whether any
   * credential was ever supplied or confirmed real — see connector-installer.service.ts
   * captureAndValidateFlipkartCredentials/captureAndValidateAmazonCredentials, which
   * silently skip validation when every credential field is left blank.
   * Only meaningful for connectors that run synchronous validation at install
   * (flipkart, amazon-in); `true` for everything else since they don't have this gap.
   */
  credentialsValidated: boolean;
  /**
   * What the heartbeat last learned about this installation's credentials (see
   * credential-validation.ts). All null until the first recorded check. INDETERMINATE and
   * CONFIGURATION_ERROR never change `status`; only INVALID does.
   */
  validation: ConnectorValidationState;
}

export interface PaginatedResponse<T> {
  items: T[];
  nextCursor: string | null;
  limit: number;
}

export interface ConnectorValidationInput {
  installation: ConnectorInstallationRecord;
  product: ProductPayload;
}

export interface ConnectorValidationOutput extends ValidationResult {}
