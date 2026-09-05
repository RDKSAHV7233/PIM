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
// 2026-09-04 update: the controlled-pilot-approved copy is no longer current while
// P1-1/P1-2 blocker closure is open. WooCommerce must be hidden/blocked from customer
// setup/install lanes until fresh CTO/PO/Security/QA/SRE signoff exists.
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

  const WOOCOMMERCE_POLICY_HOLD_COPY =
    "WooCommerce onboarding and install are paused while P1 blocker closure is in progress. P1-1 tenant-owned app-auth credential verification, P1-2 auth revocation policy, staging runtime proof, and fresh CTO/PO/Security/QA/SRE signoff are required before any customer pilot restarts.";
  const WOOCOMMERCE_SETUP_HOLD_COPY =
    "WooCommerce setup is paused while P1 blocker closure is in progress. Customer self-serve install and pilot onboarding require fresh CTO/PO/Security/QA/SRE signoff after P1-1 and P1-2 are closed.";

  assert(
    launchPolicySource.includes('launchStage: "p1_blocker_hold"'),
    "connector-launch-policy.ts must put WooCommerce in p1_blocker_hold while P1 closure is open.",
  );
  assert(
    launchPolicySource.includes(WOOCOMMERCE_POLICY_HOLD_COPY),
    "connector-launch-policy.ts's WooCommerce launchNote must state the P1 hold and fresh signoff gate.",
  );
  assert(
    setupPageSource.includes(WOOCOMMERCE_SETUP_HOLD_COPY),
    "apps/web/src/app/connectors/setup/page.tsx must carry hold copy if WooCommerce status text is evaluated.",
  );
  assert(
    !launchPolicySource.includes("code-complete (W1–W10) and available to install and use now. General-availability sign-off") &&
      !setupPageSource.includes("is code-complete and available to install and use now. General-availability sign-off"),
    "The pre-2026-09-03 'code-complete... GA sign-off in progress' copy must not remain in either " +
      "file because WooCommerce is now on P1 blocker-closure hold.",
  );
  assert(
    !launchPolicySource.includes("approved for CTO/PO-signed controlled pilot use") &&
      !setupPageSource.includes("approved for CTO/PO-signed controlled pilot use"),
    "WooCommerce must not claim CTO/PO-controlled-pilot approval while the P1 blocker hold is open.",
  );
  assert(
    !launchPolicySource.includes("available to install and use now") &&
      !setupPageSource.includes("available to install and use now"),
    "WooCommerce must not claim it is available to install and use now while the P1 blocker hold is open.",
  );
  assert(
    !setupPageSource.includes('stage === "controlled_pilot"') ||
      !extractFunction(setupPageSource, "isSetupLaneStage").includes('stage === "controlled_pilot"'),
    "apps/web/src/app/connectors/setup/page.tsx must not include controlled_pilot in customer setup lanes.",
  );
  assert(
    !extractFunction(setupPageSource, "isSetupLaneStage").includes("p1_blocker_hold"),
    "apps/web/src/app/connectors/setup/page.tsx must not include p1_blocker_hold in customer setup lanes.",
  );

  // Live-verified follow-up: WooCommerce's implementationStatus resolves to "partial", and
  // connectorStatusNote() checked `implementationStatus === "partial"` FIRST — returning the
  // generic "This connector has limited functionality" fallback before ever reaching the
  // `slug === "woocommerce"` branch below it. The corrected string above was therefore dead
  // code: present in source, never actually rendered. Execute the real function (not just
  // grep its source) to prove the WooCommerce-specific message is now genuinely reachable
  // when implementationStatus is "partial" — matching how meesho/myntra are already handled.
  const connectorStatusNote = loadRealConnectorStatusNote();
  const liveResult = connectorStatusNote("woocommerce", "partial");
  assert(
    liveResult === WOOCOMMERCE_SETUP_HOLD_COPY,
    "connectorStatusNote('woocommerce', 'partial') must return the current WooCommerce hold " +
      `message, not the generic partial-connector fallback or a pilot-open copy. Got: ${JSON.stringify(liveResult)}. ` +
      "The woocommerce check must be evaluated inside the `implementationStatus === \"partial\"` branch " +
      "(alongside meesho/myntra), not after it, or it can never be reached for this connector.",
  );

  // 2026-09-04: fixed a real duplicate-banner bug — the setup page rendered both
  // definition.launchNote and statusNote as separate stacked amber boxes even when they
  // carried the same text (WooCommerce's case). The render now skips statusNote when it is
  // identical to definition.launchNote. Guard that this dedupe condition exists in source, so
  // a future edit that makes the two WooCommerce strings diverge doesn't silently reintroduce
  // two boxes showing the same sentence twice.
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
          "launch_policy_uses_p1_blocker_hold",
          "setup_page_note_blocks_customer_onboarding",
          "stale_pre_2026_09_03_copy_absent",
          "controlled_pilot_approval_copy_absent",
          "install_use_now_copy_absent",
          "woocommerce_hidden_from_customer_setup_lanes",
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
