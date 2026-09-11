#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "../../../..");

function read(relativePath) {
  return fs.readFileSync(path.join(REPO_ROOT, relativePath), "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

try {
  const verifyClient = read("apps/web/src/components/auth/signup-verify-page-client.tsx");
  const verifyRoute = read("apps/web/src/app/api/signup/verify/route.ts");
  const authCopy = read("apps/web/src/components/auth/auth-copy.ts");

  // ── H-1 (1): the token must never be consumed by a passive page load ──────────
  // Static-assertion harness (no jsdom / react-dom in this worktree), so we cannot
  // execute the component and count fetches. Instead we assert the structural
  // guarantees that make an on-mount verify impossible:
  //   - no useEffect remains in the client (the auto-verify effect was the only one)
  //   - the single /api/signup/verify fetch lives inside the onVerify click handler
  //   - initial state for a tokened load is the non-network "idle" landing state
  assert(
    !/\buseEffect\b/.test(verifyClient),
    "signup-verify client must not use useEffect: the verification token must never be consumed by a passive page load / prefetch.",
  );
  assert(
    !/useEffect|useRef/.test(verifyClient.split("from \"react\"")[0]),
    "signup-verify client must not import useEffect/useRef once the on-mount auto-verify is removed.",
  );
  assert(
    verifyClient.includes('useState<VerifyState>(initialToken ? "idle" : "invalid")'),
    "signup-verify client must land in the non-network 'idle' state when a token is present (was 'verifying', which auto-fired the request).",
  );

  // ── H-1 (3): exactly one verify call, from an explicit click ─────────────────
  const onVerifyStart = verifyClient.indexOf("async function onVerify()");
  assert(onVerifyStart >= 0, "signup-verify client must expose an onVerify click handler.");
  const onVerifyBody = verifyClient.slice(onVerifyStart, verifyClient.indexOf("async function onResend()"));
  assert(
    onVerifyBody.includes('fetch("/api/signup/verify"') && onVerifyBody.includes('method: "POST"'),
    "onVerify must issue the POST /api/signup/verify request.",
  );
  assert(
    (onVerifyBody.match(/fetch\("\/api\/signup\/verify"/g) || []).length === 1,
    "onVerify must issue exactly one /api/signup/verify request per invocation.",
  );
  assert(
    onVerifyBody.includes('verifyState === "verifying"') && onVerifyBody.includes("return;"),
    "onVerify must guard against re-entrancy while a verification request is in flight.",
  );

  // ── H-1 (2): landing card with heading, workspace/email, CTA + 'not me' link ─
  assert(
    verifyClient.includes('verifyState === "idle" ? (') &&
      verifyClient.includes("authCopy.signupVerifyLandingTitle") &&
      verifyClient.includes("authCopy.signupVerifyLandingBody") &&
      verifyClient.includes("authCopy.signupVerifyCta") &&
      verifyClient.includes("authCopy.signupVerifyNotMe"),
    "signup-verify client must render a landing card (title, body, CTA, 'this wasn't me' link) in the idle state.",
  );
  assert(
    /onClick=\{\(\) => void onVerify\(\)\}/.test(verifyClient),
    "The 'Verify my workspace' button must call onVerify on click.",
  );
  assert(
    verifyClient.includes('href={`/login?lang=${encodeURIComponent(locale)}`}'),
    "The 'This wasn't me' affordance must link to /login.",
  );
  // (4) no-token path unchanged: bare invalid + resend + start-over link preserved.
  assert(
    verifyClient.includes('verifyState === "invalid" ? (') &&
      verifyClient.includes("/api/signup/resend-verification") &&
      verifyClient.includes("authCopy.signupVerifyStartOver"),
    "The empty-token path must keep the existing invalid + resend + start-over affordance.",
  );

  // ── H-1 (5): prefetch guard on the API route ────────────────────────────────
  const guardStart = verifyRoute.indexOf('headers.get("sec-purpose")');
  const prefetchReturn = verifyRoute.indexOf("status: 204");
  const bodyRead = verifyRoute.indexOf("await request.json()");
  const proxyCall = verifyRoute.indexOf("return forwardSignupRequest");
  assert(guardStart >= 0, "verify route must read the Sec-Purpose header.");
  assert(
    verifyRoute.includes('includes("prefetch")') && prefetchReturn >= 0,
    "verify route must short-circuit prefetch requests with a 204 and no body.",
  );
  assert(
    verifyRoute.includes("new Response(null, { status: 204 })"),
    "verify route must return an empty 204 body for prefetch requests.",
  );
  assert(
    guardStart < prefetchReturn &&
      prefetchReturn < bodyRead &&
      bodyRead < proxyCall,
    "verify route must apply the prefetch guard BEFORE reading the body or proxying upstream.",
  );

  // ── H-1 (6): copy keys present, HI covered via ...EN_COPY ───────────────────
  for (const key of [
    "signupVerifyLandingTitle",
    "signupVerifyLandingBody",
    "signupVerifyCta",
    "signupVerifyNotMe",
  ]) {
    assert(
      new RegExp(`\\b${key}:\\s*string;`).test(authCopy),
      `AuthCopy interface must declare ${key}.`,
    );
    assert(
      new RegExp(`\\b${key}:\\s*"`).test(authCopy),
      `EN_COPY must define ${key}.`,
    );
  }
  assert(
    authCopy.includes('signupVerifyCta: "Verify my workspace"') &&
      authCopy.includes('signupVerifyNotMe: "This wasn\'t me"') &&
      authCopy.includes('signupVerifyLandingTitle: "Verify your workspace"'),
    "EN_COPY landing strings must match the approved copy.",
  );
  assert(
    !/signupVerifyLandingBody:\s*"[^"]*[{}]/.test(authCopy),
    "signupVerifyLandingBody must be a plain string with no brace placeholders (interpolation happens in the component).",
  );
  assert(
    /const HI_COPY: AuthCopy = \{\s*\.\.\.EN_COPY,/.test(authCopy),
    "HI_COPY must spread ...EN_COPY so the new keys are covered.",
  );

  console.log(
    JSON.stringify(
      {
        status: "ok",
        note:
          "Static source assertions only: this worktree has no node_modules, so the React component " +
          "cannot be rendered/executed. 'No fetch on mount' is enforced structurally (no useEffect; the " +
          "sole /api/signup/verify fetch is inside the onVerify click handler; tokened loads start in the " +
          "non-network 'idle' landing state). A jsdom/testing-library render test asserting zero network " +
          "calls on mount and exactly one on click should be added when web test deps are available.",
        validated: [
          "verify_client_has_no_on_mount_effect",
          "verify_client_tokened_load_starts_in_idle_landing_state",
          "verify_request_is_click_gated_and_single",
          "verify_client_renders_landing_card_with_cta_and_not_me_link",
          "verify_client_empty_token_path_unchanged",
          "verify_route_short_circuits_prefetch_before_proxy",
          "auth_copy_landing_keys_present_and_hi_covered",
        ],
        checkedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
} catch (error) {
  console.error("signup-verify-button-gate integration test failed");
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
