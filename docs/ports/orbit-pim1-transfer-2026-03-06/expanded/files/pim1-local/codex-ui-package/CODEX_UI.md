# Vexa PIM — Frontend Codex Execution Instructions
**Stack:** Next.js 14 App Router · TypeScript strict · Tailwind CSS · shadcn/ui · React Query v5
**API:** NestJS at `NEXT_PUBLIC_API_URL`. Auth: JWT in Authorization header, refresh token rotation.
**Target:** Mid-market Indian sellers, 500–5000 SKUs, Amazon India · Flipkart · Meesho

---

## HOW TO USE THIS PACKAGE

Feed `ui-tasks.json` one sprint at a time. Run scaffold setup once before FOUNDATION sprint.

**Per-sprint workflow:**
1. Read this file fully
2. Read `src/lib/tokens.ts` — all colors come from here, never from raw hex
3. Check `src/components/ui/` stubs before creating any new component
4. Filter `ui-tasks.json` by `sprintId`, implement tasks in order
5. Run gate checks from `ui-tasks.json[].gateCheck`
6. Commit with tag `{sprintId}-UI-GATE`, then proceed

---

## ABSOLUTE RULES

| # | Rule |
|---|------|
| R1 | TypeScript strict. Zero `any` casts. Zero `@ts-ignore`. |
| R2 | Every seller-facing string uses an i18n key from `src/i18n/keys.ts`. Never hardcode visible text. |
| R3 | Never show raw channel error codes. Always use `ConnectorIssue.sellerMessage`. Raw codes in admin tooltips only. |
| R4 | Meesho CTA = "Generate export file". The word "Publish" must never appear on any Meesho surface. |
| R5 | All list views use cursor-based pagination via `PaginatedTableFooter`. Default 50, max 200. |
| R6 | Every HTTP 402 response → `PlanLimitModal` via global interceptor. Never a generic error toast. |
| R7 | Status badges are never color-only. Every badge includes a text label. |
| R8 | `SourceLabel` must be visible on every validation result. Never hide LIVE_API vs LOCAL_RULES. |
| R9 | PENDING status badges use CSS `animate-pulse-badge` class (opacity 0.6↔1.0, 1.5s). Never a spinner. |
| R10 | `CompletenessRing` must have `role="img"` and `aria-label`. All pages pass axe-core zero violations. |
| R11 | Auto-save surfaces show "Save failed — retry" on error. Never show "Saved ✓" on a failed save. |
| R12 | No `localStorage` in components except `useLocalStorage` hook for sidebar collapse preference. |
| R13 | No `console.log` in production paths. Use `src/lib/logger.ts`. |
| R14 | Every component renders loading skeleton, empty state, and error state with retry. |
| R15 | Mobile (`< 768px`): bottom tab bar only. Left sidebar hidden. |
| R16 | Consent checkbox is never pre-ticked. Account deletion requires type-to-confirm email. |
| R17 | `CONSENT_REQUIRED` notification cannot be dismissed until consent is re-given. |

---

## SCAFFOLD SETUP (run once)

```bash
npx create-next-app@latest apps/web --typescript --tailwind --eslint --app --src-dir --import-alias "@/*"
cd apps/web

npm install \
  @tanstack/react-query @tanstack/react-query-devtools \
  axios zustand \
  react-hook-form zod @hookform/resolvers \
  lucide-react clsx tailwind-merge \
  next-intl \
  @radix-ui/react-dialog @radix-ui/react-dropdown-menu \
  @radix-ui/react-tooltip @radix-ui/react-tabs \
  @radix-ui/react-checkbox @radix-ui/react-select \
  @radix-ui/react-accordion \
  date-fns react-dropzone \
  react-syntax-highlighter @types/react-syntax-highlighter

npx shadcn-ui@latest init
# TypeScript, Default style, Slate base, CSS variables: yes
npx shadcn-ui@latest add button input label badge card table \
  dialog sheet drawer tooltip dropdown-menu tabs progress skeleton toast alert

npm install -D @axe-core/react vitest @testing-library/react \
  @testing-library/user-event @testing-library/jest-dom msw
```

Copy all files from this package into `apps/web/src/` before writing any sprint code.

---

## DIRECTORY LAYOUT

```
apps/web/src/
├── app/
│   ├── (auth)/login/page.tsx
│   ├── (app)/
│   │   ├── layout.tsx              ← AppShell
│   │   ├── home/page.tsx
│   │   ├── catalog/page.tsx
│   │   ├── catalog/[id]/page.tsx
│   │   ├── issues/page.tsx
│   │   ├── channels/page.tsx
│   │   ├── channels/[slug]/page.tsx
│   │   ├── submissions/page.tsx
│   │   ├── media/page.tsx
│   │   ├── bulk/page.tsx
│   │   ├── insights/page.tsx
│   │   └── settings/{page,plan,notifications,privacy}/page.tsx
│   └── onboarding/page.tsx
├── components/
│   ├── ui/                         ← 15 primitives — stubs provided
│   ├── shell/                      ← AppShell, TopBar, Sidebar, MobileTabBar, ConnectionStatusBar
│   ├── billing/PlanLimitModal.tsx
│   └── auth/AccountLockedPage.tsx
├── hooks/
│   ├── useApi.ts
│   ├── usePlanUsage.ts
│   ├── useUnsavedChanges.ts
│   ├── useLocalStorage.ts
│   └── useOnlineStatus.ts
├── api/
│   ├── client.ts                   ← Axios + interceptors — DO NOT MODIFY INTERCEPTORS
│   ├── products.ts
│   ├── connectors.ts
│   ├── submissions.ts
│   ├── media.ts
│   ├── dashboard.ts
│   ├── billing.ts
│   └── auth.ts
├── lib/
│   ├── tokens.ts                   ← Design tokens — source of truth
│   ├── logger.ts
│   └── utils.ts
├── i18n/
│   ├── keys.ts                     ← All i18n key constants
│   └── en.ts                       ← English string map
└── types/
    ├── api.ts                      ← All API response types
    └── domain.ts
```

---

## API ENDPOINTS QUICK REFERENCE

All routes: `/api/v1/` prefix. Bearer token injected by client.ts interceptor.

```
Products:    GET/POST /products   GET/PATCH /products/:id
Connectors:  GET /connectors/installed   POST /connectors/:slug/install
             DELETE /connectors/:slug/install/:id
             POST /connectors/meesho/export   POST /connectors/meesho/test-credentials
             GET /auth/:connectorSlug/start
Submissions: GET /submissions   POST /marketplace/export-job
Issues:      GET /issues   PATCH /issues/:id
Media:       POST /media/upload   GET /media/:id
Dashboard:   GET /dashboard/readiness   GET /dashboard/catalog-health
Billing:     GET /billing/usage
Account:     POST /account/export   DELETE /account   POST /auth/consent
Auth:        POST /auth/login   POST /auth/logout   POST /auth/refresh
             POST /auth/resend-unlock
Notifications: GET /notifications   PATCH /notifications/:id/read
               GET|PATCH /notifications/preferences/:type
Health:      GET /health
```

---

## SPRINT ORDER

```
FOUNDATION → P5-S1 → P5-S2 → P5-S3 → P5-S4 → P5-S5 → Pre-Growth → P6-S1 → P6-S2 → P6-S3
```
