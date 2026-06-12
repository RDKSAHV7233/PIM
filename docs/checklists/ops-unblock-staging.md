# Staging Unblock — Ops Runbook

**Priority**: These 8 items block the pilot tenant launch. Do them in order.
**Date written**: 2026-06-02 · **Last updated**: 2026-06-10
**Time estimate**: ~4 hours total

---

## 1. Rotate staging DB + domain secrets (BLOCKING everything — 15 min)

**Why**: `deploy-staging.yml` has been failing with Prisma `P1001` (connection refused) since 2026-05-25 because the Railway proxy URL changed. Blocks all staging deploys.

**Steps**:

1. Open Railway dashboard → PIM project → `staging` environment
2. Note the current DATABASE service connection string (internal URL, not public):
   - Go to the database service → Connect tab → Internal URL
3. Open GitHub repo → Settings → Secrets and variables → Actions → `staging` environment
4. Update the following secrets:
   - `STAGING_DATABASE_URL` → Railway internal DB URL for staging
   - `STAGING_DATABASE_URL_DIRECT` → Same URL (used for migrations)
   - `STAGING_BASE_URL` → Current Railway web service URL (e.g. `https://pim-web-staging.up.railway.app`)
   - `STAGING_WEB_URL` → Same as STAGING_BASE_URL
5. Trigger a manual deploy: GitHub Actions → `deploy-staging.yml` → Run workflow → staging

**Verify**: Deploy completes without Prisma P1001. Web service responds at the new URL.

---

## 2. Run `gate:run:sprint` on staging (OVERDUE since 2026-05-23 — 30 min)

**Update 2026-06-11**: ✅ COMPLETE. Full E2E suite passed on staging (run 27322336923, all tests pass).
Previous: staging deploy pipeline GREEN (run 27302388556, all 27 E2E smoke tests pass).
Full E2E suite triggered via `e2e-staging.yml` — first run (27321464572) failed on signup check (fixed in PR #248),
re-triggered run (27322336923) passed all tests including signup smoke check.

**Blocked on**: Item #1 above (now resolved — deploy pipeline working).

**Steps** (after #1 is done):

1. Trigger: GitHub Actions → `e2e-staging.yml` → Run workflow → target: staging
2. Or run locally: `PLAYWRIGHT_BASE_URL=<staging-url> PLAYWRIGHT_API_URL=<staging-api-url>/api/v1 npm run test:e2e:smoke`
3. Required result: smoke suite passes (6 journeys + RBAC + isolation + error handling)

**Verify**: CI shows green. Record the result in `docs/execution/CURRENT_STATE.md` as `gate:run:sprint PASSED YYYY-MM-DD`.

**Also run**: `node scripts/performance-baseline.cjs` with staging URLs to capture first baseline.

---

## 3. Set STAGE3_* secrets in GitHub `production` environment (15 min)

**Why**: `promote-stage3.yml` reads from the `production` GitHub environment. Secrets missing → workflow errors on trigger.

**Steps**:

1. GitHub → Settings → Secrets and variables → Actions → `production` environment
2. Verify these secrets exist (create if missing):
   - `STAGE3_RAILWAY_TOKEN` — Railway API token with deploy permissions
   - `STAGE3_DATABASE_URL` — Production DB URL
   - `STAGE3_DATABASE_URL_DIRECT` — Production DB direct URL
   - `STAGE3_JWT_SECRET` — 32+ char secret for production JWT
   - `STAGE3_CREDENTIAL_ENCRYPTION_KEY_V1` — 32+ char encryption key
   - `STAGE3_REDIS_URL` — Production Redis URL
3. Run `validate-promote-stage3-workflow.cjs` to verify: `node scripts/validate-promote-stage3-workflow.cjs`

---

## 4. Create Stripe products and set price ID env vars (45 min — UPDATED 2026-06-11)

**Update 2026-06-11**: PR #249 added BUSINESS tier. New price ladder is STARTER ₹9,999, GROWTH ₹29,999, BUSINESS ₹69,999, ENTERPRISE custom.

**Why**: `GracePeriodEscalationService` and checkout flows are blocked until Stripe products exist. StripeService now warns on startup if these are missing.

**Steps**:

1. Open Stripe dashboard → Test mode
2. Create 4 products with the NEW prices:
   - **STARTER**: ₹9,999/month → note `price_xxx` ID → set as `STRIPE_PRICE_ID_STARTER`
   - **GROWTH**: ₹29,999/month → note ID → set as `STRIPE_PRICE_ID_GROWTH`
   - **BUSINESS** (NEW): ₹69,999/month → note ID → set as `STRIPE_PRICE_ID_BUSINESS`
   - **ENTERPRISE**: ₹1/month placeholder → note ID → set as `STRIPE_PRICE_ID_ENTERPRISE`
3. Get test secret key: Stripe dashboard → Developers → API keys → Secret key
4. Create webhook endpoint pointing to staging: `https://<staging-api-url>/api/v1/stripe/webhook`
   - Events to listen: `invoice.payment_failed`, `invoice.payment_succeeded`, `customer.subscription.updated`, `customer.subscription.deleted`
   - Note signing secret
5. Set in GitHub `staging` environment secrets:
   - `STRIPE_SECRET_KEY` = test secret key
   - `STRIPE_WEBHOOK_SECRET` = webhook signing secret
   - `STRIPE_PRICE_ID_STARTER`
   - `STRIPE_PRICE_ID_GROWTH`
   - `STRIPE_PRICE_ID_BUSINESS` (NEW)
   - `STRIPE_PRICE_ID_ENTERPRISE`
   - `FEATURE_STRIPE_BILLING_ENABLED=true`
6. Redeploy staging

**Verify**: `POST <staging-api>/api/v1/billing/checkout-session` with `{ planTier: "BUSINESS" }` returns a Stripe checkout URL.

---

## 5. PO: Email Meesho for API credentials (15 min)

**Why**: Meesho M-2 (live product publish) is blocked waiting on Meesho API credentials. Phase M-2 is not MVP-blocking but the email needs to go out now so credentials arrive before Meesho pilot.

**Steps**:

1. PO (Atharva) sends email to: `meesholink-integration@meesho.com`
2. Subject: "Vexa PIM — API credential request for Meesho connector integration"
3. Body template:
   ```
   Hi Meesho integration team,

   We are the Vexa PIM team. We have built a product catalog connector 
   for Meesho sellers that enables bulk product submission and status tracking.

   We would like to request API credentials (API key + sandbox access) 
   to test and certify our connector for production use.

   Integration type: Meesho Seller API (product listings, inventory, submission status)
   Use case: Multi-channel PIM for Indian D2C brands
   Company: Vexa (vexa-pim.com)
   Contact: [PO email]

   Please let us know the onboarding process.
   ```
4. Track in: `docs/execution/CURRENT_STATE.md` as `RD-MEESHO-1 SENT YYYY-MM-DD`

---

## 6. Configure media storage on staging (30 min)

**Update 2026-06-12**: BullMQ failed-job cleanup is automated. `MEDIA_LOCAL_FALLBACK` env var
added to API — Option B (local filesystem) is now the quick path; Option A (R2) is the permanent path.

**Why**: Media file upload fails on staging because `APP_ENV=staging` forces R2 mode by default,
and R2 credentials were never set. `media-storage.service.ts` now respects `MEDIA_LOCAL_FALLBACK=true`
to write uploads to the container filesystem instead.

---

### Option B — Local filesystem (quick, no R2 needed) ✅ CURRENT CHOICE

**Steps**:

1. Railway dashboard → PIM project → staging environment → **API service** → **Settings → Volumes**
2. Add volume:
   - Mount path: `/app/storage/media`
   - Size: 1 GB (enough for staging demos)
   - Name: `pim-staging-media`
3. Railway dashboard → API service → **Variables**
4. Add variable: `MEDIA_LOCAL_FALLBACK=true`
5. Redeploy the API service (Railway triggers automatically on variable change)

**Verify**: Upload a test image via `/catalog/media` → image appears in the media library without error.

**Limitation**: Uploaded files live in the Railway volume only. Not accessible via CDN URL — `resolveDownloadUrl` returns `null` for local paths (the media library will not show preview thumbnails unless you also set `R2_PUBLIC_URL` to a reverse-proxy of the volume). Acceptable for staging QA; not suitable for investor demo or pilot.

---

### Option A — Cloudflare R2 (permanent, CDN-backed)

Use this when staging is upgraded to pilot/investor-demo quality or when Option B becomes a friction point.

**Steps**:

1. Open Cloudflare dashboard → R2 → Create bucket → `pim-staging`
2. Create R2 API token: Cloudflare → My Profile → API Tokens → Create Token → R2 Edit template → scope to `pim-staging` bucket
3. Set in **Railway dashboard → API service → Variables** (or GitHub `staging` environment secrets if using CI/CD deploy):
   - `MEDIA_LOCAL_FALLBACK=false` (or delete the variable)
   - `R2_ACCOUNT_ID` = Cloudflare account ID (found at dash.cloudflare.com → right sidebar)
   - `R2_ACCESS_KEY_ID` = R2 token key ID
   - `R2_SECRET_ACCESS_KEY` = R2 token secret
   - `R2_BUCKET_NAME=pim-staging`
   - `R2_PUBLIC_URL` = public bucket URL (enable in R2 bucket settings → Public access → R2.dev subdomain, or use a custom domain)
4. Redeploy API service

**Verify**: Upload a test image → image appears with a thumbnail URL (not null) in media library.

---

## 7. Deploy Tax Attributes migration + seed (30 min — added 2026-06-09)

**Update 2026-06-11**: `seed-tax-regimes.cjs` is now automated in `deploy-staging.yml` — runs
after `prisma migrate deploy` on every staging deploy. No manual step needed.

**Why**: Migration `20260609000001_add_tax_regime_product_tax_code` adds the `tax_regimes` and
`product_tax_codes` tables. Without the seed step, any product create/update with `taxCodes`
will throw "Unknown tax regime" because `TaxRegime` rows don't exist yet.

**Steps** (after item #1 so staging has a working DB):

1. `prisma migrate deploy` runs automatically on deploy — no manual step needed if using the
   standard CI/CD pipeline. Verify the migration appears in `prisma migrate status`.

2. Seed the TaxRegime registry (idempotent — safe to run multiple times):
   ```
   DATABASE_URL=<staging-db-url> node scripts/seed-tax-regimes.cjs
   ```
   Expected output: `[seed-tax-regimes] Done — 5 created / 0 updated.`

3. (Optional) Backfill existing products' `hsnCode`/`gstRate` into `ProductTaxCode` rows:
   ```
   DATABASE_URL=<staging-db-url> npx ts-node scripts/backfill-tax-codes.ts --dry-run
   # Review counts, then:
   DATABASE_URL=<staging-db-url> npx ts-node scripts/backfill-tax-codes.ts
   ```
   Expected: One `ProductTaxCode` row per product that had a non-null `hsnCode`.

**Verify**: `SELECT COUNT(*) FROM tax_regimes;` returns 5. Product create via API with
`taxCodes: [{ regimeKey: "IN", key: "HSN_CODE", value: "62044200" }]` succeeds.

---

## 8. Set `STAGING_EXPECT_PUBLIC_SIGNUP_ENABLED=true` (5 min)

**Why**: The staging deploy signup smoke check asserts that the live signup state matches this
secret. When mismatched, the check fails. PR #241 makes this check non-blocking (emits a
`::warning::` annotation instead of failing the pipeline), so the deploy pipeline completes
even without this fix — but setting the secret removes the warning and enables strict assertion.

**Steps**:

1. GitHub → Settings → Secrets and variables → Actions → `staging` environment
2. Add secret: `STAGING_EXPECT_PUBLIC_SIGNUP_ENABLED=true`

**Verify**: Next `Deploy Staging` run shows no warning annotation on the signup check step.

---

## 9. Run plan-limits seed after pricing-tier migration deploys (10 min — added 2026-06-10)

**Why**: Migration `20260610000001_plan_limits_trial_tier_and_new_resources` adds three columns to
`PlanLimits` and inserts a TRIAL tier row. The migration itself backfills all four tiers with the
correct values. However, if the seed has never been run on staging (e.g. the STARTER/GROWTH/ENTERPRISE
rows were inserted by a previous seed that predates this migration), run the seed to guarantee all
values are correct.

**Steps** (after item #1 so staging has a working DB):

1. Verify the migration deployed:
   ```
   DATABASE_URL=<staging-db-url> npx prisma migrate status
   ```
   Confirm `20260610000001_plan_limits_trial_tier_and_new_resources` shows as Applied.

2. Re-run the plan-limits seed (idempotent — safe to run any time):
   ```
   DATABASE_URL=<staging-db-url> npx ts-node -e "
     const { PlanUsageService } = require('./apps/api/src/billing/plan-usage.service');
     // Or trigger via the admin bootstrap endpoint: POST /api/v1/admin/seed/plan-limits
   "
   ```
   Easier path — call the admin seed endpoint if available, or confirm DB values directly:
   ```sql
   SELECT "planTier", "maxSkus", "maxUsers", "maxApiKeys", "maxOutboundWebhooks", "maxImportRowsPerJob"
   FROM "PlanLimits"
   ORDER BY "planTier";
   ```
   Expected rows (updated 2026-06-11 — added BUSINESS tier):
   | planTier   | maxSkus | maxUsers | maxApiKeys | maxOutboundWebhooks | maxImportRowsPerJob |
   |------------|---------|----------|------------|---------------------|---------------------|
   | BUSINESS   | 50000   | 100      | 20         | 20                  | 20000               |
   | ENTERPRISE | 100000  | 999      | 50         | 50                  | 30000               |
   | GROWTH     | 10000   | 20       | 3          | 3                   | 10000               |
   | STARTER    | 500     | 3        | 0          | 0                   | 2000                |
   | TRIAL      | 100     | 2        | 0          | 0                   | 500                 |

3. Confirm new tenants default to TRIAL:
   ```sql
   SELECT column_default FROM information_schema.columns
   WHERE table_name = 'TenantPlanProfile' AND column_name = 'planTier';
   ```
   Expected: `'TRIAL'`

**Verify**: The 4 rows above match. Any new signup lands on TRIAL (not STARTER).

---

## Post-completion verification

After all 8 items:

```
npm run test:e2e:smoke -- --base-url=<staging-url>
node scripts/performance-baseline.cjs
```

All 5 smoke spec files should pass. Performance baseline should be recorded. Gate is open for first pilot tenant.

---

## Status tracker

| # | Item | Owner | Status | Done |
|---|------|-------|--------|------|
| 1 | Rotate staging DB + domain secrets | Ops | ✅ Working (deploy pipeline green) | 2026-06-10 |
| 2 | Run gate:run:sprint on staging | QA | ✅ PASSED (run 27322336923, all tests pass) | 2026-06-11 |
| 3 | STAGE3_* secrets in production env | Ops | ❌ Pending | |
| 4 | Stripe products + price ID env vars | Ops/PO | ❌ Pending | |
| 5 | Email Meesho for API credentials | PO | ❌ Pending | |
| 6 | Configure media storage | Ops | ⚠️ Option B (MEDIA_LOCAL_FALLBACK) code-ready — **mount Railway volume at /app/storage/media + set MEDIA_LOCAL_FALLBACK=true in Railway vars** | |
| 7 | Deploy Tax Attributes migration + seed-tax-regimes | Ops | ✅ Seed automated in deploy pipeline | |
| 8 | Set `STAGING_EXPECT_PUBLIC_SIGNUP_ENABLED=true` in staging secrets | Ops | ❌ Pending | |
| 9 | Verify plan-limits seed post-migration (TRIAL row + correct limits) | Ops | ❌ Blocked on #1 | |
