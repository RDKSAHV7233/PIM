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
    maxSkus: 500,
    maxSubmissionsPerMonth: 500,
    maxUsers: 3,
    maxStorageGb: 2,
    maxConnectorInstallations: 1,
    maxAccountsPerConnector: 1,
    maxApiKeys: 0,
    maxOutboundWebhooks: 0,
    maxImportRowsPerJob: 2000,
  },
  {
    planTier: "STARTER",
    maxSkus: 2500,
    maxSubmissionsPerMonth: 2500,
    maxUsers: 5,
    maxStorageGb: 15,
    maxConnectorInstallations: 2,
    maxAccountsPerConnector: 1,
    maxApiKeys: 0,
    maxOutboundWebhooks: 0,
    maxImportRowsPerJob: 10000,
  },
  {
    planTier: "GROWTH",
    maxSkus: 10000,
    maxSubmissionsPerMonth: 10000,
    maxUsers: 15,
    maxStorageGb: 75,
    maxConnectorInstallations: 5,
    maxAccountsPerConnector: 3,
    maxApiKeys: 3,
    maxOutboundWebhooks: 3,
    maxImportRowsPerJob: 30000,
  },
  {
    planTier: "BUSINESS",
    maxSkus: 50000,
    maxSubmissionsPerMonth: 50000,
    maxUsers: 50,
    maxStorageGb: 250,
    maxConnectorInstallations: 15,
    maxAccountsPerConnector: 10,
    maxApiKeys: 20,
    maxOutboundWebhooks: 20,
    maxImportRowsPerJob: 30000,
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
