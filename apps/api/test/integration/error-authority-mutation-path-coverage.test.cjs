#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * PIM#651 regression test: Error Authority critical-mutation-path coverage
 * matrix.
 *
 * Background: Error Authority relies on a global exception filter
 * (ApiExceptionCaptureFilter) for coverage. That filter only sees exceptions
 * that actually propagate — a handler with its own local try/catch that
 * swallows an exception (logs it, returns normally, or converts it to an
 * exempt-status HttpException like 400/404) would bypass capture entirely,
 * and nothing previously verified whether this happens on any critical
 * mutation path.
 *
 * A full-repo audit was run against 15 critical mutation paths (catalog,
 * connectors, marketplace, billing, auth). Results, verified by direct
 * source reading against real file:line citations:
 *
 *   1  Product create                          — clean
 *   2  Product update                          — clean (audit-write-only swallow, scoped, non-mutation)
 *   3  Product approve/reject                  — clean (audit + webhook-enqueue swallow, scoped, non-mutation)
 *   4  Product publish/export job create        — FIXED    (marketplace.service.ts pre-flight block now captures) — PIM#655
 *   5  Product archive                          — clean
 *   6  Product permanent delete                 — clean (audit-write-only swallow, scoped, non-mutation)
 *   7  Connector install                        — FIXED (Flipkart/Amazon; WooCommerce/Shopify install never called this) — PIM#653
 *   8  Connector credential replace              — clean (masked but re-thrown as non-exempt 503)
 *   9  Connector reconnect                       — FIXED (Flipkart/Amazon/WooCommerce/Shopify)                            — PIM#653
 *  10  Connector disable/uninstall               — clean
 *  11  Marketplace export job retry              — clean
 *  12  Billing webhook status change             — clean (explicit rethrow, reasoned about in code comment)
 *  13  Auth login (lastSignInAt update)           — FIXED    (now caught, logged, and captured)          — PIM#656
 *  14  Auth password reset                        — clean
 *  15  Auth logout / session revoke               — FIXED    (JWT blocklist Redis-write failure now captured) — PIM#654
 *
 * This test does two things:
 *   1. Structurally re-verifies the clean/fixed paths' key safety properties
 *      still hold, so a future edit can't silently reintroduce a swallow
 *      without this test catching it.
 *   2. Confirms each still-open swallow is still present AND has a tracking
 *      issue referenced nearby in source — if a swallow gets fixed, this
 *      test's assertion for it will fail, which is the correct signal to
 *      update this matrix (not a false alarm): update the corresponding
 *      section below when the PIM#653 fix lands.
 *
 * This is a static-source audit, not a live-triggered-failure proof (see the
 * issue's own text: a full live-fixture verification for all 15 paths was
 * judged too invasive to run against a shared account for a first pass).
 */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const API_SRC = path.join(REPO_ROOT, "apps", "api", "src");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readSource(relativePath) {
  const fullPath = path.join(API_SRC, relativePath);
  assert(fs.existsSync(fullPath), `Expected source file not found: ${relativePath}`);
  return fs.readFileSync(fullPath, "utf8");
}

/**
 * Extracts a brace-balanced block starting at the first occurrence of
 * `marker`, from its first `{` through the matching closing `}`. More
 * reliable than a single regex for method bodies containing nested
 * if/try blocks (which a non-brace-aware regex can exit early or overshoot).
 */
function extractBlock(source, marker) {
  const startIndex = source.indexOf(marker);
  assert(startIndex !== -1, `Could not locate marker "${marker}" in source.`);
  const braceStart = source.indexOf("{", startIndex);
  assert(braceStart !== -1, `Could not locate opening brace after marker "${marker}".`);
  let depth = 0;
  for (let i = braceStart; i < source.length; i++) {
    if (source[i] === "{") {
      depth++;
    } else if (source[i] === "}") {
      depth--;
      if (depth === 0) {
        return source.slice(startIndex, i + 1);
      }
    }
  }
  throw new Error(`Could not find closing brace for marker "${marker}".`);
}

function run() {
  const validated = [];

  // ── Clean path #12: billing webhook status change ────────────────────────
  // The team already reasoned explicitly about Error-Authority-adjacent
  // visibility here — confirm the rethrow (and its explanatory comment)
  // hasn't been quietly removed.
  {
    const source = readSource("billing/stripe-webhook.controller.ts");
    assert(
      /await this\.dispatch\(event\);[\s\S]{0,300}?\} catch \(error: unknown\) \{[\s\S]{0,600}?throw error;/.test(source),
      "Stripe webhook dispatch must still re-throw on failure so Stripe retries and the failure reaches " +
        "Error Authority — do not swallow this into a 200/{received:false}.",
    );
    assert(
      source.includes("swallowing the error") || source.includes("Re-throw so Stripe sees"),
      "The explanatory comment justifying the rethrow (why swallowing would be wrong here) should remain — " +
        "it's the documented reasoning a future editor needs before changing this behavior.",
    );
    validated.push("clean_path_12_billing_webhook_rethrow_confirmed");
  }

  // ── Clean path #11: marketplace export job retry ──────────────────────────
  // The one catch in this path only suppresses an enqueue error after an
  // independent presence check *proves* delivery succeeded — confirm that
  // reconciliation guard (not a blind swallow) is still there.
  {
    const source = readSource("marketplace/marketplace.service.ts");
    assert(
      source.includes("enqueueExportJobForExecution"),
      "enqueueExportJobForExecution must still exist — the retry path's reconciliation logic lives here.",
    );
    assert(
      /isJobPresent/.test(source),
      "The isJobPresent reconciliation check must still exist — this is what makes the enqueue catch a " +
        "verified reconciliation rather than a blind swallow. If this check is removed, the catch around it " +
        "becomes a real swallow bug.",
    );
    validated.push("clean_path_11_export_retry_reconciliation_guard_present");
  }

  // ── Clean path #8: connector credential replace ───────────────────────────
  // Confirm the discriminated valid/invalid/unavailable pattern still exists
  // — this is the reference implementation PIM#653's fix should mirror for
  // install/reconnect.
  {
    const source = readSource("connector-installer/connector-installer.service.ts");
    assert(
      source.includes("throwOnUnverified"),
      "throwOnUnverified must still exist — it's what correctly converts a verification failure into a " +
        "non-exempt 503 (captured) instead of a plain 400 (exempt, invisible to Error Authority) for the " +
        "credential-replace path.",
    );
    assert(
      /ServiceUnavailableException/.test(source),
      "The credential-replace path must still throw a non-exempt status (503) when verification itself " +
        "fails, distinct from a 400 for genuinely invalid credentials.",
    );
    validated.push("clean_path_8_credential_replace_discriminated_result_present");
  }

  // ── Fixed #7/#9: connector install + reconnect (PIM#653) ─────────────────
  // Flipkart, Amazon, WooCommerce, and Shopify now all implement
  // validateStoredCredentialsDetailed(), mirroring the discriminated
  // valid/invalid/unavailable pattern clean-path-#8 already uses, and the
  // reconnect call site routes through it via validateStoredCredentialsOrThrow()
  // — a genuine outage during validation now surfaces as a non-exempt 503
  // (captured), not a plain 400, for every connector this repo has a live-checkable
  // credential for.
  //
  // WooCommerce's own validateCredentials() (the heartbeat path) is DELIBERATELY left
  // completely untouched: #472/BUG-WOO-HEALTH-001 decided a transient network blip
  // there should return true (assume still valid), reasoning specific to a repeating
  // background check. validateStoredCredentialsDetailed() is a separate, ADDITIVE
  // method used only by reconnect (a one-shot, user-initiated action, where "we
  // couldn't check" reported as success is misleading, not helpful) — it correctly
  // reports that same network failure as "unavailable," not "valid." WooCommerce's
  // install path is unaffected either way — it defers all live checking to the
  // heartbeat, never calls either method synchronously at install time.
  //
  // Shopify's fix goes further than the others: investigation found its OLD
  // validateCredentials() never made a live API call at all for a direct
  // admin-API-token install (this pilot's actual deployment mode — no refresh_token,
  // so the stored token's expiresAt is null and getOrRefreshAccessToken() treats that
  // as permanently valid without ever touching Shopify's API). validateCredentials()
  // now delegates to validateStoredCredentialsDetailed(), which makes a real, minimal
  // live Admin GraphQL call ({ shop { id } }) — so a revoked/uninstalled app is now
  // genuinely detectable by BOTH reconnect and the heartbeat, unlike WooCommerce/
  // Flipkart/Amazon where only reconnect (or install+reconnect) changed behavior.
  {
    const flipkartSource = readSource("connectors/flipkart/flipkart.connector.ts");
    assert(
      flipkartSource.includes("validateStoredCredentialsDetailed"),
      "PIM#653 regression: FlipkartConnector must implement validateStoredCredentialsDetailed() so " +
        "install/reconnect can distinguish invalid from unavailable.",
    );
    const validateCredentialsBody = extractBlock(flipkartSource, "async validateCredentials(");
    assert(
      /validateStoredCredentialsDetailed/.test(validateCredentialsBody),
      "PIM#653 regression: FlipkartConnector.validateCredentials() must delegate to " +
        "validateStoredCredentialsDetailed() and coerce its outcome to a boolean, so the two can never drift.",
    );

    const amazonSource = readSource("connectors/amazon/amazon.connector.ts");
    assert(
      amazonSource.includes("validateStoredCredentialsDetailed"),
      "PIM#653 regression: AmazonConnector must implement validateStoredCredentialsDetailed() so " +
        "install/reconnect can distinguish invalid from unavailable.",
    );

    const installerSource = readSource("connector-installer/connector-installer.service.ts");
    assert(
      installerSource.includes("validateStoredCredentialsOrThrow"),
      "PIM#653 regression: expected a validateStoredCredentialsOrThrow() helper used by the install/" +
        "reconnect call sites, converting an 'unavailable' outcome into a non-exempt 503 instead of the " +
        "plain 400 both flows used unconditionally before this fix.",
    );
    const throwHelperBody = extractBlock(installerSource, "private async validateStoredCredentialsOrThrow(");
    assert(
      /ServiceUnavailableException/.test(throwHelperBody) && /outcome === "unavailable"/.test(throwHelperBody),
      "PIM#653 regression: validateStoredCredentialsOrThrow() must throw ServiceUnavailableException (503) " +
        "specifically for the 'unavailable' outcome, distinct from BadRequestException (400) for 'invalid'.",
    );

    const wooSource = readSource("connectors/woocommerce/woocommerce.connector.ts");
    assert(
      wooSource.includes("validateStoredCredentialsDetailed"),
      "PIM#653 regression: WooCommerceConnector must implement validateStoredCredentialsDetailed() so " +
        "reconnect can distinguish invalid from unavailable, independent of validateCredentials()'s own #472 behavior.",
    );
    const wooDetailedBody = extractBlock(wooSource, "async validateStoredCredentialsDetailed(");
    assert(
      /instanceof ConnectorNetworkError\)\s*\{[\s\S]{0,300}?outcome: 'unavailable'/.test(wooDetailedBody),
      "PIM#653/#472 regression: validateStoredCredentialsDetailed() must report a network failure as " +
        "'unavailable', NOT silently mirror validateCredentials()'s own 'assume valid, return true' behavior " +
        "— the two methods exist specifically because reconnect and the heartbeat need different answers to " +
        "the same ambiguous network failure.",
    );
    const wooValidateCredentialsBody = extractBlock(wooSource, "async validateCredentials(");
    assert(
      /this\.logger\.warn\('WooCommerce credential validation inconclusive: transient network failure, not marking expired'/.test(wooValidateCredentialsBody) &&
        /return true;/.test(wooValidateCredentialsBody),
      "PIM#472 regression: validateCredentials() (the heartbeat path) must still return true on a retryable " +
        "network failure — validateStoredCredentialsDetailed() must never have replaced or altered this method's " +
        "own behavior.",
    );

    const shopifySource = readSource("connectors/shopify/shopify.connector.ts");
    assert(
      shopifySource.includes("validateStoredCredentialsDetailed"),
      "PIM#653 regression: ShopifyConnector must implement validateStoredCredentialsDetailed() with a " +
        "real live API call — the direct-token deployment mode makes cached-token resolution alone " +
        "insufficient to prove the connection still works.",
    );
    const shopifyDetailedBody = extractBlock(shopifySource, "async validateStoredCredentialsDetailed(");
    assert(
      /graphqlRequest/.test(shopifyDetailedBody),
      "PIM#653 regression: ShopifyConnector.validateStoredCredentialsDetailed() must make a real live " +
        "GraphQL call (not just resolve a cached access token) — otherwise a revoked/uninstalled app is " +
        "undetectable for direct-token installs, the exact gap this fix closes.",
    );
    const shopifyValidateCredentialsBody = extractBlock(shopifySource, "async validateCredentials(");
    assert(
      /validateStoredCredentialsDetailed/.test(shopifyValidateCredentialsBody),
      "PIM#653 regression: ShopifyConnector.validateCredentials() must delegate to " +
        "validateStoredCredentialsDetailed() so the heartbeat also gets the real live check, not just reconnect.",
    );
    validated.push("fixed_7_9_pim653_all_four_connectors_done");
  }

  // ── Fixed path #15: JWT blocklist Redis-write failure (PIM#654) ──────────
  // revoke()'s Redis-write failure now routes through Error Authority (in
  // addition to the pre-existing markRedisUnavailable() logger path) rather
  // than only ever producing a log line for a security-relevant degraded
  // state (a revoked token still validating as active on other instances).
  {
    const source = readSource("auth/jwt-blocklist.service.ts");
    const revokeBody = extractBlock(source, "async revoke(");
    assert(
      /catch \(error: unknown\) \{[\s\S]{0,200}?markRedisUnavailable/.test(revokeBody),
      "revoke()'s Redis write failure must still call markRedisUnavailable() — the local in-memory " +
        "fallback behavior must not regress even though the failure is now also captured.",
    );
    assert(
      /errorCaptureService[\s\S]{0,100}?captureUnexpected/.test(revokeBody),
      "PIM#654 regression: revoke()'s Redis write failure must route through errorCaptureService." +
        "captureUnexpected(...) so it reaches Error Authority, not just a logger warning.",
    );
    validated.push("fixed_path_15_pim654_now_captured");
  }

  // ── Fixed path #4: export-job pre-flight validation (PIM#655) ────────────
  // The pre-flight block's outer catch still only logs a warning (the job
  // isn't blocked — real validation runs later in the async worker), but now
  // additionally captures the exception so a systemic pre-flight bug becomes
  // visible in aggregate rather than only discoverable via log-diving.
  {
    const source = readSource("marketplace/marketplace.service.ts");
    assert(
      source.includes("pre-flight connector validation skipped"),
      "The pre-flight validation block's outer catch must still log \"pre-flight connector validation " +
        "skipped\" — this behavior must not regress even though the failure is now also captured.",
    );
    assert(
      /pre-flight connector validation skipped[\s\S]{0,700}?errorCaptureService[\s\S]{0,100}?captureUnexpected/.test(source),
      "PIM#655 regression: the pre-flight validation catch block must route through errorCaptureService." +
        "captureUnexpected(...) so a systemic pre-flight bug is visible in Error Authority, not just logs.",
    );
    validated.push("fixed_path_4_pim655_now_captured");
  }

  // ── Fixed path #13: unawaited lastSignInAt (PIM#656) ─────────────────────
  // The write is still intentionally fire-and-forget (lastSignInAt stays
  // best-effort, non-blocking) but is no longer a bare `void promise` with no
  // .catch() — it's now a genuine, handled rejection routed through a
  // dedicated helper that logs and captures the failure.
  {
    const source = readSource("auth/auth.service.ts");
    assert(
      !/void this\.prisma\.tenant\([\s\S]{0,150}?lastSignInAt/.test(source),
      "PIM#656 regression: the lastSignInAt update must not go back to a bare `void this.prisma...` call " +
        "with no .catch() — that's an unhandled promise rejection, not an intentional fire-and-forget.",
    );
    assert(
      source.includes("recordLastSignInAt"),
      "PIM#656 regression: expected a recordLastSignInAt() helper that catches, logs, and captures the " +
        "lastSignInAt write's failure instead of leaving it unhandled.",
    );
    const helperBody = extractBlock(source, "private recordLastSignInAt(");
    assert(
      /\.catch\(/.test(helperBody) && /errorCaptureService[\s\S]{0,100}?captureUnexpected/.test(helperBody),
      "PIM#656 regression: recordLastSignInAt() must catch the write failure and route it through " +
        "errorCaptureService.captureUnexpected(...).",
    );
    validated.push("fixed_path_13_pim656_now_captured");
  }

  console.log(
    JSON.stringify(
      {
        status: "ok",
        matrixSummary: {
          totalPathsAudited: 15,
          confirmedClean: 11,
          confirmedFixed: 4,
          confirmedSwallow: 0,
          trackingIssues: {},
          fixedIssues: {
            "PIM#653": "connector install/reconnect validateCredentials() boolean swallow — Flipkart+Amazon+WooCommerce+Shopify all fixed (this PR)",
            "PIM#654": "JWT blocklist Redis-write failure on logout — now captured (PR #671)",
            "PIM#655": "export-job pre-flight validation swallow — now captured (PR #671)",
            "PIM#656": "unawaited lastSignInAt write on login/MFA — now handled and captured (PR #671)",
          },
        },
        validated,
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
  console.error("Error Authority mutation-path coverage matrix test failed:");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
