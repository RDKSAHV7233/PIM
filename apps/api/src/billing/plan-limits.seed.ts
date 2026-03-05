export interface PlanLimitSeed {
  planTier: string;
  maxSkus: number;
  maxSubmissionsPerMonth: number;
  maxUsers: number;
  maxStorageGb: number;
  maxConnectorInstallations: number;
  maxAccountsPerConnector: number;
}

export const PLAN_LIMITS: PlanLimitSeed[] = [
  {
    planTier: "STARTER",
    maxSkus: 500,
    maxSubmissionsPerMonth: 500,
    maxUsers: 3,
    maxStorageGb: 5,
    maxConnectorInstallations: 2,
    maxAccountsPerConnector: 1,
  },
  {
    planTier: "GROWTH",
    maxSkus: 5000,
    maxSubmissionsPerMonth: 5000,
    maxUsers: 20,
    maxStorageGb: 50,
    maxConnectorInstallations: 10,
    maxAccountsPerConnector: 3,
  },
  {
    planTier: "ENTERPRISE",
    maxSkus: 99999,
    maxSubmissionsPerMonth: 99999,
    maxUsers: 999,
    maxStorageGb: 500,
    maxConnectorInstallations: 100,
    maxAccountsPerConnector: 20,
  },
];
