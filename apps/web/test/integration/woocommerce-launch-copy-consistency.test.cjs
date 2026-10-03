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

  // E2E BATTERY PASSED (2026-10-03) — WooCommerce advanced to early_access
  assert(
    launchPolicySource.includes('launchStage: "early_access"'),
    "REGRESSION GUARD: connector-launch-policy.ts must put WooCommerce in early_access after E2E battery sign-off (2026-10-03).",
  );
  assert(
    !launchPolicySource.includes('launchStage: "controlled_pilot"'),
    "REGRESSION GUARD: connector-launch-policy.ts must NOT have WooCommerce in controlled_pilot — E2E battery passed, advanced to early_access (2026-10-03).",
  );
  assert(
    !launchPolicySource.includes('launchStage: "p1_blocker_hold"'),
    "REGRESSION GUARD: connector-launch-policy.ts must NOT have WooCommerce in p1_blocker_hold — P1-1 and P1-2 are closed (2026-10-03).",
  );

  // Stale copy must be gone
  const STALE_HOLD_COPY =
    "WooCommerce onboarding and install are paused while P1 blocker closure is in progress. P1-1 tenant-owned app-auth credential verification, P1-2 auth revocation policy, staging runtime proof, and fresh CTO/PO/Security/QA/SRE signoff are required before any customer pilot restarts.";
  const STALE_SETUP_HOLD_COPY =
    "WooCommerce setup is paused while P1 blocker closure is in progress. Customer self-serve install and pilot onboarding require fresh CTO/PO/Security/QA/SRE signoff after P1-1 and P1-2 are closed.";
  const STALE_PILOT_COPY =
    "WooCommerce pilot (vexapim.com, installation 4cc83efd-a71b-4d61-8649-299795c35e11) running under controlled conditions. P1-1 and P1-2 blockers closed 2026-10-03. New customer installs require QA/PO gate before advancing to early_access.";
  assert(
    !launchPolicySource.includes(STALE_HOLD_COPY),
    "The P1-open hold copy must be removed from connector-launch-policy.ts.",
  );
  assert(
    !setupPageSource.includes(STALE_SETUP_HOLD_COPY),
    "The P1-open hold copy must be removed from apps/web/src/app/connectors/setup/page.tsx.",
  );
  assert(
    !launchPolicySource.includes(STALE_PILOT_COPY),
    "The controlled_pilot copy must be removed from connector-launch-policy.ts now that WooCommerce is at early_access.",
  );
  assert(
    !setupPageSource.includes(STALE_PILOT_COPY),
    "The controlled_pilot copy must be removed from apps/web/src/app/connectors/setup/page.tsx now that WooCommerce is at early_access.",
  );

  // Early access copy consistency — launchNote in policy and connectorStatusNote in setup page must agree
  const WOOCOMMERCE_EARLY_ACCESS_COPY =
    "WooCommerce is in early access. Single-product publish, edit/republish, status sync, credential management, and reconnect are verified. Multi-variant publishing is not yet verified for production use.";
  assert(
    launchPolicySource.includes(WOOCOMMERCE_EARLY_ACCESS_COPY),
    "connector-launch-policy.ts's WooCommerce launchNote must state the early_access copy.",
  );
  assert(
    setupPageSource.includes(WOOCOMMERCE_EARLY_ACCESS_COPY),
    "apps/web/src/app/connectors/setup/page.tsx must carry matching early_access copy in connectorStatusNote.",
  );

  // Pre-2026-09-03 stale copy must still be absent
  assert(
    !launchPolicySource.includes("code-complete (W1–W10) and available to install and use now. General-availability sign-off") &&
      !setupPageSource.includes("is code-complete and available to install and use now. General-availability sign-off"),
    "The pre-2026-09-03 'code-complete... GA sign-off in progress' copy must not remain in either file.",
  );

  // New installs now OPEN — early_access IS in isSetupLaneStage; p1_blocker_hold and controlled_pilot must NOT be
  assert(
    extractFunction(setupPageSource, "isSetupLaneStage").includes('"early_access"'),
    "apps/web/src/app/connectors/setup/page.tsx must include early_access in customer setup lanes — WooCommerce is now open for new installs.",
  );
  assert(
    !extractFunction(setupPageSource, "isSetupLaneStage").includes('"controlled_pilot"'),
    "apps/web/src/app/connectors/setup/page.tsx must not include controlled_pilot in customer setup lanes.",
  );
  assert(
    !extractFunction(setupPageSource, "isSetupLaneStage").includes("p1_blocker_hold"),
    "apps/web/src/app/connectors/setup/page.tsx must not include p1_blocker_hold in customer setup lanes.",
  );

  // Live-verified: connectorStatusNote executes and returns the early_access copy
  const connectorStatusNote = loadRealConnectorStatusNote();
  const liveResult = connectorStatusNote("woocommerce", "partial");
  assert(
    liveResult === WOOCOMMERCE_EARLY_ACCESS_COPY,
    "connectorStatusNote('woocommerce', 'partial') must return the early_access copy, " +
      `not the controlled_pilot copy or generic partial-connector fallback. Got: ${JSON.stringify(liveResult)}. ` +
      "The woocommerce check must be evaluated inside the 'implementationStatus === \"partial\"' branch.",
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
          "launch_policy_uses_early_access_after_e2e_battery",
          "controlled_pilot_absent_from_launch_policy",
          "p1_blocker_hold_absent_from_launch_policy",
          "stale_p1_hold_copy_removed",
          "stale_controlled_pilot_copy_removed",
          "early_access_copy_consistent_between_policy_and_setup_page",
          "stale_pre_2026_09_03_copy_absent",
          "early_access_open_in_customer_setup_lanes",
          "woocommerce_status_note_genuinely_reachable_when_partial",
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
