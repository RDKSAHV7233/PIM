import { z } from "zod";
import {
  getErrorAuthorityIngestTokenValidationIssue,
  getErrorAuthorityReleaseValidationIssue,
} from "./error-authority-env";
import { getVnextMutationValidationIssues } from "./vnext-mutation-env";

type AppEnv = "development" | "staging" | "production";
type BoolText = "true" | "false";
type AuthMode = "local" | "db";
type QueueBackend = "memory" | "bullmq";
type AuthEmailProvider = "file" | "console" | "resend";
type AccountExportStorageMode = "auto" | "filesystem" | "object_storage";

export interface ValidatedEnv {
  DATABASE_URL_POOLED: string;
  DATABASE_URL_DIRECT: string;
  JWT_SECRET: string;
  JWT_EXPIRY: string;
  CREDENTIAL_ENCRYPTION_KEY_V1?: string;
  CREDENTIAL_ENCRYPTION_KEY_V2?: string;
  CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION: number;
  REDIS_URL: string;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET_NAME: string;
  R2_PUBLIC_URL: string;
  R2_ENDPOINT?: string;
  ACCOUNT_EXPORT_STORAGE_MODE: AccountExportStorageMode;
  ACCOUNT_EXPORT_STORAGE_DIR?: string;
  APP_ENV: AppEnv;
  AUTH_MODE: AuthMode;
  AUTH_EMAIL_PROVIDER: AuthEmailProvider;
  AUTH_EMAIL_FROM?: string;
  AUTH_EMAIL_REPLY_TO?: string;
  AUTH_EMAIL_RESEND_API_KEY?: string;
  AUTH_EMAIL_OUTBOX_DIR?: string;
  // Svix signing secret for the Resend delivery webhook (whsec_<base64>).
  // Optional: the webhook receiver self-guards (503) when it is absent.
  RESEND_WEBHOOK_SECRET?: string;
  PIM_COMMERCIAL_CONTACT_URL?: string;
  PIM_COMMERCIAL_CONTACT_EMAIL?: string;
  PIM_COMMERCIAL_OPS_TOKEN?: string;
  PIM_COMMERCIAL_TRIAL_DAYS: number;
  PIM_EMAIL_LOGO_URL?: string;
  PIM_EMAIL_BANNER_URL?: string;
  PIM_EMAIL_SUPPORT_URL?: string;
  PIM_EMAIL_SUPPORT_EMAIL?: string;
  PIM_EMAIL_ONBOARDING_FROM?: string;
  PIM_EMAIL_NOTIFICATIONS_FROM?: string;
  PIM_EMAIL_ADMIN_EMAIL?: string;
  PIM_EMAIL_TEAM_EMAIL?: string;
  CORS_ORIGINS: string[];
  PORT: number;
  PIM_WEB_BASE_URL?: string;
  AMAZON_CLIENT_ID?: string;
  AMAZON_CLIENT_SECRET?: string;
  FLIPKART_CLIENT_ID?: string;
  FLIPKART_CLIENT_SECRET?: string;
  MEESHO_MERCHANT_ID?: string;
  MEESHO_SECRET_KEY?: string;
  PIM_SHOPIFY_CLIENT_ID?: string;
  PIM_SHOPIFY_CLIENT_SECRET?: string;
  PIM_SHOPIFY_SCOPES?: string;
  PIM_SHOPIFY_REDIRECT_URI?: string;
  FEATURE_ONDC_ENABLED: BoolText;
  FEATURE_PUBLIC_SIGNUP_ENABLED: BoolText;
  FEATURE_REAL_SPAPI_VALIDATION: BoolText;
  FEATURE_STRIPE_BILLING_ENABLED: BoolText;
  FEATURE_MARKETPLACE_BULK_PUBLISH_ASYNC_ENABLED: BoolText;
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  STRIPE_PRICE_ID_STARTER?: string;
  STRIPE_PRICE_ID_GROWTH?: string;
  STRIPE_PRICE_ID_BUSINESS?: string;
  STRIPE_PRICE_ID_ENTERPRISE?: string;
  QUEUE_BACKEND: QueueBackend;
  QUEUE_WORKER_ENABLED: BoolText;
  ERROR_AUTHORITY_ENABLED: BoolText;
  ERROR_AUTHORITY_RELEASE?: string;
  ERROR_AUTHORITY_INGEST_TOKEN?: string;
  OBSERVABILITY_DATABASE_URL?: string;
  ERROR_AUTHORITY_REF_SECRET?: string;
  OBSERVABILITY_DB_POOL_APP_NAME?: string;
  ERROR_AUTHORITY_RETENTION_DAYS: number;
  VNEXT_MUTATION_ENABLED: BoolText;
  VNEXT_MUTATION_ALLOWLIST_JSON?: string;
  VNEXT_MUTATION_APPROVED_RELEASE_SHA?: string;
  VNEXT_MUTATION_ALLOWED_FIELD_CLASS?: string;
  VNEXT_MUTATION_APPROVED_PAYLOAD_SHA256?: string;
  OPS_ALERT_WEBHOOK_URL?: string;
  OPS_ALERT_SLACK_WEBHOOK_URL?: string;
  OPS_ALERT_SECONDARY_WEBHOOK_URL?: string;
  SENTRY_DSN?: string;
  OTEL_EXPORTER_OTLP_ENDPOINT?: string;
}

const UrlSchema = z.string().url();
const OptionalTrimmedText = z.preprocess(
  (value) => {
    const normalized = String(value ?? "").trim();
    return normalized.length === 0 ? undefined : normalized;
  },
  z.string().optional(),
);

function parseCsvUrls(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

const EnvSchema = z.object({
  DATABASE_URL_POOLED: UrlSchema,
  DATABASE_URL_DIRECT: UrlSchema,
  JWT_SECRET: z.string().min(32),
  JWT_EXPIRY: z.string().default("4h"),
  CREDENTIAL_ENCRYPTION_KEY_V1: z.preprocess(
    (value) => {
      const normalized = String(value ?? "").trim();
      return normalized.length === 0 ? undefined : normalized;
    },
    z.string().min(32).optional(),
  ),
  CREDENTIAL_ENCRYPTION_KEY_V2: z.preprocess(
    (value) => {
      const normalized = String(value ?? "").trim();
      return normalized.length === 0 ? undefined : normalized;
    },
    z.string().min(32).optional(),
  ),
  CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION: z.coerce.number().int().min(1),
  REDIS_URL: UrlSchema,
  R2_ACCOUNT_ID: z.string().min(1),
  R2_ACCESS_KEY_ID: z.string().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET_NAME: z.string().min(1),
  R2_PUBLIC_URL: UrlSchema,
  R2_ENDPOINT: z.preprocess(
    (value) => {
      const normalized = String(value ?? "").trim();
      return normalized.length === 0 ? undefined : normalized;
    },
    z.string().url().optional(),
  ),
  ACCOUNT_EXPORT_STORAGE_MODE: z.enum(["auto", "filesystem", "object_storage"] as const).default("auto"),
  ACCOUNT_EXPORT_STORAGE_DIR: OptionalTrimmedText,
  APP_ENV: z.enum(["development", "staging", "production"] as const),
  AUTH_MODE: z.enum(["local", "db"] as const).default("local"),
  AUTH_EMAIL_PROVIDER: z.enum(["file", "console", "resend"] as const).default("file"),
  AUTH_EMAIL_FROM: z.string().optional(),
  AUTH_EMAIL_REPLY_TO: z.string().optional(),
  AUTH_EMAIL_RESEND_API_KEY: z.string().optional(),
  AUTH_EMAIL_OUTBOX_DIR: z.string().optional(),
  RESEND_WEBHOOK_SECRET: z.string().optional(),
  PIM_COMMERCIAL_CONTACT_URL: z.string().url().optional(),
  PIM_COMMERCIAL_CONTACT_EMAIL: z.string().email().optional(),
  PIM_EMAIL_LOGO_URL: z.string().url().optional(),
  PIM_EMAIL_BANNER_URL: z.string().url().optional(),
  PIM_EMAIL_SUPPORT_URL: z.string().url().optional(),
  PIM_EMAIL_SUPPORT_EMAIL: z.string().email().optional(),
  PIM_EMAIL_ONBOARDING_FROM: z.string().email().optional(),
  PIM_EMAIL_NOTIFICATIONS_FROM: z.string().email().optional(),
  PIM_EMAIL_ADMIN_EMAIL: z.string().email().optional(),
  PIM_EMAIL_TEAM_EMAIL: z.string().email().optional(),
  PIM_COMMERCIAL_OPS_TOKEN: z.string().optional(),
  PIM_COMMERCIAL_TRIAL_DAYS: z.coerce.number().int().min(1).default(90),
  CORS_ORIGIN: z.string().optional(),
  PORT: z.coerce.number().int().min(1).default(4000),
  PIM_WEB_BASE_URL: z.string().url().optional(),
  AMAZON_CLIENT_ID: z.string().optional(),
  AMAZON_CLIENT_SECRET: z.string().optional(),
  FLIPKART_CLIENT_ID: z.string().optional(),
  FLIPKART_CLIENT_SECRET: z.string().optional(),
  MEESHO_MERCHANT_ID: z.string().optional(),
  MEESHO_SECRET_KEY: z.string().optional(),
  PIM_SHOPIFY_CLIENT_ID: OptionalTrimmedText,
  PIM_SHOPIFY_CLIENT_SECRET: OptionalTrimmedText,
  PIM_SHOPIFY_SCOPES: OptionalTrimmedText,
  PIM_SHOPIFY_REDIRECT_URI: z.preprocess(
    (value) => {
      const normalized = String(value ?? "").trim();
      return normalized.length === 0 ? undefined : normalized;
    },
    z.string().url().optional(),
  ),
  FEATURE_ONDC_ENABLED: z.enum(["true", "false"] as const).default("false"),
  FEATURE_PUBLIC_SIGNUP_ENABLED: z.enum(["true", "false"] as const).default("false"),
  FEATURE_REAL_SPAPI_VALIDATION: z.enum(["true", "false"] as const).default("false"),
  FEATURE_STRIPE_BILLING_ENABLED: z.enum(["true", "false"] as const).default("false"),
  // Kill switch for the async bulk-publish path (PR #719) — defaults to enabled since
  // it's already the only path for non-native connectors (no sync fallback remains),
  // mirroring QUEUE_WORKER_ENABLED's "on by default, opt out" polarity rather than the
  // opt-in FEATURE_*_ENABLED flags above.
  FEATURE_MARKETPLACE_BULK_PUBLISH_ASYNC_ENABLED: z.enum(["true", "false"] as const).default("true"),
  STRIPE_SECRET_KEY: OptionalTrimmedText,
  STRIPE_WEBHOOK_SECRET: OptionalTrimmedText,
  STRIPE_PRICE_ID_STARTER: OptionalTrimmedText,
  STRIPE_PRICE_ID_GROWTH: OptionalTrimmedText,
  STRIPE_PRICE_ID_BUSINESS: OptionalTrimmedText,
  STRIPE_PRICE_ID_ENTERPRISE: OptionalTrimmedText,
  QUEUE_BACKEND: z.enum(["memory", "bullmq"] as const).default("memory"),
  QUEUE_WORKER_ENABLED: z.enum(["true", "false"] as const).default("true"),
  ERROR_AUTHORITY_ENABLED: z.enum(["true", "false"] as const).default("false"),
  ERROR_AUTHORITY_RELEASE: OptionalTrimmedText,
  ERROR_AUTHORITY_INGEST_TOKEN: OptionalTrimmedText,
  OBSERVABILITY_DATABASE_URL: UrlSchema.optional(),
  ERROR_AUTHORITY_REF_SECRET: z.string().min(32).optional(),
  OBSERVABILITY_DB_POOL_APP_NAME: OptionalTrimmedText,
  ERROR_AUTHORITY_RETENTION_DAYS: z.coerce.number().int().min(1).default(90),
  VNEXT_MUTATION_ENABLED: z.enum(["true", "false"] as const).default("false"),
  VNEXT_MUTATION_ALLOWLIST_JSON: OptionalTrimmedText,
  VNEXT_MUTATION_APPROVED_RELEASE_SHA: OptionalTrimmedText,
  VNEXT_MUTATION_ALLOWED_FIELD_CLASS: OptionalTrimmedText,
  VNEXT_MUTATION_APPROVED_PAYLOAD_SHA256: OptionalTrimmedText,
  OPS_ALERT_WEBHOOK_URL: OptionalTrimmedText,
  OPS_ALERT_SLACK_WEBHOOK_URL: OptionalTrimmedText,
  OPS_ALERT_SECONDARY_WEBHOOK_URL: OptionalTrimmedText,
  SENTRY_DSN: z.string().url().optional(),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().url().optional(),
});

export function validateEnv(): ValidatedEnv {
  const envInput: Record<string, string | undefined> = {
    ...process.env,
    JWT_SECRET: String(process.env.JWT_SECRET ?? process.env.PIM_JWT_SECRET ?? "").trim(),
    CORS_ORIGIN: String(process.env.CORS_ORIGIN ?? process.env.CORS_ORIGINS ?? "").trim(),
  };

  const parsed = EnvSchema.safeParse(envInput);
  const issues: string[] = [];
  const warnings: string[] = [];

  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      issues.push(`${issue.path.join(".")}: ${issue.message}`);
    }
  }

  if (!parsed.success) {
    // continue to print a single block below
  } else {
    const data = parsed.data;
    const currentKeyName = `CREDENTIAL_ENCRYPTION_KEY_V${data.CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION}`;
    const currentKeyValue = String(envInput[currentKeyName] ?? "").trim();
    if (currentKeyValue.length < 32) {
      issues.push(`${currentKeyName}: required and must be at least 32 chars for current key version`);
    }

    if (data.FEATURE_REAL_SPAPI_VALIDATION === "true") {
      const requiredWhenEnabled = [
        "AMAZON_CLIENT_ID",
        "AMAZON_CLIENT_SECRET",
        "FLIPKART_CLIENT_ID",
        "FLIPKART_CLIENT_SECRET",
        "MEESHO_MERCHANT_ID",
        "MEESHO_SECRET_KEY",
      ] as const;
      for (const key of requiredWhenEnabled) {
        const value = String(data[key] ?? "").trim();
        if (!value) {
          issues.push(`${key}: required when FEATURE_REAL_SPAPI_VALIDATION=true`);
        }
      }
    }

    const corsOrigins = parseCsvUrls(data.CORS_ORIGIN);
    for (const origin of corsOrigins) {
      if (!z.string().url().safeParse(origin).success) {
        issues.push("CORS_ORIGIN: expected comma-separated valid URLs");
        break;
      }
    }
    if ((data.APP_ENV === "staging" || data.APP_ENV === "production") && corsOrigins.length === 0) {
      issues.push("CORS_ORIGIN: required for staging/production");
    }
    if ((data.APP_ENV === "staging" || data.APP_ENV === "production") && data.AUTH_MODE !== "db") {
      issues.push("AUTH_MODE: staging/production must use AUTH_MODE=db");
    }
    if ((data.APP_ENV === "staging" || data.APP_ENV === "production") && data.QUEUE_BACKEND !== "bullmq") {
      issues.push("QUEUE_BACKEND: staging/production must use QUEUE_BACKEND=bullmq");
    }
    if (
      (data.APP_ENV === "staging" || data.APP_ENV === "production") &&
      data.QUEUE_WORKER_ENABLED !== "true"
    ) {
      issues.push("QUEUE_WORKER_ENABLED: staging/production must use QUEUE_WORKER_ENABLED=true");
    }
    if (data.ERROR_AUTHORITY_ENABLED === "true") {
      if (!data.OBSERVABILITY_DATABASE_URL) {
        issues.push("OBSERVABILITY_DATABASE_URL: required when ERROR_AUTHORITY_ENABLED=true");
      }
      if (!data.ERROR_AUTHORITY_REF_SECRET) {
        issues.push("ERROR_AUTHORITY_REF_SECRET: required when ERROR_AUTHORITY_ENABLED=true");
      }
      if (data.APP_ENV === "staging" || data.APP_ENV === "production") {
        const releaseIssue = getErrorAuthorityReleaseValidationIssue(data.ERROR_AUTHORITY_RELEASE);
        if (releaseIssue) {
          issues.push(`ERROR_AUTHORITY_RELEASE: ${releaseIssue} when ERROR_AUTHORITY_ENABLED=true in staging/production`);
        }
        const ingestTokenIssue = getErrorAuthorityIngestTokenValidationIssue(data.ERROR_AUTHORITY_INGEST_TOKEN);
        if (ingestTokenIssue) {
          issues.push(`ERROR_AUTHORITY_INGEST_TOKEN: ${ingestTokenIssue} when ERROR_AUTHORITY_ENABLED=true in staging/production`);
        }
      }
    }
    if (data.ERROR_AUTHORITY_RELEASE) {
      const releaseIssue = getErrorAuthorityReleaseValidationIssue(data.ERROR_AUTHORITY_RELEASE);
      if (releaseIssue) {
        issues.push(`ERROR_AUTHORITY_RELEASE: ${releaseIssue}`);
      }
    }
    for (const issue of getVnextMutationValidationIssues(data)) {
      issues.push(issue);
    }
    if (data.OPS_ALERT_WEBHOOK_URL) {
      const parsedOpsAlertUrl = z.string().url().safeParse(data.OPS_ALERT_WEBHOOK_URL);
      if (!parsedOpsAlertUrl.success) {
        issues.push("OPS_ALERT_WEBHOOK_URL: expected a valid URL when configured");
      } else if (
        (data.APP_ENV === "staging" || data.APP_ENV === "production") &&
        !String(data.OPS_ALERT_WEBHOOK_URL).startsWith("https://")
      ) {
        issues.push("OPS_ALERT_WEBHOOK_URL: must use HTTPS in staging/production when configured");
      }
    }
    if (data.OPS_ALERT_SLACK_WEBHOOK_URL) {
      const parsedSlackUrl = z.string().url().safeParse(data.OPS_ALERT_SLACK_WEBHOOK_URL);
      if (!parsedSlackUrl.success || !String(data.OPS_ALERT_SLACK_WEBHOOK_URL).startsWith("https://")) {
        issues.push("OPS_ALERT_SLACK_WEBHOOK_URL: expected a valid HTTPS URL when configured");
      }
    }
    if (data.OPS_ALERT_SECONDARY_WEBHOOK_URL) {
      const parsedSecondaryUrl = z.string().url().safeParse(data.OPS_ALERT_SECONDARY_WEBHOOK_URL);
      if (!parsedSecondaryUrl.success || !String(data.OPS_ALERT_SECONDARY_WEBHOOK_URL).startsWith("https://")) {
        issues.push("OPS_ALERT_SECONDARY_WEBHOOK_URL: expected a valid HTTPS URL when configured");
      }
    }
    const redisDisabledRaw = (key: string) =>
      String(envInput[key] ?? "false").trim().toLowerCase() === "true";
    if ((data.APP_ENV === "staging" || data.APP_ENV === "production") && redisDisabledRaw("PIM_AUTH_REDIS_DISABLED")) {
      issues.push(
        "PIM_AUTH_REDIS_DISABLED: must not be true in staging/production — " +
          "in-memory lockout/rate-limit state is per-instance and resets on restart",
      );
    }
    if ((data.APP_ENV === "staging" || data.APP_ENV === "production") && redisDisabledRaw("JWT_BLOCKLIST_REDIS_DISABLED")) {
      issues.push(
        "JWT_BLOCKLIST_REDIS_DISABLED: must not be true in staging/production — " +
          "in-memory JWT blocklist is per-instance; logout only revokes on the handling instance",
      );
    }
    if ((data.APP_ENV === "staging" || data.APP_ENV === "production") && redisDisabledRaw("CACHE_REDIS_DISABLED")) {
      warnings.push(
        "CACHE_REDIS_DISABLED: Redis cache is disabled — per-instance memory cache reduces performance under horizontal scaling",
      );
    }
    if ((data.APP_ENV === "staging" || data.APP_ENV === "production") && redisDisabledRaw("DASHBOARD_CACHE_REDIS_DISABLED")) {
      warnings.push(
        "DASHBOARD_CACHE_REDIS_DISABLED: Redis dashboard cache is disabled — dashboard queries will hit the database on every request",
      );
    }
    if (
      data.APP_ENV === "staging" &&
      (!String(data.AUTH_EMAIL_PROVIDER ?? "").trim() || data.AUTH_EMAIL_PROVIDER === "file")
    ) {
      issues.push(
        'AUTH_EMAIL_PROVIDER: staging must use "resend" or "console"; "file" mode is not allowed',
      );
    }
    if (data.APP_ENV === "production" && data.AUTH_EMAIL_PROVIDER !== "resend") {
      issues.push('AUTH_EMAIL_PROVIDER: production must use "resend"; "console" and "file" are not allowed');
    }
    if (data.AUTH_MODE === "db" && String(envInput.PIM_AUTH_IDENTITIES_JSON ?? "").trim().length > 0) {
      issues.push("PIM_AUTH_IDENTITIES_JSON: must not be used when AUTH_MODE=db");
    }
    if (
      (data.APP_ENV === "staging" || data.APP_ENV === "production") &&
      data.ACCOUNT_EXPORT_STORAGE_MODE === "filesystem" &&
      !String(data.ACCOUNT_EXPORT_STORAGE_DIR ?? "").trim()
    ) {
      issues.push(
        "ACCOUNT_EXPORT_STORAGE_DIR: required when ACCOUNT_EXPORT_STORAGE_MODE=filesystem in staging/production",
      );
    }
    if (data.FEATURE_PUBLIC_SIGNUP_ENABLED === "true" && data.AUTH_MODE !== "db") {
      issues.push(
        "AUTH_MODE: FEATURE_PUBLIC_SIGNUP_ENABLED=true requires AUTH_MODE=db — " +
          "signup-created users are stored as database tenant records and cannot be resolved " +
          "by the local PIM_AUTH_IDENTITIES_JSON identity store; login will fail for all new workspace members",
      );
    }
    if (data.AUTH_EMAIL_PROVIDER === "resend") {
      if (!String(data.AUTH_EMAIL_RESEND_API_KEY ?? "").trim()) {
        issues.push("AUTH_EMAIL_RESEND_API_KEY: required when AUTH_EMAIL_PROVIDER=resend");
      }
      if (!String(data.AUTH_EMAIL_FROM ?? "").trim()) {
        issues.push("AUTH_EMAIL_FROM: required when AUTH_EMAIL_PROVIDER=resend");
      }
    }

    if (data.APP_ENV === "staging" || data.APP_ENV === "production") {
      // Reject known placeholder values that pass the min-length check but are not real secrets.
      const KNOWN_PLACEHOLDERS = [
        "replace-with-long-random-secret-at-least-32-chars",
        "replace-with-base64-key",
        "replace-me",
        "changeme",
        "change_me",
        "todo",
        "fixme",
      ];
      const sensitiveSecretKeys: Array<{ key: string; value: string }> = [
        { key: "JWT_SECRET", value: String(envInput.JWT_SECRET ?? "").trim() },
        { key: currentKeyName, value: currentKeyValue },
      ];
      for (const { key, value } of sensitiveSecretKeys) {
        const lower = value.toLowerCase();
        const isPlaceholder = KNOWN_PLACEHOLDERS.some(
          (p) => lower === p || lower.startsWith(p) || lower.includes("replace") || lower.includes("placeholder"),
        );
        if (isPlaceholder) {
          issues.push(`${key}: value appears to be a placeholder and must be replaced with a real secret in staging/production`);
        }
      }

      if (
        !String(data.PIM_COMMERCIAL_CONTACT_URL ?? "").trim() &&
        !String(data.PIM_COMMERCIAL_CONTACT_EMAIL ?? "").trim()
      ) {
        issues.push(
          "PIM_COMMERCIAL_CONTACT_URL or PIM_COMMERCIAL_CONTACT_EMAIL: at least one is required for staging/production",
        );
      }

      const emailImageUrls: Array<{ key: string; value: string }> = [
        { key: "PIM_EMAIL_LOGO_URL", value: String(data.PIM_EMAIL_LOGO_URL ?? "").trim() },
        { key: "PIM_EMAIL_BANNER_URL", value: String(data.PIM_EMAIL_BANNER_URL ?? "").trim() },
      ];
      for (const { key, value } of emailImageUrls) {
        if (value && !value.startsWith("https://")) {
          issues.push(`${key}: must use HTTPS in staging/production`);
        }
      }

      if (!String(data.PIM_COMMERCIAL_OPS_TOKEN ?? "").trim()) {
        issues.push("PIM_COMMERCIAL_OPS_TOKEN: required for staging/production");
      }
    }

    const sharedPassword = String(envInput.PIM_AUTH_PASSWORD ?? "").trim();
    if (
      (data.APP_ENV === "staging" || data.APP_ENV === "production") &&
      sharedPassword &&
      sharedPassword.toLowerCase() !== "disabled"
    ) {
      issues.push(
        "PIM_AUTH_PASSWORD: shared-password fallback must be disabled in staging/production after DB credential migration",
      );
    }

    if (issues.length === 0) {
      for (const warning of warnings) {
        // eslint-disable-next-line no-console
        console.warn(`STARTUP WARNING - ${warning}`);
      }
      return {
        ...data,
        CORS_ORIGINS: corsOrigins,
      };
    }
  }

  // eslint-disable-next-line no-console
  console.error("STARTUP FAILED - missing or invalid environment variables:");
  for (const issue of issues) {
    // eslint-disable-next-line no-console
    console.error(`  ${issue}`);
  }
  process.exit(1);
}
