# QA-AI-01 (#1236): the internal AI Lab is behind an explicit fail-closed flag

Date: 2026-10-07
Baseline: `origin/main` at `e7209405`
Type: application change (web and API), default behaviour is **off**. No provider, model, key, budget or database change.

## 1. The defect

`https://app.vexapim.com/ai` returned 200 for a signed-in Admin and rendered the "Smart Suggestions" Labs page, although its banner says it is not available to workspace users. The page hid itself with `process.env.APP_ENV === "production"`. Vexa runs one deployment that serves production under the environment name "Staging", so that condition never fired on the live app.

The page drives the **legacy** `auto-suggestions` module (not the governed `IntelligenceModule`). Its repair action (`applyAiRepairAction` -> `POST /auto-suggestions/products/:id/repair` with `apply: true`) updates a product directly (title, category, attributes), outside the governed proposal and approval path. It is rule-based: no model or network call.

## 2. The change

One explicit flag, `FEATURE_INTERNAL_AI_LAB_ENABLED`, **fail-closed** and independent of `APP_ENV`: unset, empty, `false`, malformed or any other value means disabled; only the text `true` (any case, whitespace ignored) enables.

| Layer | Before | After |
|---|---|---|
| Web `/ai` page | hidden only when `APP_ENV === "production"` | `notFound()` unless the flag is on **and** the actor is an admin; the check runs before any data is fetched |
| Web server action `applyAiRepairAction` | no check (a server action is a directly callable endpoint) | `notFound()` unless the flag is on and the session is an admin, before anything is posted |
| API `POST /auto-suggestions/products/:id/repair` with `apply` | writes the product | `404 FEATURE_DISABLED` unless the flag is on; the gate uses the same coercion as the service call |

**Deliberately unchanged:** the read suggestion endpoints and the repair **dry run** (`apply: false`). They are part of the documented, scope-filtered API contract (`auto_suggestions.read` is an API-key scope) and are covered by the access-policy and delegated-scope integration suites. Closing them is a product decision, not a defect fix; see section 5.

Nothing needs to be set in production for the fix: the flag defaults to disabled, so deploying the change makes `/ai` return 404 and the direct-write repair refuse. `FEATURE_INTERNAL_AI_LAB_ENABLED="false"` is added to `.env.example`.

## 3. Evidence

- **API:** `auto-suggestions.controller.spec.ts`: a value table for the flag (11 values), `apply=true` refused with `404 FEATURE_DISABLED` and the service never called for unset, empty, `false` and a malformed value; a truthy non-boolean (`"false"`, the service's own coercion) also refused; the dry run (`apply=false`, or no body) still reaches the service; **positive case** with the flag on, `apply=true` reaches the service exactly once. 29 tests pass across the auto-suggestions suites. **Mutation:** disabling the gate fails 5 tests.
- **Web:** `ai-lab-gate.test.cjs` (registered in the integration coverage list): runs the real helper over the same value table, proves `APP_ENV` does not influence it in either direction, and checks the page and the action both use it, the page no longer references `APP_ENV`, the flag and role checks come before any fetch or post, and the sidebar still never switches the Internal section on. **Mutations:** restoring the old `APP_ENV` condition fails the test; removing the action's flag check fails the test.
- API type-check clean. The web type-check could not be run locally (Next.js is not installed in this environment); CI is the check.

## 4. Re-test after deploy (QA lane)

1. `GET /ai` as Admin on the live app: expect **404**.
2. A direct call of the repair action or `POST /auto-suggestions/products/:id/repair` with `apply: true` (as an admin, with a QA product): expect 404 `FEATURE_DISABLED` and **no change** to the product (check the product's version and the audit log).
3. The dry run still returns 201 and changes nothing; the read suggestions still return 200 for a scoped key.
4. No `/auto-suggestions/*` calls from normal product pages (network log).

## 5. Left for a human decision

- **The legacy read and dry-run API.** It is a documented, scoped API surface that no longer has any web caller once `/ai` is off. Whether to deprecate it, keep it, or move it under the governed model is a product decision with API-contract consequences.
- **Deployment assertions.** Environment-name semantics were assumed, not certified. A release check should assert, against the deployed configuration, that anything claimed to be disabled or internal-only is actually unreachable by direct URL (see the AI Surface Census proposal).

## 6. What this does not change

No model, provider, key, budget, tenant policy or database row. The governed `IntelligenceModule` is untouched and still imported only by `app.module.ts`.
