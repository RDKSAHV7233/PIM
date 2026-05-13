/* eslint-disable */
"use strict";

const fs = require("fs");
const path = require("path");
const DOCX_PATH = "C:/Users/bhoiv/AppData/Roaming/npm/node_modules/docx";
const {
  Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, HeadingLevel, AlignmentType, BorderStyle, WidthType,
  ShadingType, VerticalAlign, PageNumber, PageBreak, LevelFormat
} = require(DOCX_PATH);

const OUT = path.resolve(__dirname, "Vexa_PIM_Deep_Review_2026-05-13.docx");

// ── helpers ──────────────────────────────────────────────────────────────────
const CONTENT_W = 9360; // US Letter 1-inch margins
const GRAY_HEADER = "2E4057";
const LIGHT_BLUE = "D5E8F0";
const LIGHT_GRAY = "F5F5F5";
const RED_LIGHT = "FDDCDC";
const GREEN_LIGHT = "D5F0D5";
const YELLOW_LIGHT = "FFF9CC";

const border = (color = "CCCCCC") => ({ style: BorderStyle.SINGLE, size: 1, color });
const borders = (c) => { const b = border(c); return { top: b, bottom: b, left: b, right: b }; };
const noBorder = () => { const b = { style: BorderStyle.NONE, size: 0, color: "FFFFFF" }; return { top: b, bottom: b, left: b, right: b }; };

function cell(text, opts = {}) {
  const {
    bold = false, fill = null, color = "000000", colSpan = 1,
    width, fontSize = 18, italic = false, align = AlignmentType.LEFT,
    vAlign = VerticalAlign.TOP, borderColor = "CCCCCC"
  } = opts;
  return new TableCell({
    columnSpan: colSpan,
    borders: borders(borderColor),
    width: width ? { size: width, type: WidthType.DXA } : undefined,
    shading: fill ? { fill, type: ShadingType.CLEAR } : undefined,
    margins: { top: 80, bottom: 80, left: 120, right: 120 },
    verticalAlign: vAlign,
    children: [new Paragraph({
      alignment: align,
      children: [new TextRun({ text: String(text), bold, color, size: fontSize, font: "Arial", italics: italic })]
    })]
  });
}

function headerCell(text, width) {
  return cell(text, { bold: true, fill: GRAY_HEADER, color: "FFFFFF", width, fontSize: 18 });
}

function h(text, level, opts = {}) {
  const lvlMap = {
    1: HeadingLevel.HEADING_1,
    2: HeadingLevel.HEADING_2,
    3: HeadingLevel.HEADING_3,
  };
  return new Paragraph({
    heading: lvlMap[level] || HeadingLevel.HEADING_1,
    pageBreakBefore: opts.pageBreak || false,
    children: [new TextRun({ text, font: "Arial", bold: true, size: level === 1 ? 32 : level === 2 ? 26 : 22 })]
  });
}

function p(text, opts = {}) {
  const { bold = false, italic = false, size = 20, color = "000000", align = AlignmentType.LEFT, spacing = {} } = opts;
  return new Paragraph({
    alignment: align,
    spacing: { after: 120, ...spacing },
    children: [new TextRun({ text: String(text), bold, italics: italic, size, color, font: "Arial" })]
  });
}

function bullet(text, opts = {}) {
  return new Paragraph({
    numbering: { reference: "bullets", level: 0 },
    spacing: { after: 60 },
    children: [new TextRun({ text: String(text), font: "Arial", size: 20, ...opts })]
  });
}

function spacer(n = 1) {
  return Array.from({ length: n }, () => new Paragraph({ children: [new TextRun("")], spacing: { after: 80 } }));
}

function makeTable(headers, rows, colWidths) {
  const totalW = colWidths.reduce((a, b) => a + b, 0);
  return new Table({
    width: { size: totalW, type: WidthType.DXA },
    columnWidths: colWidths,
    rows: [
      new TableRow({
        tableHeader: true,
        children: headers.map((h, i) => headerCell(h, colWidths[i]))
      }),
      ...rows.map((row, ri) =>
        new TableRow({
          children: row.map((cellText, ci) => {
            let fill = ri % 2 === 0 ? LIGHT_GRAY : "FFFFFF";
            // colour-code status cells
            const low = String(cellText).toLowerCase();
            if (low === "pass" || low === "proven" || low === "strong") fill = GREEN_LIGHT;
            else if (low === "fail" || low.includes("blocker") || low.includes("not proven") || low === "risk") fill = RED_LIGHT;
            else if (low === "partial" || low === "needs enhancement" || low.includes("conflict")) fill = YELLOW_LIGHT;
            return cell(cellText, { width: colWidths[ci], fill, fontSize: 18 });
          })
        })
      )
    ]
  });
}

// ── document content ─────────────────────────────────────────────────────────

const children = [];

// ── COVER PAGE ───────────────────────────────────────────────────────────────
children.push(
  new Paragraph({ spacing: { before: 3000 }, children: [] }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 240 },
    children: [new TextRun({ text: "Vexa PIM", font: "Arial", size: 64, bold: true, color: "2E4057" })]
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 240 },
    children: [new TextRun({ text: "Deep Evidence-Only Review", font: "Arial", size: 44, bold: false, color: "4A4A4A" })]
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [new TextRun({ text: "Date: 2026-05-13", font: "Arial", size: 24, color: "666666" })]
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [new TextRun({ text: "Branch: claude/interesting-jones-44e66c", font: "Arial", size: 24, color: "666666" })]
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 120 },
    children: [new TextRun({ text: "Repo: RDKSAHV7233/PIM1", font: "Arial", size: 24, color: "666666" })]
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 80 },
    children: [new TextRun({ text: "Status: MERGE-CONFLICT-BLOCKED — Review Only, No Files Changed", font: "Arial", size: 22, bold: true, color: "C0392B" })]
  }),
  new Paragraph({ children: [new PageBreak()] })
);

// ── A. EXECUTIVE VERDICT ─────────────────────────────────────────────────────
children.push(h("A. Executive Verdict", 1));
children.push(p("Current state: Merge-conflict-blocked. No npm command can run — apps/web/package.json contains raw conflict markers that cause an EJSONPARSE cascade across all workspace commands. The underlying code evidence and rollout artifacts support the PO claim, but nothing can be re-validated in this state.", { spacing: { after: 160 } }));

const verdictRows = [
  ["Controlled paid pilot", "Supported by code + 2026-05-12 rollout snapshot (controlledRollout.pending = []), but unverifiable until conflicts resolved"],
  ["Early SMB/mid-market sellability", "Yes — after conflict resolution and gate re-run"],
  ["Broader production", "2026-05-12 snapshot: broadRollout.pending = [], observationWindowComplete: true — both green; CURRENT_STATE.md stale due to conflict"],
  ["Enterprise readiness", "Correctly and explicitly blocked — no SSO, SCIM, enterprise role shells"],
  ["PIM market fit", "Credible for Indian SMB/mid-market (500–5,000 SKUs, Shopify + Flipkart), not enterprise"],
  ["Architecture verdict", "Acceptable for SMB pilot. Two pre-existing code bugs found."],
  ["Biggest blocker", "Resolve 20 merge-conflict files (root cause: apps/web/package.json)"],
];
children.push(makeTable(["Item", "Verdict"], verdictRows, [2800, 6560]));
children.push(...spacer(1));

// ── B. REPO STATE ────────────────────────────────────────────────────────────
children.push(h("B. Repo State", 1));
const repoRows = [
  ["Branch", "claude/interesting-jones-44e66c"],
  ["Latest commits", "a1f58e0 refine sellability PR wording → 3d2dd55 add PR/reviewer templates → ef78e48 add release handoff → 30f6aa4 finalize sellable PIM workflows → 4d64355 prefer railway service ids"],
  ["Dirty files", "20 files with <<<<<<< HEAD conflict markers (UU/AA state). No untracked files outside merge artifacts"],
  ["Worktree status", "CONFLICT — not clean, not mergeable"],
  ["Files not to commit", "All 20 conflicted files until markers removed"],
  ["Dirty files affect review?", "Yes — builds, tests, and gates all fail due to package.json conflict"],
  ["PR/merge readiness", "BLOCKED"],
];
children.push(makeTable(["Item", "Result"], repoRows, [2800, 6560]));
children.push(...spacer(1));

// ── C. VALIDATION TABLE ──────────────────────────────────────────────────────
children.push(h("C. Validation Table", 1));
children.push(p("Root cause of all failures: apps/web/package.json lines 7–13 contains raw conflict markers. npm EJSONPARSE cascades into every workspace command.", { bold: true, color: "C0392B" }));
const valRows = [
  ["node -e JSON.parse(INCREMENT_STATE.json)", "INCREMENT_STATE.json valid", "0", "Pass", "—"],
  ["npm run lint --workspace @pim1/api", "EJSONPARSE: conflict markers", "1", "Merge conflict blocker", "Cascades from package.json"],
  ["npm run build --workspace @pim1/api", "Same EJSONPARSE", "1", "Merge conflict blocker", "Same root cause"],
  ["npm run lint --workspace @pim1/web", "Same", "1", "Merge conflict blocker", "—"],
  ["npm run build --workspace @pim1/web", "Same", "1", "Merge conflict blocker", "—"],
  ["npm run test --workspace @pim1/web", "Same", "1", "Merge conflict blocker", "—"],
  ["npm run guard:sensitive-gets", "Pass — 140 denied_human_only, 44 allowed_with_api_scope", "0", "Pass", "Invokes node directly, not npm workspace"],
  ["npm run gate:run:increment", "Fails at API lint step", "1", "Merge conflict blocker", "—"],
  ["npm run gate:run:sprint", "Same", "1", "Merge conflict blocker", "—"],
  ["npm audit --omit=dev --audit-level=high", "Same EJSONPARSE", "1", "Merge conflict blocker", "—"],
];
children.push(makeTable(["Command", "Result", "Exit", "Classification", "Notes"], valRows, [2300, 2200, 500, 2000, 2360]));
children.push(...spacer(1));

// ── D. CLAIM VERIFICATION MATRIX ─────────────────────────────────────────────
children.push(h("D. Claim Verification Matrix", 1));
const claimRows = [
  ["Controlled paid pilot readiness", "Partial", "2026-05-12 rollout: controlledRollout.pending = [], health.ok = true", "Build/test blocked by conflict", "Resolve conflicts → re-run gates"],
  ["Broader production readiness", "Partial", "2026-05-12: broadRollout.pending = [], observationWindowComplete: true", "CURRENT_STATE.md stale (conflict)", "Resolve conflict → update docs"],
  ["Enterprise readiness", "Not proven — correctly", "All docs prohibit this claim", "By design", "Keep prohibition"],
  ["ApprovalComment model", "API + Schema Proven; UI Partial", "schema.prisma:1043, catalog.controller.ts:148/161, migrations 20260506120000+131000", "UI conflict in quality/approvals/page.tsx", "Resolve conflict"],
  ["GET /products/:id/activity", "Proven", "catalog.controller.ts:175, catalog.service.ts:732", "None", "—"],
  ["bulk-edit-empty-scope test", "File present; not runnable", "File exists in apps/api/test/integration/", "Blocked by package.json conflict", "Resolve conflict → re-run"],
  ["connector-idempotency-semantics", "File present; not runnable", "File exists", "Same", "Same"],
  ["Latest rollout snapshot", "Green", "2026-05-12T07:19:23Z — all pending arrays empty", "CURRENT_STATE.md stale", "Update after conflict resolution"],
  ["observationWindowDaysCovered", "14/14 complete", "broadRollout.criteria.observationWindowComplete: true", "Stale claim in CURRENT_STATE.md", "Update docs"],
  ["'One day remaining' language", "Stale", "PROD_READINESS_RISK_REGISTER.md says '15/14' from 2026-05-09 snapshot", "Not current truth", "Update doc after conflict resolution"],
];
children.push(makeTable(["Claim", "Status", "Evidence", "Gap", "Action Needed"], claimRows, [1800, 1400, 2000, 1700, 2460]));
children.push(...spacer(1));

// ── E. UX WORKFLOW MATRIX ────────────────────────────────────────────────────
children.push(h("E. UX Workflow Matrix", 1));
const uxRows = [
  ["Login", "/login", "Source-proven", "OK", "None", "None"],
  ["MFA challenge", "/login/mfa", "Source-proven", "OK", "e2e test conflicted", "Merge conflict in tests"],
  ["Dashboard", "/dashboard", "Source-proven", "OK", "None", "None"],
  ["Products list", "/products", "Source-proven", "OK", "None", "None"],
  ["Product detail", "/products/[id]", "Source-proven", "OK", "Approvals tab has conflict", "Merge conflict"],
  ["Variants", "Inside product detail", "Source-proven", "OK", "No dedicated variant list page", "Minor gap"],
  ["Imports", "/operations/imports", "Partial", "Conflict markers", "Large run panel only in dfd8e70a side", "Merge conflict"],
  ["Bulk edit", "/operations/bulk-edit", "Partial", "diff-preview.tsx conflicted", "Mobile cards only in dfd8e70a side", "Merge conflict"],
  ["Approvals", "/quality/approvals", "Partial", "Comments wiring partial", "UI approval comments in conflict", "Merge conflict"],
  ["Connectors", "/channels/connectors", "Source-proven", "OK", "None", "None"],
  ["Mappings", "/channels/mappings", "Partial", "version-manager.tsx conflicted", "Mobile list only in dfd8e70a side", "Merge conflict"],
  ["Audit", "/admin/audit", "Source-proven", "OK", "None", "None"],
  ["API keys", "/admin/api-keys", "Source-proven", "OK", "None", "None"],
  ["Webhooks", "/admin/webhooks", "Partial", "page.tsx conflicted", "aria hints partial", "Merge conflict"],
  ["Account security", "/settings/security", "Source-proven", "OK", "TOTP only; no FIDO2", "P2 gap"],
  ["Users/roles", "/admin/users", "Partial", "page.tsx conflicted", "DataGrid vs plain table conflict", "Merge conflict"],
  ["Billing/plan", "/admin/plan", "Source-proven", "OK", "No self-serve checkout — by design", "None"],
  ["ONDC", "/ondc", "Source-proven", "Gated — FEATURE_ONDC_ENABLED=false", "Not visible in production", "By design"],
  ["AI page", "/ai", "Source-proven", "Admin-only, non-production only", "Rule-based only, not LLM", "By design"],
];
children.push(makeTable(["Workflow", "Route", "Proof Level", "Status", "Key Gap", "Release Impact"], uxRows, [1200, 1700, 1400, 1200, 2060, 1800]));
children.push(...spacer(1));

// ── F. BACKEND/API CONTRACT MATRIX ───────────────────────────────────────────
children.push(h("F. Backend/API Contract Matrix", 1));
const apiRows = [
  ["GET /catalog/products/:id/revisions", "Proven", "catalog.controller.ts:91", "getProductRevisions()", "FoundationRoleAccess, ApiClientScopes", "Yes — tenantKey", "product-revision-history.test.cjs (conflicted)"],
  ["GET /catalog/products/:id/activity", "Proven", "catalog.controller.ts:175", "getProductActivity()", "FoundationRoleAccess, Roles", "Yes", "product-activity-timeline.test.cjs"],
  ["POST /catalog/products/:id/review-comments", "Proven", "catalog.controller.ts:148", "addApprovalComment()", "Roles(admin,editor,reviewer)", "Yes — tenantKey", "approval-comments.test.cjs"],
  ["GET /catalog/products/:id/review-comments", "Proven", "catalog.controller.ts:161", "listApprovalComments()", "FoundationRoleAccess", "Yes", "approval-comments.test.cjs"],
  ["POST /catalog/products/:id/review-decision", "Proven", "catalog.controller.ts:134", "decideProductReview()", "Roles(admin,editor,reviewer)", "Yes", "product-workflow-transitions.test.cjs"],
  ["POST /bulk-import/validate", "BUG — duplicate route", "bulk-import.controller.ts:28 AND 54", "Two handlers, same route — second unreachable", "—", "—", "Second handler silently unreachable"],
  ["POST /bulk-import/jobs/:id/validate", "Proven", "bulk-import.controller.ts:191", "preflightValidateJob()", "—", "Yes", "bulk-import-preflight.test.cjs"],
  ["Row repair", "Proven", "bulk-import.controller.ts:246", "repairRow()", "—", "Yes", "—"],
  ["GET /health", "Proven", "app.controller.ts:21", "—", "Public", "—", "—"],
  ["GET /health/internal", "Proven", "app.controller.ts:40", "—", "Admin-only", "—", "—"],
  ["MFA endpoints (6 routes)", "Proven", "mfa.controller.ts:33-89", "Full TOTP lifecycle", "@AllowMfaEnrollment, @Public", "Yes — tenantKey", "auth-mfa-login-contract.test.cjs"],
];
children.push(makeTable(["Endpoint", "Status", "Controller:Line", "Service Method", "Guard", "Tenant Isolation", "Tests"], apiRows, [1600, 900, 1500, 1400, 1400, 900, 1660]));
children.push(...spacer(1));

// ── G. DATA/MODEL REVIEW ─────────────────────────────────────────────────────
children.push(h("G. Data / Model Review", 1));
const modelRows = [
  ["ApprovalComment", "schema.prisma:1043", "id, tenantKey, productId, actorId, actorRole, body, createdAt", "tenantKey + RLS migration 20260506131000", "No Prisma @relation FK to Product — orphaned on product delete"],
  ["AuditLog", "schema.prisma:584", "id, tenantKey, action, resource, resourceId, metadata, createdAt", "tenantKey — multiple indexes", "No TTL/expiry enforcement at DB level — unbounded growth"],
  ["BulkImportJob", "Schema confirmed", "runId, jobRole (standard|large_batch), batchIndex, rowStart, rowEnd", "tenantKey", "runId nullable — standard jobs have no parent run"],
  ["BulkImportRun", "schema.prisma:440", "id, tenantKey, status, effectiveMode, preflightSummary, totalRows", "tenantKey — migration 20260506170000", "None — well-structured"],
  ["ConnectorSubmission", "Schema confirmed", "idempotencyKey (unique per tenant+installation)", "tenantKey + unique constraint on [tenantKey, installationId, idempotencyKey]", "Strong — idempotency enforced at DB level"],
  ["UserMfaEnrollment", "schema.prisma:706", "secretEncrypted, secretKeyVersion, backupCodes", "tenantKey — migration 20260504060000", "TOTP only — no FIDO2"],
  ["TenantAuthPolicy", "schema.prisma:690", "externalIdentityMode, mfaRequired, mfaGracePeriodDays, sessionTimeoutMinutes", "tenantKey unique", "externalIdentityMode is shell — no OIDC provider wired"],
  ["TenantPlanProfile", "schema.prisma:665", "billingProvider, externalCustomerId, externalSubscriptionId", "tenantKey unique", "Fields present, no Stripe/Razorpay SDK wiring"],
  ["ApiAccessKey", "schema.prisma:954", "scopes (String[]), keyPrefix, secretHash, expiresAt, revokedAt", "tenantKey", "Scopes are free-form strings — no enum constraint enforced"],
  ["MediaAsset", "schema.prisma:239", "storagePath, mimeType, checksum, sizeBytes", "tenantKey", "No virus scan, no content-type enforcement"],
];
children.push(makeTable(["Model", "Location", "Key Fields", "Tenant Isolation", "Risk"], modelRows, [1600, 1400, 2400, 2200, 1760]));
children.push(...spacer(1));

// ── H. FORBIDDEN CLAIM FINDINGS ──────────────────────────────────────────────
children.push(h("H. Forbidden Claim Findings", 1));
const forbiddenRows = [
  ["enterprise-ready / enterprise ready", "Multiple docs/execution/ files", "Safe — prohibition language (do not claim)", "Keep as-is"],
  ["AI-powered, AI enrichment, AI suggestions", "docs/execution/PO_SIGNOFF_CONTROLLED_PILOT_2026-05-06.md", "Safe — prohibition language", "Keep as-is"],
  ["WooCommerce", "docs/connectors/README.md (conflict dfd8e70a side)", "Safe roadmap — 'planned for future, not available'", "Resolve conflict; keep roadmap language"],
  ["self-serve billing, SSO ready, full MFA, full DAM", "Multiple docs", "Safe — prohibition/out-of-scope context", "Keep as-is"],
  ["TEJ Demo", "apps/api/src/billing/dto/billing-response.dto.ts:106", "Current stale brand — @ApiProperty({ example: 'TEJ Demo' })", "Change to 'Vexa Demo' (P3)"],
  ["TEJ PIM CONNECTOR_*", "docs/connectors/README.md (conflict residue)", "Historical — in conflict markers", "Will resolve with conflict"],
  ["tamper-evident, production-ready for all, Amazon India ready", "Searched — not found in unsafe context", "Safe prohibition language only", "Keep"],
];
children.push(makeTable(["Phrase", "File", "Classification", "Recommended Action"], forbiddenRows, [1800, 2400, 2760, 2400]));
children.push(...spacer(1));

// ── I. PENDING DEVELOPMENT / FIX QUEUE ───────────────────────────────────────
children.push(h("I. Pending Development / Fix Queue", 1));

children.push(h("I.1 P0 — Must Fix Before PR Merge", 2));
const p0Items = [
  "Resolve all 20 merge-conflict files — apps/web/package.json conflict alone blocks all npm commands",
  "Fix duplicate @Post('validate') decorator in bulk-import.controller.ts:28 and :54 — second handler (ImportValidateDto) is silently unreachable — real functional bug",
  "Re-run all gate commands after conflict resolution (gate:run:increment, gate:run:sprint, lint, build, test, audit)",
  "Update CURRENT_STATE.md to reflect 2026-05-12 rollout snapshot (currently stale in conflict)",
  "Update PROD_READINESS_RISK_REGISTER.md — '15/14' language is stale; actual state is 14/14 complete",
];
p0Items.forEach(item => children.push(bullet(item)));
children.push(...spacer(1));

children.push(h("I.2 P1 — Before Controlled Pilot", 2));
const p1Items = [
  "Add Prisma @relation FK to ApprovalComment.productId — orphaned rows possible on product deletion (cascade delete not automatic)",
  "Document Meesho export as non-functional in pilot scope — meesho.connector.ts:92 throws Error('Not implemented') at runtime",
];
p1Items.forEach(item => children.push(bullet(item)));
children.push(...spacer(1));

children.push(h("I.3 P2 — Before Broader Production", 2));
const p2Items = [
  "Meesho validateCredentials() always returns true (stub) — credential check non-functional",
  "Meesho validateProduct() always returns valid (stub) — product validation non-functional",
  "Amazon authoritative validation behind FEATURE_REAL_SPAPI_VALIDATION=false — local rules only",
  "Change 'TEJ Demo' to 'Vexa Demo' in billing-response.dto.ts:106 (stale brand in OpenAPI docs)",
  "ONDC behind FEATURE_ONDC_ENABLED=false — not visible in production (by design, document clearly)",
];
p2Items.forEach(item => children.push(bullet(item)));
children.push(...spacer(1));

children.push(h("I.4 P3 — Enterprise Only / Roadmap", 2));
const p3Items = [
  "Self-serve billing — TenantPlanProfile fields present but no Stripe/Razorpay SDK wiring",
  "FIDO2/WebAuthn MFA — only TOTP implemented",
  "OIDC/SSO/SCIM enforcement — externalIdentityMode field is a shell with no provider wiring",
  "WooCommerce connector — docs say 'planned for future release'",
  "Dedicated enterprise role hierarchy / org management beyond current 4-role model",
];
p3Items.forEach(item => children.push(bullet(item)));
children.push(...spacer(1));

children.push(h("I.5 Already Done / Stale Items", 2));
const doneItems = [
  "observationWindowComplete: true — 2026-05-12 snapshot confirmed",
  "controlledRollout.pending = [] — confirmed in 2026-05-12 snapshot",
  "broadRollout.pending = [] — confirmed in 2026-05-12 snapshot",
  "Health endpoint env mismatch — health.body.env = 'staging' confirmed fixed",
  "ApprovalComment API + schema — route + service + migration all confirmed",
  "Product activity timeline — confirmed at catalog.controller.ts:175",
  "consecutiveE10SignoffRuns: 2 — confirmed in 2026-05-12 snapshot",
];
doneItems.forEach(item => children.push(bullet(item)));
children.push(...spacer(1));

// ── J. MARKET COMPARISON ─────────────────────────────────────────────────────
children.push(h("J. Existing PIM Market Comparison", 1, { pageBreak: true }));
children.push(p("Note: Internet/web not used. Based on known public positioning as of knowledge cutoff August 2025. Should be externally verified before sales use.", { italic: true, color: "666666" }));
const marketRows = [
  ["Catalog centralization", "Strong", "Multi-category, dynamic attributes, HSN/GST", "Plytix SMB-tier baseline", "None for SMB", "Competitive for Indian SMB"],
  ["Dynamic attributes", "Strong", "AttributeDefinition per category/appliesTo", "Akeneo community", "None", "Competitive"],
  ["Variant modeling", "Partial", "SKU-level, basic", "Akeneo advanced hierarchy", "No variant family model", "Adequate for SMB"],
  ["Import/export", "Strong", "CSV up to 30K rows, preflight + repair unique", "Salsify automated EDI", "No EDI/automated feed", "Differentiated for Indian context"],
  ["Data quality/validation", "Strong", "Rule engine, rejection intelligence", "Salsify/inriver", "No ML-based auto-fix", "Differentiated"],
  ["Approval workflow + revision evidence", "Strong", "Diff-backed approval, audit trail", "No direct equivalent in Plytix/Sales Layer SMB tier", "None at this tier", "Differentiated"],
  ["Connector ecosystem", "Partial", "3 live connectors; Meesho partial", "Sales Layer (60+ connectors)", "Limited breadth", "Focus Indian marketplaces"],
  ["DAM/media", "Partial", "Basic R2 asset storage", "Plytix integrated DAM", "No smart tagging/CDN", "Below Plytix DAM"],
  ["API/webhooks", "Strong", "API key scopes, outbound HMAC-signed webhooks", "Competitive", "None", "Competitive"],
  ["Multi-tenant SaaS", "Strong", "tenantKey isolation + RLS", "Competitive", "None", "Competitive"],
  ["Self-serve billing", "Not implemented", "No Stripe/Razorpay SDK", "All competitors", "Gap", "Roadmap only"],
  ["Enterprise identity", "Partial", "TOTP MFA only; no SSO/SCIM", "Akeneo/Salsify enterprise", "No SSO/FIDO2", "P3 roadmap"],
  ["AI enrichment", "None (rule-based)", "String-matching suggestions only", "Akeneo AI features", "Behind market trend", "Roadmap"],
  ["Localization", "Not evidenced", "No evidence in source", "Akeneo/inriver multi-locale", "Gap", "Roadmap"],
  ["Pricing fit", "Competitive", "Rs 45,000/month accessible for Indian mid-market", "Plytix ~$500/month", "None for ICP", "Strong with guided onboarding"],
];
children.push(makeTable(
  ["Dimension", "Vexa Status", "Evidence", "Competitor Benchmark", "Gap", "Recommendation"],
  marketRows,
  [1400, 1100, 1600, 1600, 1200, 1460]
));
children.push(...spacer(1));

children.push(h("Sales Guidance", 2));
children.push(p("Vexa's wedge: Import preflight + rejection recovery + diff-backed approvals. No generic PIM offers these in an India-specific configuration.", { bold: true }));
children.push(p("Lead with: \"Your Flipkart rejection rate goes down because every product goes through preflight validation and diff-backed approval before submission.\""));
children.push(p("Avoid: AI claims, WooCommerce, enterprise SSO, 'replace your ERP', 'any marketplace'."));
children.push(p("Vexa is: Indian marketplace operations PIM for SMB/early mid-market. Not enterprise PIM. Not AI-powered PIM. Not universal marketplace platform."));
children.push(...spacer(1));

// ── K. PRICING ───────────────────────────────────────────────────────────────
children.push(h("K. Pricing and Packaging Recommendation", 1, { pageBreak: true }));
children.push(p("Evaluation of proposed pricing: Rs 75,000 setup + Rs 45,000/month + 90-day pilot + up to 5,000 SKUs + Shopify + Flipkart + guided onboarding."));
children.push(...spacer(1));

children.push(h("Recommended Pilot Package", 2));
const pilotRows = [
  ["Setup fee", "Rs 60,000–75,000", "Covers onboarding hours; refundable if pilot abandoned within 30 days"],
  ["Monthly (1K–2.5K SKUs)", "Rs 35,000/month", "Starter tier"],
  ["Monthly (2.5K–5K SKUs)", "Rs 45,000/month", "Growth tier"],
  ["Pilot duration", "60 days (not 90)", "Tighter scope, less momentum risk"],
  ["Channels included", "Shopify + Flipkart only", "Proven connectors only"],
  ["Support boundary", "8h onboarding + 4h/month ticket support", "Explicit to protect margin"],
  ["Discount rules", "None during pilot — adjust tier instead", "Pricing discipline"],
];
children.push(makeTable(["Component", "Recommended", "Rationale"], pilotRows, [2400, 2400, 4560]));
children.push(...spacer(1));

children.push(h("Post-Pilot Plan Bands", 2));
const planRows = [
  ["Starter", "Rs 25,000/month", "1,000 SKUs", "1 channel", "Self-managed after onboarding"],
  ["Growth", "Rs 45,000/month", "5,000 SKUs", "3 channels", "With quarterly review call"],
  ["Scale", "Rs 85,000/month", "15,000 SKUs", "All live connectors", "With dedicated CSM"],
];
children.push(makeTable(["Tier", "Price", "SKUs", "Channels", "Notes"], planRows, [1500, 2000, 1600, 1600, 2660]));
children.push(...spacer(1));

children.push(h("Ideal Customer Profile", 2));
["Indian D2C or marketplace seller", "2–50 person operations team", "Current tools: spreadsheets + marketplace seller panels", "Pain: rejection cycles, import errors, no change history", "Revenue: Rs 3–50 Crore/year", "SKU range: 500–5,000"].forEach(i => children.push(bullet(i)));

children.push(h("Disqualification Criteria", 2));
["Needs WooCommerce now (not roadmap tolerance)", "Needs SSO/SCIM for enterprise IT compliance", "Needs self-serve onboarding without guided setup", "< 500 SKUs (over-engineered solution)", "Needs Amazon India live API validation (FEATURE_REAL_SPAPI_VALIDATION=false)", "Meesho-primary seller (export flow not implemented)"].forEach(i => children.push(bullet(i)));
children.push(...spacer(1));

// ── L. ARCHITECTURE REVIEW ───────────────────────────────────────────────────
children.push(h("L. Architecture Review and Enhancement Backlog", 1, { pageBreak: true }));
const archRows = [
  ["Monorepo structure", "Strong", "Clean apps/api, apps/web, packages/db separation; npm workspaces", "packages/db has no separate test suite", "Add schema change integration tests", "P2", "BE", "Broader production", "Small"],
  ["NestJS module boundaries", "Strong", "25+ domain modules, global guards (ThrottlerGuard, JwtAuthGuard, RbacGuard), global interceptors", "AutoSuggestionsModule name could imply AI", "Rename to RuleBasedSuggestionsModule", "P3", "BE", "Low", "Small"],
  ["Frontend architecture", "Acceptable", "Next.js 15 App Router, force-dynamic on all auth pages, getServerAuthHeader() consistent", "Conflicted files block full assessment; no client error boundary audit", "Audit error boundary coverage", "P2", "FE", "Broader production", "Medium"],
  ["Data architecture", "Strong with caveats", "Prisma + PostgreSQL + tenantKey scoping + RLS migrations for sensitive models", "ApprovalComment missing @relation FK; AuditLog no TTL; ApiAccessKey.scopes free-form", "Add FK, add TTL policy, add scope enum", "P1/P2", "BE", "Pilot/Production", "Small"],
  ["Security architecture", "Acceptable", "JWT jti blocklist, TOTP MFA + backup codes, API key scopes, webhook HMAC, rate limiting", "mfaRequired enforcement not verified in read-only review; externalIdentityMode is shell", "Audit mfaRequired enforcement in auth.service.ts", "P1", "Security", "Pilot", "Small"],
  ["Integration architecture", "Acceptable", "BullMQ DLQ, ConnectorSubmission idempotency, connector caps (VALIDATE, PUBLISH, EXCEL_EXPORT)", "Meesho generateExportFile() throws Error('Not implemented'); Amazon validation disabled", "Remove Meesho from demo scope; document Amazon limit", "P1", "BE", "Pilot", "Small"],
  ["Operations architecture", "Acceptable", "Dockerfiles, railway.json, db-backup.sh, observability module, ADR-002, daily rollout automation", "Conflicted package.json would fail Docker build in CI", "Resolve conflict first", "P0", "DevOps", "PR merge", "Small"],
  ["Scalability", "Acceptable for SMB", "Cursor-based pagination, Large Import Mode up to 30K rows, BullMQ backpressure", "Large catalogs (>10K products) with rule evaluation may be slow; no async rule eval path", "Profile compliance rule evaluation at scale", "P2", "BE", "Broader production", "Medium"],
  ["Maintainability", "Needs enhancement", "100+ integration tests, TypeScript, OpenAPI auto-generation, gate automation", "Duplicate @Post('validate') route; catalog.service.ts has two incompatible implementations in conflict", "Fix duplicate route; resolve conflict implementation", "P0", "BE", "PR merge", "Small"],
  ["Product architecture fit", "SMB ready; broader production after conflict resolution", "All core routes proven; rollout evidence green; 2 bugs identified", "Enterprise: SSO/SCIM/FIDO2/billing all roadmap", "Enterprise roadmap only", "P3", "All", "Enterprise", "Large"],
];
children.push(makeTable(
  ["Area", "Status", "Evidence", "Risk", "Enhancement", "Priority", "Owner", "Release Impact", "Effort"],
  archRows,
  [1200, 1000, 1600, 1400, 1400, 600, 600, 1000, 560]
));
children.push(...spacer(1));

children.push(h("L.1 Top 5 Architecture Strengths", 2));
["Tenant isolation model — tenantKey throughout with RLS migrations for sensitive models (MFA, ApprovalComment)", "NestJS module boundaries — 25+ clean domain modules, global guards applied consistently", "Connector idempotency — DB-level unique constraint on [tenantKey, installationId, idempotencyKey]", "Rollout governance — automated daily snapshots, gate automation, increment/sprint ledger", "BullMQ queue with DLQ pattern — dead-letter handling for both import and export paths"].forEach(i => children.push(bullet(i)));

children.push(h("L.2 Top 5 Architecture Risks", 2));
["apps/web/package.json merge conflict blocks entire build pipeline — P0", "Duplicate @Post('validate') route in bulk-import.controller.ts:28,54 — second handler silently unreachable — P0 functional bug", "Meesho generateExportFile() throws Error('Not implemented') — P1 runtime blocker", "ApprovalComment has no Prisma @relation FK — orphaned rows on product deletion", "ApiAccessKey.scopes is String[] with no enum constraint — caller must validate scope names"].forEach(i => children.push(bullet(i)));

children.push(h("L.3 Enhancements Required Before Controlled Pilot", 2));
const pilotArchRows = [
  ["Resolve merge conflicts", "P0", "Small", "All 20 conflicted files — root cause of all build failures"],
  ["Fix duplicate @Post('validate') route", "P0", "Small", "bulk-import.controller.ts:28,54 — split into distinct routes"],
  ["Add Prisma @relation FK to ApprovalComment.productId", "P1", "Small", "Prevents orphaned approval comments on product deletion"],
  ["Document Meesho export as non-functional", "P1", "Small (docs)", "meesho.connector.ts:92 throws Not implemented at runtime"],
  ["Refresh CURRENT_STATE.md + PROD_READINESS_RISK_REGISTER.md", "P1", "Small (docs)", "Reflect 2026-05-12 snapshot — all gates now green"],
];
children.push(makeTable(["Enhancement", "Priority", "Effort", "Notes"], pilotArchRows, [2500, 800, 1000, 5060]));

children.push(h("L.4 Final Architecture Verdict", 2));
children.push(p("Acceptable for SMB pilot after conflict resolution. The architecture supports the approved direction. No rebuild needed. Two bugs (duplicate route, missing FK) are small fixes. The security posture (TOTP MFA, JWT blocklist, API key scopes, webhook HMAC, tenant isolation) is above the SMB baseline and does not require immediate enhancement for the controlled pilot.", { spacing: { after: 200 } }));
children.push(...spacer(1));

// ── M. CHANGED FILES ─────────────────────────────────────────────────────────
children.push(h("M. Changed Files", 1));
children.push(p("No files were changed during this review. Review was read-only. The 20 conflicted files existed before this session from the interrupted git pull origin main.", { bold: true, color: "27AE60" }));
children.push(...spacer(1));

// ── N. REMAINING BLOCKERS ────────────────────────────────────────────────────
children.push(h("N. Remaining Blockers", 1));

children.push(h("Demo Blockers", 2));
children.push(p("None — demo walkthrough does not require a build."));

children.push(h("Controlled Pilot Blockers", 2));
["Resolve 20 merge conflicts", "Run all gate commands after resolution", "Fix duplicate @Post('validate') route", "Add @relation FK to ApprovalComment.productId", "Refresh CURRENT_STATE.md and PROD_READINESS_RISK_REGISTER.md with 2026-05-12 snapshot values"].forEach(i => children.push(bullet(i)));

children.push(h("Broader Production Blockers", 2));
["All pilot blockers above", "Document Meesho/Amazon limits explicitly in contract and sales materials", "Change 'TEJ Demo' to 'Vexa Demo' in billing-response.dto.ts:106"].forEach(i => children.push(bullet(i)));

children.push(h("Enterprise Blockers", 2));
["SSO/OIDC/SCIM implementation", "FIDO2/WebAuthn MFA", "Self-serve billing (Stripe/Razorpay)", "Dedicated enterprise role hierarchy", "Enterprise data isolation beyond tenant-key scoping"].forEach(i => children.push(bullet(i)));

children.push(h("Future-Scope Roadmap", 2));
["WooCommerce connector", "Amazon SP-API live validation (FEATURE_REAL_SPAPI_VALIDATION=true)", "True AI/LLM enrichment", "Localization/multi-locale", "Advanced DAM capabilities", "ONDC production enablement"].forEach(i => children.push(bullet(i)));
children.push(...spacer(1));

// ── O. SAFE RELEASE CLAIM ────────────────────────────────────────────────────
children.push(h("O. Safe Release Claim", 1));
children.push(new Paragraph({
  spacing: { after: 160 },
  border: { left: { style: BorderStyle.SINGLE, size: 8, color: "27AE60", space: 8 } },
  indent: { left: 360 },
  children: [new TextRun({
    text: "Vexa PIM supports controlled paid pilot for Indian SMB and early mid-market sellers on Shopify and Flipkart. Standard imports support up to 10,000 rows; large-mode CSV imports support up to 30,000 rows. Import preflight catches errors before any products are created. Every product change is tracked with a diff-backed revision history visible to approvers. Approval comments are stored per review thread. Connector submissions are idempotent. API keys, outbound webhooks, MFA (TOTP), and admin audit visibility are all production-ready. Not yet enterprise-ready. Self-serve billing, WooCommerce, live Amazon SP-API validation, SSO, and AI enrichment remain future-scope.",
    font: "Arial", size: 20, italics: true, color: "1A5276"
  })]
}));
children.push(...spacer(1));

// ── P. CLAIMS TO AVOID ───────────────────────────────────────────────────────
children.push(h("P. Claims To Avoid", 1));
const avoidClaims = [
  "Enterprise-ready — no SSO, no SCIM, no enterprise role hierarchy",
  "AI-powered or AI enrichment or AI suggestions — suggestion system is rule-based string matching only",
  "WooCommerce (as available) — not implemented",
  "All Indian marketplaces — Meesho is export-intent only; ONDC is experimental",
  "Amazon India ready or live Amazon validation — FEATURE_REAL_SPAPI_VALIDATION=false",
  "Self-serve billing — no Stripe/Razorpay wiring",
  "SSO ready or OIDC — externalIdentityMode field exists, no provider wiring",
  "Full MFA enforcement — TOTP available; enforcement is policy-configurable, not mandatory",
  "Full DAM — basic R2 asset storage only",
  "Tamper-evident audit — standard append-only log, no cryptographic chaining",
  "Production-ready for all customer segments",
];
avoidClaims.forEach(i => children.push(bullet(i, { color: "C0392B" })));
children.push(...spacer(1));

// ── Q. FINAL RECOMMENDATION ──────────────────────────────────────────────────
children.push(h("Q. Final Recommendation", 1, { pageBreak: true }));
children.push(p("Resolve the merge conflict immediately. This is the only action needed before the worktree is usable. The merge conflict in apps/web/package.json is the single root cause blocking all 8 npm-based validation commands.", { bold: true }));
children.push(...spacer(1));

children.push(h("After conflict resolution, do in order:", 2));
["Run npm run gate:run:increment and npm run gate:run:sprint — expect to pass based on pre-conflict evidence, but must be confirmed", "Fix the duplicate @Post('validate') route in bulk-import.controller.ts", "Add @relation FK to ApprovalComment.productId in schema", "Refresh CURRENT_STATE.md and PROD_READINESS_RISK_REGISTER.md with the 2026-05-12 snapshot values", "Change 'TEJ Demo' example in billing-response.dto.ts to 'Vexa Demo'"].forEach((item, i) => {
  children.push(new Paragraph({
    numbering: { reference: "numbers", level: 0 },
    spacing: { after: 60 },
    children: [new TextRun({ text: item, font: "Arial", size: 20 })]
  }));
});
children.push(...spacer(1));

const finalRows = [
  ["Ready for PR review", "No — resolve conflicts first"],
  ["Ready to merge", "No — same"],
  ["Ready for controlled paid pilot", "Yes, after conflict resolution + gate re-run"],
  ["Ready for broader production", "Yes, after conflict resolution + gate re-run + docs refresh"],
  ["Ready for enterprise", "No — SSO/SCIM/FIDO2/billing all roadmap"],
  ["What must happen next", "1. Resolve 20 merge conflicts  2. Run all gate commands  3. Fix duplicate route  4. Add FK to ApprovalComment  5. Refresh CURRENT_STATE.md + risk register"],
];
children.push(makeTable(["Item", "Status"], finalRows, [3000, 6360]));
children.push(...spacer(1));

children.push(p("The 2026-05-12 rollout snapshot confirms that controlled-rollout criteria and broad-rollout criteria are both fully met: controlledRollout.pending = [], broadRollout.pending = [], observationWindowComplete = true, consecutiveE10SignoffRuns = 2, health.ok = true. The claim that 'Vexa PIM is sellable for controlled paid pilot and early SMB/mid-market customers' is supported by code and evidence — but it requires the conflicts to be resolved and gates to pass to be defensible in a PR review.", { italic: true, color: "1A5276" }));

// ── BUILD DOCUMENT ────────────────────────────────────────────────────────────
const doc = new Document({
  styles: {
    default: {
      document: { run: { font: "Arial", size: 20 } }
    },
    paragraphStyles: [
      {
        id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 36, bold: true, font: "Arial", color: "2E4057" },
        paragraph: { spacing: { before: 400, after: 200 }, outlineLevel: 0, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "2E4057", space: 4 } } }
      },
      {
        id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 26, bold: true, font: "Arial", color: "2E4057" },
        paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 1 }
      },
      {
        id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 22, bold: true, font: "Arial", color: "4A4A4A" },
        paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 2 }
      },
    ]
  },
  numbering: {
    config: [
      {
        reference: "bullets",
        levels: [{
          level: 0, format: LevelFormat.BULLET, text: "•", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } }
        }]
      },
      {
        reference: "numbers",
        levels: [{
          level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } }
        }]
      },
    ]
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 }
      }
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC", space: 4 } },
          children: [new TextRun({ text: "Vexa PIM Deep Evidence-Only Review  |  2026-05-13  |  CONFIDENTIAL", font: "Arial", size: 16, color: "888888" })]
        })]
      })
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          border: { top: { style: BorderStyle.SINGLE, size: 4, color: "CCCCCC", space: 4 } },
          children: [
            new TextRun({ text: "Page ", font: "Arial", size: 16, color: "888888" }),
            new TextRun({ children: [PageNumber.CURRENT], font: "Arial", size: 16, color: "888888" }),
            new TextRun({ text: " of ", font: "Arial", size: 16, color: "888888" }),
            new TextRun({ children: [PageNumber.TOTAL_PAGES], font: "Arial", size: 16, color: "888888" }),
          ]
        })]
      })
    },
    children
  }]
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync(OUT, buffer);
  console.log("Created:", OUT);
  console.log("Size:", Math.round(buffer.length / 1024), "KB");
}).catch(err => {
  console.error("ERROR:", err.message);
  process.exit(1);
});
