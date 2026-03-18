import { ConnectorCap, ProductPayload, ValidationResult } from "./connector.interface";
import { ConnectorLaunchStage } from "./connector-launch-policy";

export type ConnectorInstallationStatus = "ACTIVE" | "PAUSED" | "CREDENTIAL_EXPIRED" | "DISABLED";

export interface ConnectorDefinitionRecord {
  id: string;
  slug: string;
  displayName: string;
  authType: string;
  capabilities: ConnectorCap[];
  launchStage: ConnectorLaunchStage;
  launchNote: string | null;
  marketplaceId: string | null;
  connectorVersion: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  actions?: ConnectorActionMatrix;
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
  launchStage: ConnectorLaunchStage;
  launchNote: string | null;
  metadata: Record<string, unknown>;
  installedAt: string;
  installedBy: string;
  lastSyncAt: string | null;
  createdAt: string;
  updatedAt: string;
  actions?: ConnectorActionMatrix;
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
