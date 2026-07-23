#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "../../../..");

const PUBLIC_MARKETING_FILES = [
  "wordpress/wp-content/themes/vexa-pim/front-page.php",
  "wordpress/wp-content/themes/vexa-pim/page-plans.php",
  "wordpress/wp-content/themes/vexa-pim/functions.php",
];

const PUBLIC_POLICY_FILES = ["docs/product/pricing.md"];

const PRICE_AMOUNT_PATTERNS = [
  { name: "rupee symbol", regex: /₹/ },
  { name: "INR price amount", regex: /\bINR\s*\d/i },
  { name: "from-price phrasing", regex: /\bfrom\s+(₹|INR|\$|USD|EUR|GBP)/i },
];

const COMMERCIAL_TERM_PATTERNS = [
  { name: "annual contract value", regex: /\bannual contract (value|total)\b/i },
  { name: "setup fee", regex: /\bsetup fee\b/i },
  { name: "implementation range", regex: /\bimplementation (range|price|fee)s?\b/i },
  { name: "discount percentage", regex: /\bdiscount (percentage|percent|%)\b/i },
];

const UNAPPROVED_LIMIT_PATTERNS = [
  { name: "public SKU limit", regex: /\b\d[\d,]*\s+(active\s+)?SKUs?\b/i },
  { name: "public user limit", regex: /\b\d[\d,]*\s+users?\b/i },
  { name: "public connector limit", regex: /\b\d[\d,]*\s+(controlled\s+)?connector installations?\b/i },
  { name: "public storage limit", regex: /\b\d[\d,]*\s*GB\b/i },
  { name: "public import limit", regex: /\b\d[\d,]*\s+rows?\s+per\s+import\b/i },
];

function read(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

function failOnMatches(patterns, relativePath, source) {
  const failures = [];
  for (const pattern of patterns) {
    if (pattern.regex.test(source)) {
      failures.push(`${relativePath}: ${pattern.name}`);
    }
  }
  return failures;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run() {
  const failures = [];
  for (const relativePath of PUBLIC_MARKETING_FILES) {
    const source = read(relativePath);
    failures.push(...failOnMatches(PRICE_AMOUNT_PATTERNS, relativePath, source));
    failures.push(...failOnMatches(COMMERCIAL_TERM_PATTERNS, relativePath, source));
    failures.push(...failOnMatches(UNAPPROVED_LIMIT_PATTERNS, relativePath, source));
  }
  for (const relativePath of PUBLIC_POLICY_FILES) {
    const source = read(relativePath);
    failures.push(...failOnMatches(PRICE_AMOUNT_PATTERNS, relativePath, source));
    failures.push(...failOnMatches(UNAPPROVED_LIMIT_PATTERNS, relativePath, source));
  }

  if (failures.length > 0) {
    throw new Error(`No-public-pricing policy failed:\n${failures.join("\n")}`);
  }

  const publicPricingDoc = read("docs/product/pricing.md");
  const publicPlansPage = read("wordpress/wp-content/themes/vexa-pim/page-plans.php");
  assert(publicPricingDoc.includes("Start Free Trial"), "Public pricing doc must retain the approved Free Trial CTA.");
  assert(publicPricingDoc.includes("No production SLA"), "Public pricing doc must disclose the Trial has no production SLA.");
  assert(
    /must not imply[\s\S]{0,180}free\s+implementation[\s\S]{0,180}unlimited\s+support[\s\S]{0,180}permanent\s+free\s+access/i.test(
      publicPricingDoc,
    ),
    "Public pricing doc must explicitly restrict Free Trial support, implementation, and access claims.",
  );
  assert(publicPlansPage.includes("'cta' => 'Start Free Trial'"), "Trial public card must use Start Free Trial.");
  assert(publicPlansPage.includes("'cta' => 'Contact Sales'"), "Starter and Enterprise public cards must include Contact Sales.");
  assert(publicPlansPage.includes("'cta' => 'Book a Demo'"), "Growth public card must use Book a Demo.");
  assert(publicPlansPage.includes("'cta' => 'Talk to Sales'"), "Business public card must use Talk to Sales.");

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "public_marketing_surfaces_do_not_expose_prices",
          "public_marketing_surfaces_do_not_expose_unapproved_numeric_limits",
          "public_pricing_policy_keeps_free_trial_restricted",
          "public_plan_ctas_match_no_price_rollout_policy",
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
  console.error("No-public-pricing policy test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
