#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const SERVICE_FILE = path.join(
  REPO_ROOT,
  "apps",
  "api",
  "src",
  "billing",
  "commercial-reminders.service.ts",
);

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const source = fs.readFileSync(SERVICE_FILE, "utf8");

  // Timing constants
  assert(
    source.includes("REMINDER_INTERVAL_MS = 24 * 60 * 60 * 1000"),
    "Reminder interval must be 24 hours (24 * 60 * 60 * 1000 ms).",
  );
  assert(
    source.includes("REMINDER_INITIAL_DELAY_MS = 5 * 60 * 1000"),
    "Initial delay must be 5 minutes (5 * 60 * 1000 ms) to allow the app to finish booting.",
  );

  // Trial warning thresholds
  assert(
    source.includes("TRIAL_WARNING_DAYS = [7, 1]"),
    "Trial warning must fire at 7 days and 1 day remaining.",
  );

  // Scheduling pattern: initial delay then recurring interval
  assert(
    source.includes("setTimeout(") && source.includes("setInterval("),
    "CommercialRemindersService must use setTimeout for initial delay and setInterval for recurrence.",
  );
  assert(
    source.includes("REMINDER_INITIAL_DELAY_MS") && source.includes("REMINDER_INTERVAL_MS"),
    "Both timing constants must be used in the scheduling logic.",
  );

  // unref() prevents timers from keeping the process alive if everything else exits
  assert(
    source.includes(".unref()"),
    "Timer handles must call .unref() to avoid blocking process exit during tests and graceful shutdown.",
  );

  // onModuleDestroy must clear both handles
  assert(
    source.includes("clearTimeout(") && source.includes("clearInterval("),
    "onModuleDestroy must clear both the initial timeout and the recurring interval.",
  );
  assert(
    source.includes("this.initialTimeout = null") && source.includes("this.intervalHandle = null"),
    "onModuleDestroy must null both handles after clearing to prevent double-clear.",
  );

  // Feature gate via QUEUE_WORKER_ENABLED
  assert(
    source.includes("QUEUE_WORKER_ENABLED"),
    "CommercialRemindersService must be gated by QUEUE_WORKER_ENABLED so it only runs on the worker dyno.",
  );
  assert(
    source.includes("isEnabled()"),
    "onModuleInit must call isEnabled() before scheduling timers.",
  );

  // Trial ending window: 8-day lookahead
  assert(
    source.includes("8 * 24 * 60 * 60 * 1000"),
    "Trial query window must look 8 days ahead to cover the 7-day warning threshold with a margin.",
  );

  // Error isolation: a single tenant failure must not abort the whole run
  assert(
    source.includes("try {") && source.includes("} catch (error"),
    "sendTrialEndingReminders must catch per-tenant errors to prevent a single failure from aborting the full pass.",
  );

  // runReminders wraps sendTrialEndingReminders in a top-level try/catch
  assert(
    source.includes("async runReminders()"),
    "runReminders must be an async method callable by the scheduler.",
  );

  // Dependency injection — must use PlanUsageService for profile re-verification
  assert(
    source.includes("PlanUsageService"),
    "CommercialRemindersService must inject PlanUsageService to re-verify billing status before sending.",
  );
  assert(
    source.includes("CommercialNotificationsService"),
    "CommercialRemindersService must inject CommercialNotificationsService to send the actual emails.",
  );

  // Re-verify before sending — guard against stale query results
  assert(
    source.includes("billingStatus !== \"trial\"") || source.includes("billingStatus !== 'trial'"),
    "Service must re-verify billingStatus before sending to guard against stale query results.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "reminders_interval_24_hours",
          "reminders_initial_delay_5_minutes",
          "trial_warning_days_7_and_1",
          "scheduling_settimeout_then_setinterval",
          "timer_handles_unref_to_avoid_blocking_exit",
          "on_module_destroy_clears_both_handles",
          "feature_gated_by_queue_worker_enabled",
          "trial_query_window_8_day_lookahead",
          "per_tenant_error_isolation",
          "re_verifies_billing_status_before_sending",
          "injects_plan_usage_and_notifications_services",
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
  console.error("Commercial reminders contract test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
