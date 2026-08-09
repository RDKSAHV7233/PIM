import { assertTrustedErrorAuthorityServerIngestionConfig } from "./lib/server/error-authority-env";

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const appEnv = String(process.env.APP_ENV ?? process.env.NODE_ENV ?? "").trim().toLowerCase();
  const isStrictEnv = appEnv === "staging" || appEnv === "production";

  const missing: string[] = [];
  const warnings: string[] = [];

  // JWT secret is required for session verification; missing = all sessions silently fail.
  const jwtSecret = String(process.env.JWT_SECRET ?? process.env.PIM_JWT_SECRET ?? "").trim();
  if (!jwtSecret) {
    if (isStrictEnv) {
      missing.push("JWT_SECRET (or PIM_JWT_SECRET) — sessions cannot be verified");
    } else {
      warnings.push("JWT_SECRET not set; session verification is disabled (OK for local dev)");
    }
  }

  // API base URL — missing means all API calls hit localhost:4000, catastrophic on staging.
  const apiBaseUrl = String(
    process.env.PIM_API_BASE_URL ?? process.env.NEXT_PUBLIC_API_URL ?? process.env.PIM_API_BASE_URL_FALLBACK ?? "",
  ).trim();
  if (!apiBaseUrl) {
    if (isStrictEnv) {
      missing.push("PIM_API_BASE_URL — API calls will fall back to localhost:4000");
    } else {
      warnings.push("PIM_API_BASE_URL not set; defaulting to localhost:4000");
    }
  } else if (isStrictEnv && (apiBaseUrl.includes("localhost") || apiBaseUrl.includes("127.0.0.1"))) {
    warnings.push(`PIM_API_BASE_URL points to localhost in ${appEnv}: ${apiBaseUrl}`);
  }

  // AUTH_MODE must be "db" on staging/production (local auth is dev-only).
  if (isStrictEnv) {
    const authMode = String(process.env.AUTH_MODE ?? "").trim().toLowerCase();
    if (authMode !== "db") {
      missing.push(`AUTH_MODE must be "db" in ${appEnv} (got: "${authMode || "(unset)"}")`);
    }
    try {
      assertTrustedErrorAuthorityServerIngestionConfig();
    } catch (error) {
      missing.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (warnings.length > 0) {
    for (const warning of warnings) {
      console.warn(`[ENV] WARNING: ${warning}`);
    }
  }

  if (missing.length > 0) {
    const lines = missing.map((m) => `  ✗ ${m}`).join("\n");
    const message = `[ENV] STARTUP BLOCKED — required environment variables missing in ${appEnv}:\n${lines}\n  Fix these before deploying.`;
    console.error(message);
    throw new Error(message);
  }
}
