import { z } from "zod";

type AppEnv = "development" | "staging" | "production";
type BoolText = "true" | "false";
type AuthMode = "local" | "db";

export interface ValidatedEnv {
  DATABASE_URL_POOLED: string;
  DATABASE_URL_DIRECT: string;
  JWT_SECRET: string;
  JWT_EXPIRY: string;
  CREDENTIAL_ENCRYPTION_KEY_V1: string;
  CREDENTIAL_ENCRYPTION_KEY_V2?: string;
  CREDENTIAL_ENCRYPTION_KEY_CURRENT_VERSION: number;
  REDIS_URL: string;
  R2_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
  R2_BUCKET_NAME: string;
  R2_PUBLIC_URL: string;
  APP_ENV: AppEnv;
  AUTH_MODE: AuthMode;
  CORS_ORIGINS: string[];
  PORT: number;
  AMAZON_CLIENT_ID?: string;
  AMAZON_CLIENT_SECRET?: string;
  FLIPKART_CLIENT_ID?: string;
  FLIPKART_CLIENT_SECRET?: string;
  MEESHO_MERCHANT_ID?: string;
  MEESHO_SECRET_KEY?: string;
  FEATURE_ONDC_ENABLED: BoolText;
  FEATURE_REAL_SPAPI_VALIDATION: BoolText;
}

const UrlSchema = z.string().url();

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
  CREDENTIAL_ENCRYPTION_KEY_V1: z.string().min(32),
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
  APP_ENV: z.enum(["development", "staging", "production"] as const),
  AUTH_MODE: z.enum(["local", "db"] as const).default("local"),
  CORS_ORIGIN: z.string().optional(),
  PORT: z.coerce.number().int().min(1).default(4000),
  AMAZON_CLIENT_ID: z.string().optional(),
  AMAZON_CLIENT_SECRET: z.string().optional(),
  FLIPKART_CLIENT_ID: z.string().optional(),
  FLIPKART_CLIENT_SECRET: z.string().optional(),
  MEESHO_MERCHANT_ID: z.string().optional(),
  MEESHO_SECRET_KEY: z.string().optional(),
  FEATURE_ONDC_ENABLED: z.enum(["true", "false"] as const).default("false"),
  FEATURE_REAL_SPAPI_VALIDATION: z.enum(["true", "false"] as const).default("false"),
});

export function validateEnv(): ValidatedEnv {
  const envInput: Record<string, string | undefined> = {
    ...process.env,
    JWT_SECRET: String(process.env.JWT_SECRET ?? process.env.PIM_JWT_SECRET ?? "").trim(),
    CORS_ORIGIN: String(process.env.CORS_ORIGIN ?? process.env.CORS_ORIGINS ?? "").trim(),
  };

  const parsed = EnvSchema.safeParse(envInput);
  const issues: string[] = [];

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
    if (data.AUTH_MODE === "db" && String(envInput.PIM_AUTH_IDENTITIES_JSON ?? "").trim().length > 0) {
      issues.push("PIM_AUTH_IDENTITIES_JSON: must not be used when AUTH_MODE=db");
    }

    if (issues.length === 0) {
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
