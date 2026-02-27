# Phase 0 Kit - Foundation and Validation

## Goal
De-risk product direction, lock MVP scope, and finalize technical direction before build.

## 1) Interview Guide (20-30 Sellers)

Target mix:
- 8-10 small sellers
- 8-10 mid-size brands
- 4-8 aggregators or agencies

Interview sections:
1. Current listing workflow
2. Rejection history and reasons
3. Compliance pain (GST/HSN and category rules)
4. Bulk upload pain (Excel and data cleanup)
5. Channel-specific pain (Amazon/Flipkart/Meesho/ONDC)
6. Tool stack and switching friction
7. Willingness to pay

Output format per interview:
- Seller profile
- Top 3 pains
- Current workaround
- Measured impact (hours/week, rejection %, cost)
- Buy signal (high/medium/low)

## 2) Pricing Sensitivity Test

Hypothesis:
- Sellers pay when rejection reduction and bulk throughput gains are clear.

Test tiers (monthly, INR):
- Starter: INR 2,999
- Growth: INR 7,999
- Pro: INR 14,999

What to test:
- Preferred tier and reason
- Must-have features per tier
- Objections
- Expected ROI timeframe

Success criteria:
- At least 5 qualified prospects accept one tested range
- At least 3 prospects agree to paid pilot terms or LOI

## 3) Workflow Validation

Must-validate flows:
1. Product create/edit with variants
2. Category-driven attributes and compliance checks
3. Channel mapping and pre-submission validation
4. Bulk import and repair loop

Validation checklist:
- Task completion without facilitator intervention
- Time-on-task recorded
- Errors/hesitations logged
- Feature requests separated from blockers

Success criteria:
- At least 80% task completion across 5+ users
- No critical blocker on core workflows

## 4) MVP Scope Freeze (Sign-off)

In MVP (Phase 1-4):
- Catalog core
- Compliance and dynamic attributes
- Marketplace mapping and validation
- Bulk upload/edit/repair
- Security, audit, and baseline observability

Out of MVP:
- Advanced DAM expansion beyond core checks
- Rejection scoring intelligence
- ONDC deep protocol features
- AI optimization features

Sign-off block:
- Product Owner:
- Engineering Lead:
- GTM Lead:
- Date:

## 5) Canonical Data Model (v0)

Core entities:
- Tenant
- Product (parent)
- SKU/Variant (sellable)
- Category
- AttributeDefinition
- AttributeValue
- ComplianceRule
- ChannelMapping
- MediaAsset
- ImportJob
- ValidationIssue
- AuditEvent

Key design rules:
- Canonical schema independent from channel schemas
- Channel mapping as separate layer
- Validation issues stored with severity and remediation text
- Schema versioning via `schema_version`

## 6) Architecture Decisions (ADRs)

ADR-001 API style:
- Decision: REST-first for MVP with OpenAPI contracts.
- Rationale: Faster team onboarding and partner compatibility.

ADR-002 Data store:
- Decision: PostgreSQL as primary transactional store.
- Rationale: Strong relational consistency for catalog and validation state.

ADR-003 Background jobs:
- Decision: Queue-backed async workers for imports and heavy validations.
- Rationale: Stable processing for large Excel jobs.

ADR-004 Search:
- Decision: Start with PostgreSQL indexes; defer dedicated search engine until scaling signals.
- Rationale: Reduce early complexity.

ADR-005 Media storage:
- Decision: Object storage abstraction with signed URL access.
- Rationale: Cost-effective and scalable media handling.

ADR-006 Adapter architecture:
- Decision: Channel adapter contract with versioned mapping packs.
- Rationale: Handle marketplace schema drift safely.

## 7) Exit Criteria Checklist
- [ ] Interviews complete and synthesized
- [ ] Pricing signals documented
- [ ] Workflow validation complete
- [ ] MVP scope signed off
- [ ] Canonical model approved
- [ ] Architecture ADRs approved
- [ ] Beta pipeline (LOIs or pilots) established
