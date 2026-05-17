# ADR-008: Billing is Operator-Mediated, No Payment Processor Integration

- Date: 2026-05-17
- Status: Accepted (pending separate funded decision)

## Problem

The product has a complete billing-governance surface: `TenantPlanProfile`, `PlanLimits`, `PlanUsage`, `TenantCommercialRequest`, plan-tier upgrade requests, suspension and cancellation lifecycle, and admin/internal endpoints under `/billing`. It does not have a payment processor integration. There is no Stripe `customerId`, no Razorpay subscription, no webhook for `invoice.paid`. Cash collection is by invoice; operators flip `planTier` manually on payment receipt.

## Options Considered

1. Integrate Stripe (preferred for international).
2. Integrate Razorpay (preferred for India; matches target ICP).
3. Defer the choice until a funded sprint commits to one.
4. Build neutral abstraction, integrate both.

## Decision

Option 3. PO has explicitly deferred the processor choice in `docs/execution/PO_SIGNOFF_CONTROLLED_PILOT_2026-05-06.md`. The schema is processor-ready. No billing code ships until processor choice is funded and sprint-scheduled.

## Consequences

Positive:
- Pilot can ship without payment processing complexity.
- Schema design is not biased toward one processor.

Negative / mitigations:
- Sales motion requires manual onboarding and invoice collection. Mitigated by guided onboarding included in pilot pricing.
- Customers cannot self-serve upgrades. Mitigated by `POST /billing/upgrade-request` queueing requests to operators.
- "Self-serve billing" is on the forbidden-claims list (PO V3 / V4). Sales must not imply it exists.

## Revisit when

- A funded sprint commits to a specific processor choice.
- Aggregate pilot-to-paid conversion exceeds 3 customers/month — manual operator overhead becomes a bottleneck.
- An enterprise prospect requires PO-backed invoicing rules that cannot be satisfied by current operator workflow.
