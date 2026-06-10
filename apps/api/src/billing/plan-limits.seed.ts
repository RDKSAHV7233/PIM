export interface PlanLimitSeed {
  planTier: string;
  maxSkus: number;
  maxSubmissionsPerMonth: number;
  maxUsers: number;
  maxStorageGb: number;
  maxConnectorInstallations: number;
  maxAccountsPerConnector: number;
  maxApiKeys: number;
  maxOutboundWebhooks: number;
  maxImportRowsPerJob: number;
}

export const PLAN_LIMITS: PlanLimitSeed[] = [
  {
    planTier: "TRIAL",
    maxSkus: 100,
    maxSubmissionsPerMonth: 100,
    maxUsers: 2,
    maxStorageGb: 1,
    maxConnectorInstallations: 1,
    maxAccountsPerConnector: 1,
    maxApiKeys: 0,
    maxOutboundWebhooks: 0,
    maxImportRowsPerJob: 500,
  },
  {
    planTier: "STARTER",
    maxSkus: 500,
    maxSubmissionsPerMonth: 500,
    maxUsers: 3,
    maxStorageGb: 5,
    maxConnectorInstallations: 2,
    maxAccountsPerConnector: 1,
    maxApiKeys: 0,
    maxOutboundWebhooks: 0,
    maxImportRowsPerJob: 2000,
  },
  {
    planTier: "GROWTH",
    maxSkus: 10000,
    maxSubmissionsPerMonth: 10000,
    maxUsers: 20,
    maxStorageGb: 50,
    maxConnectorInstallations: 10,
    maxAccountsPerConnector: 3,
    maxApiKeys: 3,
    maxOutboundWebhooks: 3,
    maxImportRowsPerJob: 10000,
  },
  {
    planTier: "ENTERPRISE",
    maxSkus: 100000,
    maxSubmissionsPerMonth: 100000,
    maxUsers: 999,
    maxStorageGb: 500,
    maxConnectorInstallations: 100,
    maxAccountsPerConnector: 20,
    maxApiKeys: 50,
    maxOutboundWebhooks: 50,
    maxImportRowsPerJob: 30000,
  },
];
