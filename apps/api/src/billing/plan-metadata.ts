import { PLAN_LIMITS } from "./plan-limits.seed";

export interface PlanMetadata {
  tier: string;
  label: string;
  tagline: string;
  limits: {
    skus: number;
    submissions: number;
    users: number;
    roles: string;
    storageGb: number;
    connectorInstallations: number;
    accountsPerConnector: number;
    apiKeys: number;
    outboundWebhooks: number;
    importRowsPerJob: number;
  };
  unlimited: Partial<Record<keyof PlanMetadata["limits"], boolean>>;
  features: string[];
}

const PLAN_COPY: Record<string, Omit<PlanMetadata, "limits" | "unlimited">> = {
  TRIAL: {
    tier: "TRIAL",
    label: "Trial",
    tagline: "Explore Vexa PIM before you commit",
    features: [
      "Product catalog management",
      "Controlled bulk import",
      "Quality validation",
      "Limited marketplace connector access",
    ],
  },
  STARTER: {
    tier: "STARTER",
    label: "Starter",
    tagline: "Small serious seller",
    features: [
      "Product catalog management",
      "Bulk import and repair",
      "Quality validation",
      "Core marketplace connectors",
      "Community support",
    ],
  },
  GROWTH: {
    tier: "GROWTH",
    label: "Growth",
    tagline: "Scale your catalog across channels",
    features: [
      "Everything in Starter",
      "Approval workflow",
      "API keys and outbound webhooks",
      "Expanded bulk import",
      "Multi-account connectors",
      "Priority support",
      "Bulk edit operations",
      "Advanced compliance rules",
    ],
  },
  BUSINESS: {
    tier: "BUSINESS",
    label: "Business",
    tagline: "Large catalog operations at scale",
    features: [
      "Everything in Growth",
      "Larger catalog and submission capacity",
      "Expanded team access",
      "Expanded API keys and webhooks",
      "Expanded bulk import",
      "Higher storage allowance",
      "Dedicated support",
    ],
  },
  ENTERPRISE: {
    tier: "ENTERPRISE",
    label: "Enterprise",
    tagline: "Dedicated scale with white-glove support",
    features: [
      "Everything in Business",
      "Custom catalog and submission capacity",
      "Custom API keys and outbound webhooks",
      "Expanded bulk import",
      "Dedicated account manager",
      "Contractual support and onboarding review",
      "SSO / OIDC integration",
      "Data migration planning",
    ],
  },
};

const ROLE_LABELS: Record<string, string> = {
  TRIAL: "Core roles",
  STARTER: "Core roles",
  GROWTH: "Workflow roles",
  BUSINESS: "All roles",
  ENTERPRISE: "All roles",
};

export function getPlanMetadata(): PlanMetadata[] {
  return PLAN_LIMITS.map((seed) => {
    const tier = seed.planTier.toUpperCase();
    const copy = PLAN_COPY[tier] ?? PLAN_COPY.STARTER;
    return {
      ...copy,
      tier,
      limits: {
        skus: seed.maxSkus,
        submissions: seed.maxSubmissionsPerMonth,
        users: seed.maxUsers,
        roles: ROLE_LABELS[tier] ?? ROLE_LABELS.STARTER,
        storageGb: seed.maxStorageGb,
        connectorInstallations: seed.maxConnectorInstallations,
        accountsPerConnector: seed.maxAccountsPerConnector,
        apiKeys: seed.maxApiKeys,
        outboundWebhooks: seed.maxOutboundWebhooks,
        importRowsPerJob: seed.maxImportRowsPerJob,
      },
      unlimited: {},
    };
  });
}
