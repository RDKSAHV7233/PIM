#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const WEB_SRC = path.join(REPO_ROOT, "apps", "web", "src");
const API_SRC = path.join(REPO_ROOT, "apps", "api", "src");

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readWeb(relPath) {
  return fs.readFileSync(path.join(WEB_SRC, relPath), "utf8");
}

function readApi(relPath) {
  return fs.readFileSync(path.join(API_SRC, relPath), "utf8");
}

function run() {
  // ── 1. Webhook SSRF: URL safety module exists ──────────────────────────
  const urlSafety = readApi("common/security/url-safety.ts");
  assert(
    urlSafety.includes("validateWebhookTargetUrl"),
    "URL safety module must export validateWebhookTargetUrl.",
  );
  assert(
    urlSafety.includes("resolve4") || urlSafety.includes("dns"),
    "URL safety must perform DNS resolution to catch SSRF via hostname.",
  );
  assert(
    urlSafety.includes("169.254"),
    "URL safety must block the cloud metadata IP range (169.254.0.0/16).",
  );
  assert(
    urlSafety.includes('protocol !== "https:"'),
    "URL safety must enforce HTTPS-only.",
  );

  // ── 2. Webhook DTOs require HTTPS ──────────────────────────────────────
  const createDto = readApi("outbound-webhooks/dto/create-outbound-webhook.dto.ts");
  assert(
    createDto.includes("Matches") && createDto.includes("https"),
    "Create webhook DTO must have @Matches for HTTPS enforcement.",
  );

  const updateDto = readApi("outbound-webhooks/dto/update-outbound-webhook.dto.ts");
  assert(
    updateDto.includes("Matches") && updateDto.includes("https"),
    "Update webhook DTO must have @Matches for HTTPS enforcement.",
  );

  // ── 3. Webhook service uses async SSRF-safe validation ─────────────────
  const webhookService = readApi("outbound-webhooks/outbound-webhooks.service.ts");
  assert(
    webhookService.includes("validateWebhookTargetUrl"),
    "Webhook service must use validateWebhookTargetUrl instead of inline normalizeTargetUrl.",
  );
  assert(
    webhookService.includes("await this.normalizeTargetUrl"),
    "Webhook service normalizeTargetUrl must be awaited (async SSRF check).",
  );

  // ── 4. API key auto-clear ──────────────────────────────────────────────
  const apiKeyPanel = readWeb("app/admin/api-keys/api-key-create-panel.tsx");
  assert(
    apiKeyPanel.includes("API_KEY_DISPLAY_SECONDS") || apiKeyPanel.includes("secondsLeft"),
    "API key panel must have an auto-clear countdown timer.",
  );
  assert(
    apiKeyPanel.includes("navigator.clipboard.writeText"),
    "API key panel must have a copy-to-clipboard button.",
  );
  assert(
    apiKeyPanel.includes("cannot be retrieved again"),
    "API key panel must show a 'cannot be retrieved' message after auto-clear.",
  );

  // ── 5. Lock duration whitelist — server action ─────────────────────────
  const lockAction = readWeb("app/admin/users/actions.ts");
  assert(
    lockAction.includes("ALLOWED_LOCK_DURATIONS"),
    "Lock action must define an ALLOWED_LOCK_DURATIONS whitelist.",
  );
  assert(
    lockAction.includes("60") && lockAction.includes("240") &&
      lockAction.includes("1440") && lockAction.includes("10080"),
    "ALLOWED_LOCK_DURATIONS must include [60, 240, 1440, 10080].",
  );
  assert(
    lockAction.includes("Invalid lock duration"),
    "Lock action must reject durations not in the whitelist.",
  );

  // ── 6. Lock duration whitelist — DTO ───────────────────────────────────
  const lockDto = readApi("workspace-users/dto/lock-workspace-user.dto.ts");
  assert(
    lockDto.includes("@IsIn") && lockDto.includes("60") && lockDto.includes("10080"),
    "Lock workspace user DTO must use @IsIn with allowed durations.",
  );

  // ── 7. Cron validation — DTO ───────────────────────────────────────────
  const cronDto = readApi("marketplace/dto/upsert-schedule.dto.ts");
  assert(
    cronDto.includes("CronExpressionConstraint") || cronDto.includes("@Validate"),
    "Cron DTO must use a custom validator with field-value range checks.",
  );
  assert(
    cronDto.includes("CRON_FIELD_RANGES"),
    "Cron validator must define per-field value ranges.",
  );

  // ── 8. Cron validation — service ───────────────────────────────────────
  const marketplaceService = readApi("marketplace/marketplace.service.ts");
  assert(
    marketplaceService.includes("CRON_FIELD_RANGES") ||
      marketplaceService.includes("values in range"),
    "Marketplace service must validate cron field value ranges, not just field count.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "url_safety_module_exists_with_dns_resolution",
          "url_safety_enforces_https_only",
          "url_safety_blocks_metadata_ip",
          "create_webhook_dto_https_match",
          "update_webhook_dto_https_match",
          "webhook_service_uses_ssrf_safe_validation",
          "webhook_service_awaits_async_check",
          "api_key_auto_clear_countdown",
          "api_key_copy_to_clipboard",
          "api_key_hidden_message",
          "lock_action_whitelist_defined",
          "lock_action_whitelist_values",
          "lock_action_rejects_invalid",
          "lock_dto_isin_decorator",
          "cron_dto_custom_validator",
          "cron_dto_field_ranges",
          "cron_service_field_range_validation",
        ],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
}

try {
  run();
} catch (error) {
  console.error("Security webhook/apikey/input test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
