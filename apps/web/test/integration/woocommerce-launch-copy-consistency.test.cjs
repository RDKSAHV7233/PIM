#!/usr/bin/env node
/* eslint-disable no-console */
//
// Regression test for PIM#633: WooCommerce's customer-facing readiness copy made two
// claims that didn't match actual behavior:
//   - "Contact your account manager for early access" (connector-launch-policy.ts) — implied
//     install requires approval, but isInstallableStage() treats "code_complete" as
//     unconditionally installable; no tenant-level early-access check exists anywhere.
//   - "blocked from publish while QA validation and PO review are pending"
//     (apps/web/src/app/connectors/setup/page.tsx) — implied publish itself is gated, but
//     a live install exposes full Publish/Validate/Status sync/Webhook support with no
//     publish-time stage check.
//
// Both were live-verified false: a plain self-serve customer installed WooCommerce with
// zero account-manager contact and the account went straight to ACTIVE with full publish
// capability. This test asserts the false claims are gone from both source files and
// replaced with copy that doesn't promise a gate that isn't enforced in code.
//
// 2026-09-04 update: the controlled-pilot-approved copy was suppressed while
// P1-1/P1-2 blocker closure was open. WooCommerce was hidden/blocked from customer
// setup/install lanes until fresh CTO/PO/Security/QA/SRE signoff.
//
// 2026-10-03 update (P1 CLOSED, E2E PASSED): P1-1 and P1-2 blockers formally closed, full
// E2E battery passed with QA/PO/required-team signoff. WooCommerce advances to early_access.
// New customer installs are now open (early_access is in isInstallableStage/isSetupLaneStage).
//
// 2026-10-05 update (governance correction): the 2026-10-03 closure is superseded and p1_blocker_hold is
// restored (docs/decisions/DR-2026-10-05-woocommerce-p1-governance.md). New installs and customer rollout are
// paused until the closure criteria are recorded. Manual key installation is the supported onboarding; app
// authorization is not supported. The 2026-10-03 events remain historical; this test now pins the hold.
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const LAUNCH_POLICY_FILE = path.join(REPO_ROOT, "apps", "api", "src", "connector-framework", "connector-launch-policy.ts");
const SETUP_PAGE_FILE = path.join(REPO_ROOT, "apps", "web", "src", "app", "connectors", "setup", "page.tsx");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function extractFunction(source, fnName) {
  const startPattern = new RegExp(`function ${fnName}\\s*\\(`);
  const match = source.match(startPattern);
  assert(match, `Could not locate function ${fnName} in source.`);
  const startIndex = match.index;

  const openParenIndex = source.indexOf("(", startIndex);
  let parenDepth = 0;
  let paramsEndIndex = -1;
  for (let i = openParenIndex; i < source.length; i++) {
    if (source[i] === "(") parenDepth++;
    else if (source[i] === ")") {
      parenDepth--;
      if (parenDepth === 0) {
        paramsEndIndex = i;
        break;
      }
    }
  }
  assert(paramsEndIndex !== -1, `Could not find end of parameter list for ${fnName}.`);

  let typeDepth = 0;
  let bodyStart = -1;
  for (let i = paramsEndIndex + 1; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") {
      if (typeDepth === 0) {
        bodyStart = i;
        break;
      }
      typeDepth++;
    } else if (ch === "<") {
      typeDepth++;
    } else if (ch === "}" || ch === ">") {
      typeDepth--;
    }
  }
  assert(bodyStart !== -1, `Could not find body start for ${fnName}.`);

  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === "{") {
      depth++;
    } else if (source[i] === "}") {
      depth--;
      if (depth === 0) {
        return source.slice(startIndex, i + 1);
      }
    }
  }
  throw new Error(`Could not find closing brace for ${fnName}.`);
}

function loadRealConnectorStatusNote() {
  const source = fs.readFileSync(SETUP_PAGE_FILE, "utf8");
  const fnSource = extractFunction(source, "connectorStatusNote");
  const transpiled = ts.transpileModule(fnSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2019 },
  }).outputText;
  const factory = new Function(`${transpiled}\nreturn connectorStatusNote;`);
  return factory();
}

function run() {
  const launchPolicySource = fs.readFileSync(LAUNCH_POLICY_FILE, "utf8");
  const setupPageSource = fs.readFileSync(SETUP_PAGE_FILE, "utf8");

  // PIM#633 regressions — original false claims must remain absent
  assert(
    !launchPolicySource.includes("Contact your account manager for early access"),
    "PIM#633: connector-launch-policy.ts must not claim WooCommerce install requires account-manager " +
      "contact — isInstallableStage() allows any self-serve customer to install it directly, with no " +
      "tenant-level early-access check anywhere in connector-installer.service.ts.",
  );
  assert(
    !setupPageSource.includes("blocked from publish while QA validation and PO review are pending"),
    "PIM#633: apps/web/src/app/connectors/setup/page.tsx must not claim WooCommerce publish is blocked " +
      "— a live install exposes full Publish/Validate/Status sync/Webhook support with no publish-time " +
      "launch-stage check anywhere in the connector or submission pipeline.",
  );

  // GOVERNANCE CORRECTION (2026-10-05) — WooCommerce is back on p1_blocker_hold.
  // Other connectors legitimately use early_access, so assert on the WooCommerce block only.
  const wooStart = launchPolicySource.indexOf("if (slug === CONNECTOR_SLUGS.WOOCOMMERCE) {");
  assert(wooStart >= 0, "Could not locate the WooCommerce block in connector-launch-policy.ts.");
  const wooEnd = launchPolicySource.indexOf("if (slug === CONNECTOR_SLUGS.ZOHO_INVENTORY) {", wooStart);
  assert(wooEnd > wooStart, "Could not locate the end of the WooCommerce block in connector-launch-policy.ts.");
  const wooBlock = launchPolicySource.slice(wooStart, wooEnd);
  assert(
    wooBlock.includes('launchStage: "p1_blocker_hold"'),
    "connector-launch-policy.ts must put WooCommerce on p1_blocker_hold (governance correction 2026-10-05).",
  );
  assert(
    !wooBlock.includes('launchStage: "early_access"') && !wooBlock.includes('launchStage: "controlled_pilot"'),
    "REGRESSION GUARD: the WooCommerce block must not be early_access or controlled_pilot until the closure criteria in DR-2026-10-05 are recorded.",
  );

  // The superseded early_access copy must be gone from both surfaces.
  const STALE_EARLY_ACCESS_COPY =
    "WooCommerce is in early access. Single-product publish, edit/republish, status sync, credential management, and reconnect are verified. Multi-variant publishing is not yet verified for production use.";
  assert(
    !launchPolicySource.includes(STALE_EARLY_ACCESS_COPY),
    "The superseded early_access copy must be removed from connector-launch-policy.ts.",
  );
  assert(
    !setupPageSource.includes(STALE_EARLY_ACCESS_COPY),
    "The superseded early_access copy must be removed from apps/web/src/app/connectors/setup/page.tsx.",
  );

  // Hold copy consistency — launchNote in policy and connectorStatusNote in setup page must agree
  const WOOCOMMERCE_HOLD_COPY =
    "WooCommerce is on a P1 release hold. New installs and customer rollout are paused until the current CTO, PO, Security, QA, and SRE approvals and production database-isolation evidence are recorded. Connect with WooCommerce REST API keys (manual key installation); WooCommerce app authorization is not supported.";
  assert(
    launchPolicySource.includes(WOOCOMMERCE_HOLD_COPY),
    "connector-launch-policy.ts's WooCommerce launchNote must state the hold copy.",
  );
  assert(
    setupPageSource.includes(WOOCOMMERCE_HOLD_COPY),
    "apps/web/src/app/connectors/setup/page.tsx must carry matching hold copy in connectorStatusNote.",
  );
  assert(
    /manual key installation/i.test(WOOCOMMERCE_HOLD_COPY) && /app authorization is not supported/i.test(WOOCOMMERCE_HOLD_COPY),
    "The hold copy must state that manual key installation is the supported onboarding and app authorization is not supported.",
  );

  // Pre-2026-09-03 stale copy must still be absent
  assert(
    !launchPolicySource.includes("code-complete (W1–W10) and available to install and use now. General-availability sign-off") &&
      !setupPageSource.includes("is code-complete and available to install and use now. General-availability sign-off"),
    "The pre-2026-09-03 'code-complete... GA sign-off in progress' copy must not remain in either file.",
  );

  // New installs are PAUSED — neither p1_blocker_hold nor controlled_pilot is a customer setup lane
  assert(
    !extractFunction(setupPageSource, "isSetupLaneStage").includes("p1_blocker_hold"),
    "apps/web/src/app/connectors/setup/page.tsx must not include p1_blocker_hold in customer setup lanes.",
  );
  assert(
    !extractFunction(setupPageSource, "isSetupLaneStage").includes('"controlled_pilot"'),
    "apps/web/src/app/connectors/setup/page.tsx must not include controlled_pilot in customer setup lanes.",
  );

  // Live-verified: connectorStatusNote executes and returns the hold copy
  const connectorStatusNote = loadRealConnectorStatusNote();
  const liveResult = connectorStatusNote("woocommerce", "partial");
  assert(
    liveResult === WOOCOMMERCE_HOLD_COPY,
    "connectorStatusNote('woocommerce', 'partial') must return the hold copy. Got: " + JSON.stringify(liveResult),
  );
  assert(
    connectorStatusNote("woocommerce", "full") === WOOCOMMERCE_HOLD_COPY,
    "connectorStatusNote('woocommerce', 'full') must also return the hold copy.",
  );

  // Duplicate-banner dedupe guard must remain (PIM#633 follow-up)
  assert(
    setupPageSource.includes("statusNote && statusNote !== definition.launchNote"),
    "apps/web/src/app/connectors/setup/page.tsx must not render the statusNote banner when it " +
      "duplicates definition.launchNote verbatim.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        validated: [
          "no_false_account_manager_gate_claim",
          "no_false_publish_blocked_claim",
          "woocommerce_block_uses_p1_blocker_hold",
          "woocommerce_block_not_early_access_or_controlled_pilot",
          "superseded_early_access_copy_removed",
          "hold_copy_consistent_between_policy_and_setup_page",
          "hold_copy_states_manual_key_and_no_app_auth",
          "stale_pre_2026_09_03_copy_absent",
          "hold_and_pilot_not_customer_setup_lanes",
          "woocommerce_status_note_returns_hold_copy",
          "duplicate_banner_dedupe_guard_present",
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
  console.error("WooCommerce launch copy consistency test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
