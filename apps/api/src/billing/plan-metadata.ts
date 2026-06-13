import { PLAN_LIMITS } from "./plan-limits.seed";

export interface PlanMetadata {
  tier: string;
  label: string;
  price: string;
  setupFee: string | null;
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
    price: "Free for 14 days",
    setupFee: null,
    tagline: "Explore Vexa PIM before you commit",
    features: [
      "Product catalog management",
      "Bulk import up to 500 rows",
      "Quality validation",
      "1 marketplace connector",
    ],
  },
  STARTER: {
    tier: "STARTER",
    label: "Starter",
    price: "₹9,999/month",
    setupFee: "₹15,000-₹25,000 optional",
    tagline: "Small serious seller",
    features: [
      "Product catalog management",
      "Bulk import and repair up to 2K rows",
      "Quality validation",
      "2 marketplace connectors",
      "Community support",
    ],
  },
  GROWTH: {
    tier: "GROWTH",
    label: "Growth",
    price: "₹29,999/month",
    setupFee: "₹75,000-₹1,50,000",
    tagline: "Scale your catalog across channels",
    features: [
      "Everything in Starter",
      "Approval workflow",
      "API keys and outbound webhooks",
      "Bulk import up to 10K rows",
      "Multi-account connectors",
      "Priority support",
      "Bulk edit operations",
      "Advanced compliance rules",
    ],
  },
  BUSINESS: {
    tier: "BUSINESS",
    label: "Business",
    price: "₹69,999/month",
    setupFee: "₹1,50,000-₹3,00,000",
    tagline: "Large catalog operations at scale",
    features: [
      "Everything in Growth",
      "50K SKUs and submissions",
      "100 users, all 8 roles",
      "20 API keys and webhooks",
      "Bulk import up to 20K rows",
      "200 GB storage",
      "Dedicated support",
    ],
  },
  ENTERPRISE: {
    tier: "ENTERPRISE",
    label: "Enterprise",
    price: "From ₹1,49,999/month",
    setupFee: "Custom",
    tagline: "Dedicated scale with white-glove support",
    features: [
      "Everything in Business",
      "100K SKUs and submissions",
      "50 API keys and outbound webhooks",
      "Bulk import up to 30K rows",
      "Dedicated account manager",
      "Custom SLA and onboarding",
      "SSO / OIDC integration",
      "White-glove data migration",
    ],
  },
};

const ROLE_LABELS: Record<string, string> = {
  TRIAL: "3 (admin, editor, viewer)",
  STARTER: "3 (admin, editor, viewer)",
  GROWTH: "6 (+reviewer, approver, publisher)",
  BUSINESS: "8 (all roles)",
  ENTERPRISE: "8 (all roles)",
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
