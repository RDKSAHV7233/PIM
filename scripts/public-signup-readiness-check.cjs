#!/usr/bin/env node

function parseArgs(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const current = String(argv[index] ?? "").trim();
    if (!current.startsWith("--")) {
      continue;
    }
    const [rawKey, inlineValue] = current.slice(2).split("=", 2);
    const key = rawKey.trim();
    if (!key) {
      continue;
    }
    if (inlineValue !== undefined) {
      options[key] = inlineValue.trim();
      continue;
    }
    const next = String(argv[index + 1] ?? "").trim();
    if (next && !next.startsWith("--")) {
      options[key] = next;
      index += 1;
      continue;
    }
    options[key] = "true";
  }
  return options;
}

function normalizeTarget(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (normalized === "prod") {
    return "production";
  }
  if (normalized === "dev") {
    return "development";
  }
  if (normalized === "local") {
    return "development";
  }
  if (normalized === "staging" || normalized === "production" || normalized === "development") {
    return normalized;
  }
  return "development";
}

function hasValue(value) {
  return String(value ?? "").trim().length > 0;
}

function envValue(name) {
  return String(process.env[name] ?? "").trim();
}

function isTrue(name) {
  return envValue(name).toLowerCase() === "true";
}

function firstPresent(keys) {
  for (const key of keys) {
    const value = envValue(key);
    if (value) {
      return { key, value };
    }
  }
  return null;
}

function pushIssue(collection, severity, code, message) {
  collection.push({ severity, code, message });
}

function printIssues(title, issues) {
  if (issues.length === 0) {
    return;
  }
  console.log(`\n${title}`);
  for (const issue of issues) {
    console.log(`- [${issue.code}] ${issue.message}`);
  }
}

const options = parseArgs(process.argv.slice(2));
const target = normalizeTarget(options.target || process.env.APP_ENV || "development");
const errors = [];
const warnings = [];
const notes = [];

const authMode = envValue("AUTH_MODE").toLowerCase();
const emailProvider = envValue("AUTH_EMAIL_PROVIDER").toLowerCase() || "file";
const apiBase = firstPresent(["PIM_API_BASE_URL", "NEXT_PUBLIC_API_URL", "PIM_API_BASE_URL_FALLBACK"]);
const webBase = firstPresent(["PIM_WEB_BASE_URL", "CORS_ORIGIN", "CORS_ORIGINS"]);
const jwtSecret = firstPresent(["JWT_SECRET", "PIM_JWT_SECRET"]);

if (!isTrue("FEATURE_PUBLIC_SIGNUP_ENABLED")) {
  pushIssue(
    errors,
    "error",
    "API_SIGNUP_FLAG_OFF",
    "Set FEATURE_PUBLIC_SIGNUP_ENABLED=true on the API service and the web service.",
  );
}

if (!isTrue("NEXT_PUBLIC_FEATURE_PUBLIC_SIGNUP_ENABLED")) {
  pushIssue(
    errors,
    "error",
    "WEB_SIGNUP_FLAG_OFF",
    "Set NEXT_PUBLIC_FEATURE_PUBLIC_SIGNUP_ENABLED=true on the web service so the login CTA and signup screens are exposed.",
  );
}

if (authMode !== "db") {
  pushIssue(
    errors,
    "error",
    "AUTH_MODE_NOT_DB",
    `AUTH_MODE must be db for signup-created users. Current value: "${envValue("AUTH_MODE") || "(unset)"}".`,
  );
}

if (!jwtSecret) {
  pushIssue(errors, "error", "JWT_SECRET_MISSING", "Set JWT_SECRET or PIM_JWT_SECRET to a real secret.");
}

if (!hasValue(envValue("DATABASE_URL_POOLED"))) {
  pushIssue(errors, "error", "DATABASE_URL_POOLED_MISSING", "Set DATABASE_URL_POOLED for DB-backed auth and tenant provisioning.");
}

if (!hasValue(envValue("DATABASE_URL_DIRECT"))) {
  pushIssue(errors, "error", "DATABASE_URL_DIRECT_MISSING", "Set DATABASE_URL_DIRECT for migrations and operational scripts.");
}

if (!apiBase) {
  pushIssue(
    errors,
    "error",
    "WEB_API_BASE_MISSING",
    "Set PIM_API_BASE_URL (preferred) or NEXT_PUBLIC_API_URL on the web service so /api/signup/* can proxy to the API.",
  );
}

if (!webBase) {
  pushIssue(
    errors,
    "error",
    "WEB_BASE_MISSING",
    "Set PIM_WEB_BASE_URL (preferred) or CORS_ORIGIN so signup verification emails point at the live web app.",
  );
}

if (!hasValue(envValue("REDIS_URL"))) {
  pushIssue(
    target === "development" ? warnings : errors,
    target === "development" ? "warning" : "error",
    "REDIS_URL_MISSING",
    "Set REDIS_URL. Signup rate limiting falls back in-memory without it, which is not durable across replicas or restarts.",
  );
}

if (target === "staging" || target === "production") {
  if (envValue("QUEUE_BACKEND").toLowerCase() !== "bullmq") {
    pushIssue(
      errors,
      "error",
      "QUEUE_BACKEND_INVALID",
      `QUEUE_BACKEND must be bullmq in ${target}. Current value: "${envValue("QUEUE_BACKEND") || "(unset)"}".`,
    );
  }
  if (target === "staging" && !isTrue("QUEUE_WORKER_ENABLED")) {
    pushIssue(
      errors,
      "error",
      "QUEUE_WORKER_DISABLED",
      "QUEUE_WORKER_ENABLED must be true in staging under the current single-runtime staging contract.",
    );
  }
  if (target === "production" && !isTrue("QUEUE_WORKER_ENABLED")) {
    pushIssue(
      warnings,
      "warning",
      "QUEUE_WORKER_DISABLED",
      "QUEUE_WORKER_ENABLED=false is acceptable on the production API service when a separate worker service is running with QUEUE_WORKER_ENABLED=true. Verify the worker service separately.",
    );
  }
}

if (emailProvider === "resend") {
  if (!hasValue(envValue("AUTH_EMAIL_RESEND_API_KEY"))) {
    pushIssue(errors, "error", "RESEND_KEY_MISSING", "Set AUTH_EMAIL_RESEND_API_KEY for live signup email delivery.");
  }
  if (!hasValue(envValue("AUTH_EMAIL_FROM"))) {
    pushIssue(errors, "error", "RESEND_FROM_MISSING", "Set AUTH_EMAIL_FROM to a verified sender address.");
  }
} else if (emailProvider === "smtp") {
  if (!hasValue(envValue("AUTH_EMAIL_SMTP_HOST"))) {
    pushIssue(errors, "error", "SMTP_HOST_MISSING", "Set AUTH_EMAIL_SMTP_HOST for live signup email delivery.");
  }
  if (!hasValue(envValue("AUTH_EMAIL_SMTP_PORT"))) {
    pushIssue(errors, "error", "SMTP_PORT_MISSING", "Set AUTH_EMAIL_SMTP_PORT for live signup email delivery.");
  }
  if (!hasValue(envValue("AUTH_EMAIL_SMTP_USER"))) {
    pushIssue(errors, "error", "SMTP_USER_MISSING", "Set AUTH_EMAIL_SMTP_USER for live signup email delivery.");
  }
  if (!hasValue(envValue("AUTH_EMAIL_SMTP_PASSWORD"))) {
    pushIssue(errors, "error", "SMTP_PASSWORD_MISSING", "Set AUTH_EMAIL_SMTP_PASSWORD for live signup email delivery.");
  }
  if (!hasValue(envValue("AUTH_EMAIL_FROM"))) {
    pushIssue(errors, "error", "SMTP_FROM_MISSING", "Set AUTH_EMAIL_FROM to a valid SMTP sender address.");
  }
} else if (emailProvider === "console") {
  if (target === "production") {
    pushIssue(errors, "error", "EMAIL_PROVIDER_INVALID", 'Production must use AUTH_EMAIL_PROVIDER="resend" or "smtp".');
  } else {
    pushIssue(
      warnings,
      "warning",
      "EMAIL_PROVIDER_CONSOLE",
      'AUTH_EMAIL_PROVIDER="console" is acceptable for a controlled staging rehearsal, but real inbox delivery will not occur.',
    );
  }
} else {
  if (target === "development") {
    pushIssue(
      notes,
      "note",
      "EMAIL_PROVIDER_FILE",
      'AUTH_EMAIL_PROVIDER="file" is fine for local signup testing when AUTH_EMAIL_OUTBOX_DIR is writable.',
    );
  } else {
    pushIssue(
      errors,
      "error",
      "EMAIL_PROVIDER_FILE_BLOCKED",
      `AUTH_EMAIL_PROVIDER="file" is not valid for ${target}. Use resend or smtp for smooth live signup delivery.`,
    );
  }
}

if (emailProvider === "file" && !hasValue(envValue("AUTH_EMAIL_OUTBOX_DIR")) && target === "development") {
  pushIssue(
    warnings,
    "warning",
    "OUTBOX_DIR_MISSING",
    "AUTH_EMAIL_OUTBOX_DIR is unset. The API will fall back to storage/auth-email-outbox locally.",
  );
}

if (isTrue("FEATURE_STRIPE_BILLING_ENABLED")) {
  if (!hasValue(envValue("STRIPE_SECRET_KEY"))) {
    pushIssue(errors, "error", "STRIPE_SECRET_MISSING", "Set STRIPE_SECRET_KEY or disable FEATURE_STRIPE_BILLING_ENABLED.");
  }
  for (const key of ["STRIPE_PRICE_ID_STARTER", "STRIPE_PRICE_ID_GROWTH", "STRIPE_PRICE_ID_ENTERPRISE"]) {
    if (!hasValue(envValue(key))) {
      pushIssue(
        warnings,
        "warning",
        "STRIPE_PRICE_ID_MISSING",
        `${key} is missing. Signup will still create the tenant, but automatic subscription creation may be incomplete for one or more plans.`,
      );
    }
  }
} else {
  pushIssue(
    notes,
    "note",
    "STRIPE_OPTIONAL",
    "Stripe is optional. With FEATURE_STRIPE_BILLING_ENABLED=false, signup still works and the tenant lands on the internal STARTER/trial path.",
  );
}

if (target !== envValue("APP_ENV").toLowerCase() && hasValue(envValue("APP_ENV"))) {
  pushIssue(
    warnings,
    "warning",
    "APP_ENV_TARGET_MISMATCH",
    `You ran the check with target=${target}, but APP_ENV=${envValue("APP_ENV")}. Double-check which environment file you loaded.`,
  );
}

pushIssue(
  notes,
  "note",
  "EXTERNAL_SERVICES",
  "External dependencies for smooth live signup: Postgres, Redis, a public web domain, a public API base URL, and either Resend or a verified SMTP provider.",
);

console.log(`Public signup readiness check for target=${target}`);
if (apiBase) {
  console.log(`Resolved web->API base from ${apiBase.key}=${apiBase.value}`);
}
if (webBase) {
  console.log(`Resolved signup email web base from ${webBase.key}=${webBase.value}`);
}

printIssues("Errors", errors);
printIssues("Warnings", warnings);
printIssues("Notes", notes);

if (errors.length > 0) {
  console.log(`\nResult: FAIL (${errors.length} error${errors.length === 1 ? "" : "s"})`);
  process.exit(1);
}

console.log(`\nResult: PASS${warnings.length > 0 ? ` with ${warnings.length} warning${warnings.length === 1 ? "" : "s"}` : ""}`);
