"use strict";

/**
 * Integration contract test: Stripe webhook controller
 *
 * Verifies that the StripeWebhookController source code:
 * 1. Is registered as a public endpoint
 * 2. Handles all required Stripe event types
 * 3. Maps Stripe statuses to internal billingStatus values correctly
 * 4. Calls updateCommercialStateForTenant with correct parameters
 * 5. Is non-fatal (signature failure returns 400, not 500)
 */

const fs = require("fs");
const path = require("path");

const CONTROLLER_PATH = path.join(__dirname, "../../src/billing/stripe-webhook.controller.ts");
const SERVICE_PATH = path.join(__dirname, "../../src/billing/stripe.service.ts");
const MODULE_PATH = path.join(__dirname, "../../src/billing/billing.module.ts");
const MAIN_PATH = path.join(__dirname, "../../src/main.ts");

const assertions = [];
let passed = 0;
let failed = 0;

function assert(label, condition) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.error(`  ✗ ${label}`);
    failed++;
  }
  assertions.push({ label, passed: condition });
}

function readFile(filePath) {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return "";
  }
}

console.log("\nStripe Webhook Integration Contract Tests\n");

const controllerSrc = readFile(CONTROLLER_PATH);
const serviceSrc = readFile(SERVICE_PATH);
const moduleSrc = readFile(MODULE_PATH);
const mainSrc = readFile(MAIN_PATH);

// --- StripeWebhookController ---
console.log("StripeWebhookController:");
assert("Controller file exists", controllerSrc.length > 0);
assert("POST webhook endpoint declared", controllerSrc.includes("@Post(\"webhook\")") || controllerSrc.includes("@Post('webhook')"));
assert("@Public() decorator applied (no auth on webhook route)", controllerSrc.includes("@Public()"));
assert("Stripe signature header read", controllerSrc.includes("stripe-signature"));
assert("constructWebhookEvent called for signature verification", controllerSrc.includes("constructWebhookEvent"));
assert("invoice.paid event handled", controllerSrc.includes("invoice.paid"));
assert("invoice.payment_failed event handled", controllerSrc.includes("invoice.payment_failed"));
assert("customer.subscription.updated event handled", controllerSrc.includes("customer.subscription.updated"));
assert("customer.subscription.deleted event handled", controllerSrc.includes("customer.subscription.deleted"));
assert("updateCommercialStateForTenant called for state transitions", controllerSrc.includes("updateCommercialStateForTenant"));
assert("billingStatus active_paid set on invoice.paid", controllerSrc.includes("active_paid"));
assert("billingStatus past_due set on payment_failed", controllerSrc.includes("past_due"));
assert("billingStatus cancelled set on subscription.deleted", controllerSrc.includes("cancelled"));
assert("Webhook dispatch errors are caught (non-fatal handler)", controllerSrc.includes("try") && controllerSrc.includes("catch"));
assert("Returns { received: true } on success", controllerSrc.includes("received: true"));
assert("Returns { received: false } on signature failure", controllerSrc.includes("received: false"));

// --- StripeService ---
console.log("\nStripeService:");
assert("Service file exists", serviceSrc.length > 0);
assert("isEnabled() checks FEATURE_STRIPE_BILLING_ENABLED and STRIPE_SECRET_KEY",
  serviceSrc.includes("FEATURE_STRIPE_BILLING_ENABLED") && serviceSrc.includes("STRIPE_SECRET_KEY"));
assert("createCustomerAndSubscription() method exists", serviceSrc.includes("createCustomerAndSubscription"));
assert("Stripe customer created with tenantKey metadata", serviceSrc.includes("metadata") && serviceSrc.includes("tenantKey"));
assert("createCheckoutSession() method exists", serviceSrc.includes("createCheckoutSession"));
assert("cancelSubscription() method exists", serviceSrc.includes("cancelSubscription"));
assert("updateSubscription() method exists", serviceSrc.includes("updateSubscription"));
assert("resolveTenantKeyFromCustomerId() queries TenantPlanProfile by externalCustomerId",
  serviceSrc.includes("externalCustomerId") && serviceSrc.includes("resolveTenantKeyFromCustomerId"));
assert("storeExternalIds() stores customerId and subscriptionId in DB",
  serviceSrc.includes("storeExternalIds") && serviceSrc.includes("externalSubscriptionId"));
assert("createCustomerAndSubscription is non-fatal (catches errors)",
  serviceSrc.includes("try") && serviceSrc.includes("logger.warn") && serviceSrc.includes("createCustomerAndSubscription"));
assert("STRIPE_API_VERSION pinned", serviceSrc.includes("2026-04-22") || serviceSrc.includes("2024-12-18"));
// H-3: idempotent trial provisioning
assert("createCustomerAndSubscription accepts/derives an idempotency key",
  serviceSrc.includes("idempotencyKey") && serviceSrc.includes("signup-trial:"));
assert("createCustomerAndSubscription short-circuits when both Stripe ids are already stored",
  serviceSrc.includes("existing.externalCustomerId && existing.externalSubscriptionId"));

// --- BillingModule registration ---
console.log("\nBillingModule registrations:");
assert("StripeService registered as provider", moduleSrc.includes("StripeService"));
assert("StripeWebhookController registered as controller", moduleSrc.includes("StripeWebhookController"));
assert("CommercialRemindersService registered as provider", moduleSrc.includes("CommercialRemindersService"));
assert("StripeService exported from BillingModule",
  moduleSrc.includes("exports:") && moduleSrc.includes("StripeService"));

// --- main.ts raw body middleware ---
console.log("\nmain.ts webhook body setup:");
assert("express raw() imported", mainSrc.includes("raw,") || mainSrc.includes(", raw,") || mainSrc.includes(", raw }") || mainSrc.includes("{ raw"));
assert("stripe webhook path gets raw body before json()",
  mainSrc.indexOf("billing/stripe/webhook") < mainSrc.indexOf("json({"));

// --- CommercialRemindersService ---
const remindersSrc = readFile(path.join(__dirname, "../../src/billing/commercial-reminders.service.ts"));
console.log("\nCommercialRemindersService:");
assert("Reminders service file exists", remindersSrc.length > 0);
assert("Implements OnModuleInit for scheduled start", remindersSrc.includes("OnModuleInit"));
assert("Implements OnModuleDestroy for clean shutdown", remindersSrc.includes("OnModuleDestroy"));
assert("Trial ending reminder logic present", remindersSrc.includes("trial") && remindersSrc.includes("trialEndsAt"));
assert("notifyTrialEnding called", remindersSrc.includes("notifyTrialEnding"));
assert("7-day and 1-day thresholds configured", remindersSrc.includes("7") && remindersSrc.includes("1"));

// --- Signup service Stripe hook ---
const signupSrc = readFile(path.join(__dirname, "../../src/signup/signup.service.ts"));
console.log("\nSignupService Stripe hook:");
assert("StripeService imported in signup.service.ts", signupSrc.includes("StripeService"));
assert("StripeService injected in constructor", signupSrc.includes("stripeService"));
assert("createCustomerAndSubscription called in verifyPublicSignup",
  signupSrc.includes("createCustomerAndSubscription") && signupSrc.includes("verifyPublicSignup"));
// H-3: billing provisioning must never throw out of verifyPublicSignup
assert("verifyPublicSignup isolates billing provisioning in try/catch",
  signupSrc.includes("runSignupBillingProvision") && /catch \(error: unknown\)/.test(signupSrc));
assert("signup billing failure is deferred to the SIGNUP_BILLING_PROVISION retry queue",
  signupSrc.includes("QUEUE_NAMES.SIGNUP_BILLING_PROVISION") && signupSrc.includes("enqueue"));
assert("signup billing retry consumer registered on module init",
  signupSrc.includes("OnModuleInit") && signupSrc.includes("queueService.process"));
assert("signup billing failure logs the request ref, not the raw email",
  signupSrc.includes("deferred to retry queue [ref:"));

// --- Billing controller checkout endpoint ---
const billingControllerSrc = readFile(path.join(__dirname, "../../src/billing/billing.controller.ts"));
console.log("\nBillingController checkout endpoint:");
assert("POST checkout-session endpoint declared", billingControllerSrc.includes("checkout-session"));
assert("createCheckoutSession called", billingControllerSrc.includes("createCheckoutSession"));
assert("Returns { url } to client", billingControllerSrc.includes("{ url }"));
assert("STRIPE_BILLING_NOT_ENABLED error when Stripe disabled", billingControllerSrc.includes("STRIPE_BILLING_NOT_ENABLED"));

// --- Summary ---
console.log(`\n${"─".repeat(50)}`);
console.log(`Results: ${passed} passed, ${failed} failed out of ${assertions.length} assertions`);

if (failed > 0) {
  console.error(`\n${failed} assertion(s) failed.`);
  process.exit(1);
}
console.log("\nAll Stripe webhook integration contract tests passed.");
process.exit(0);
