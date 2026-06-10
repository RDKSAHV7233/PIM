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

**Blocked on**: Item #1 above.

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

## 4. Create Stripe products and set price ID env vars (30 min)

**Why**: `GracePeriodEscalationService` and checkout flows are blocked until Stripe products exist. StripeService now warns on startup if these are missing.

**Steps**:

1. Open Stripe dashboard → Test mode
2. Create 3 products:
   - **STARTER**: ₹4,499/month → note `price_xxx` ID → set as `STRIPE_PRICE_ID_STARTER`
   - **GROWTH**: ₹11,999/month → note ID → set as `STRIPE_PRICE_ID_GROWTH`
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
   - `STRIPE_PRICE_ID_ENTERPRISE`
   - `FEATURE_STRIPE_BILLING_ENABLED=true`
6. Redeploy staging

**Verify**: `POST <staging-api>/api/v1/billing/checkout-session` with `{ planTier: "GROWTH" }` returns a Stripe checkout URL.

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

## 6. Clear failed `account-export` job + configure R2 on staging (30 min)

**Why**: A failed BullMQ job is stuck in the queue, causing noise in staging logs. R2 (Cloudflare storage) is needed for media upload to work on staging.

**Steps — Clear failed job**:

1. On staging: trigger a one-time job cleanup via admin CLI or Redis:
   ```
   redis-cli -u <REDIS_URL> DEL bull:account-export:failed
   ```
   Or via Railway CLI: `railway run --environment staging redis-cli ...`
2. Alternatively, if a BullMQ dashboard is accessible, use "Clean → Failed" for the `account-export` queue.

**Steps — Configure R2**:

1. Open Cloudflare dashboard → R2 → Create bucket → `pim-staging`
2. Create API token with R2 read/write access for the `pim-staging` bucket
3. Set in GitHub `staging` environment:
   - `R2_ACCOUNT_ID` = Cloudflare account ID
   - `R2_ACCESS_KEY_ID` = R2 API token key ID
   - `R2_SECRET_ACCESS_KEY` = R2 API token secret
   - `R2_BUCKET_NAME=pim-staging`
   - `R2_PUBLIC_URL` = R2 public URL for the bucket (or a custom domain)
4. Redeploy staging

**Verify**: Upload a test image via the media upload UI on staging → image appears in the media library.

---

## 7. Deploy Tax Attributes migration + seed (30 min — added 2026-06-09)

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

## 8. Fix daily E2E signup check noise (5 min)

**Why**: `capture-daily-rollout-evidence.yml` checks the staging signup page but the check
expects a 404 when signup is live on staging. This produces a false-positive failure every day
until the env var is set. The workflow's broken `git push` step has already been fixed (this PR).

**Steps**:

1. GitHub → Settings → Secrets and variables → Actions → `staging` environment
2. Add secret: `STAGING_EXPECT_PUBLIC_SIGNUP_ENABLED=true`

**Verify**: Next daily run of `capture-daily-rollout-evidence` workflow exits 0.

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
| 1 | Rotate staging DB + domain secrets | Ops | ❌ Blocking | |
| 2 | Run gate:run:sprint on staging | QA | ❌ Blocked on #1 | |
| 3 | STAGE3_* secrets in production env | Ops | ❌ Pending | |
| 4 | Stripe products + price ID env vars | Ops/PO | ❌ Pending | |
| 5 | Email Meesho for API credentials | PO | ❌ Pending | |
| 6 | Clear failed job + configure R2 | Ops | ❌ Pending | |
| 7 | Deploy Tax Attributes migration + seed-tax-regimes | Ops | ❌ Blocked on #1 | |
| 8 | Set `STAGING_EXPECT_PUBLIC_SIGNUP_ENABLED=true` in staging secrets | Ops | ❌ Pending | |
