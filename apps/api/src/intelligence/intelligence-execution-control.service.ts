import { Injectable, Logger } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { normalizeTenantKey } from "../common/tenant/tenant.constants";
import { PrismaService } from "../prisma/prisma.service";
import { IntelligenceCapabilityRegistry } from "./intelligence-capability.registry";
import {
  CHARGE_ORDER,
  DISPATCH_LEASE_MS,
  PROVIDER_TIMEOUT_MS,
  SUPPORTED_CURRENCY,
  UNCLAIMED_RESERVATION_TTL_MS,
  dayPeriodKey,
  evaluateBudgetCounterRow,
  evaluatePlatformControl,
  evaluateTenantPolicy,
  isLiveCapability,
  monthPeriodKey,
  PLATFORM_CONTROL_ID,
  readDeployFlag,
  type BudgetCounterRow,
  type ChargeScope,
  type GateDenial,
  type PlatformControlRow,
} from "./intelligence-execution-gates";
import { InvalidMoneyError, microsToString, parseMicros, parsePositiveMicros } from "./intelligence-money";
import type {
  AdmitProviderExecutionInput,
  AiProviderExecutionDenialReason,
  AiReservationStatus,
  ProviderAdmissionResult,
  ProviderReservationSweepSummary,
  ReservationClaimResult,
  ReservationRef,
  ReservationSettlement,
  ReservationSettlementResult,
} from "./intelligence.types";

/**
 * AI-PROV-004b-i: the provider execution control plane.
 *
 * Gates, atomic multi-counter budget reservation, claim, settlement, expiry and the guarded run
 * wrapper. There is **no provider call, no network code, no credential and no Product mutation**
 * in this file. The work callback of `runWithReservation` is where a future adapter call will go.
 *
 * Design: docs/qa/ai-prov-004b-design-2026-10-05.md.
 */

export type DispatchBilling =
  | { kind: "usage"; actualCostMicros: bigint | string | number }
  | { kind: "confirmed_non_billable" }
  | { kind: "unknown" };

export interface DispatchWorkResult<T> {
  billing: DispatchBilling;
  value?: T;
}

export interface DispatchContext {
  tenantKey: string;
  reservationId: string;
  claimToken: string;
  leaseExpiresAt: Date;
}

export type GovernedRunResult<T> =
  | { status: "denied"; admission: ProviderAdmissionResult }
  | { status: "duplicate_in_flight"; reservationId: string }
  | { status: "provider_disabled"; reason: AiProviderExecutionDenialReason; reservationId: string }
  | { status: "completed"; reservationId: string; settlement: ReservationSettlementResult; value?: T }
  | {
      status: "result_discarded";
      reason: "kill_switch_during_call" | "late_result";
      reservationId: string;
      settlement: ReservationSettlementResult;
    }
  | { status: "work_threw"; reservationId: string; settlement: ReservationSettlementResult };

export type RevalidationResult = { ok: true } | { ok: false; reason: AiProviderExecutionDenialReason };

class DenySignal extends Error {
  constructor(
    readonly reason: AiProviderExecutionDenialReason,
    readonly policyId?: string,
    readonly policyVersion?: string,
  ) {
    super(reason);
    this.name = "DenySignal";
  }
}

const RESERVATION_TX_OPTIONS = { maxWait: 5000, timeout: 10000 } as const;
const SWEEP_LIMIT_PER_ADMISSION = 20;
const MAX_ATTEMPT_NUMBER = 10;

type AdmissionBase = Omit<
  ProviderAdmissionResult,
  "decision" | "allowed" | "denialReason" | "reservationId" | "reservationStatus" | "policyId" | "policyVersion" | "budgetPeriodKeys"
>;

@Injectable()
export class IntelligenceExecutionControlService {
  private readonly logger = new Logger(IntelligenceExecutionControlService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly capabilityRegistry: IntelligenceCapabilityRegistry,
  ) {}

  /** Test seam: the clock. Production uses the system clock. */
  protected now(): Date {
    return new Date();
  }

  /** Test seam: the deploy flag. Production reads the environment on every call, never cached. */
  protected deployFlagEnabled(): boolean {
    return readDeployFlag();
  }

  // ---------------------------------------------------------------------------------------------
  // Admission: G0 to G4 and the atomic reservation
  // ---------------------------------------------------------------------------------------------

  async admit(input: AdmitProviderExecutionInput): Promise<ProviderAdmissionResult> {
    let parsed: ParsedAdmission;
    try {
      parsed = this.parseAdmission(input);
    } catch (error) {
      return this.invalidRequest(input, error);
    }
    const { base } = parsed;

    if (!this.deployFlagEnabled()) {
      return this.deny(base, "platform_feature_disabled");
    }
    if (parsed.executionMode !== "live_provider") {
      return this.deny(base, "execution_mode_disabled");
    }
    if (
      !this.capabilityRegistry.isInAi001Scope(parsed.capability) ||
      this.capabilityRegistry.isExplicitlyOutOfScope(parsed.capability) ||
      !isLiveCapability(parsed.capability)
    ) {
      return this.deny(base, "capability_disallowed");
    }

    const platformDenial = await this.readPlatformGate(parsed);
    if (platformDenial) {
      return this.deny(base, platformDenial);
    }

    // Maintenance only: it never authorises anything, so a failure here is logged and ignored.
    await this.sweepExpired({ tenantKey: parsed.tenantKey, limit: SWEEP_LIMIT_PER_ADMISSION }).catch((error) => {
      this.logger.warn(`admission sweep failed: ${this.errorName(error)}`);
    });

    // A concurrent admission for the same key loses the unique-key race exactly once. It then reads the winner.
    for (let round = 0; round < 2; round += 1) {
      try {
        return await this.reserveOnce(parsed);
      } catch (error) {
        if (error instanceof DenySignal) {
          if (error.reason === "budget_exhausted") {
            await this.recordBlockedAttempt(parsed).catch((recordError) => {
              this.logger.warn(`blocked attempt not recorded: ${this.errorName(recordError)}`);
            });
          }
          return this.deny({ ...base }, error.reason, error.policyId, error.policyVersion);
        }
        if (this.isUniqueViolation(error)) {
          continue;
        }
        this.logger.error(`admission failed closed: ${this.errorName(error)}`);
        return this.deny(base, "budget_indeterminate");
      }
    }
    return this.deny(base, "budget_indeterminate");
  }

  private async readPlatformGate(parsed: ParsedAdmission): Promise<GateDenial | null> {
    let row: PlatformControlRow | null;
    try {
      row = await this.loadPlatformControl(parsed.tenantKey);
    } catch (error) {
      this.logger.error(`platform control unreadable: ${this.errorName(error)}`);
      return "control_unreadable";
    }
    return evaluatePlatformControl(row, {
      tenantKey: parsed.tenantKey,
      providerKey: parsed.providerKey,
      modelKey: parsed.modelKey,
      estimatedCostMicros: parsed.estimateMicros,
    });
  }

  private async loadPlatformControl(tenantKey: string): Promise<PlatformControlRow | null> {
    const row = await this.prisma.tenant(tenantKey).aiPlatformControl.findUnique({ where: { id: PLATFORM_CONTROL_ID } });
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      enabled: row.enabled,
      killSwitch: row.killSwitch,
      allowedProvider: row.allowedProvider,
      allowedModel: row.allowedModel,
      allowedTenantKeys: row.allowedTenantKeys,
      maxRequestCostMicros: row.maxRequestCostMicros,
    };
  }

  private async reserveOnce(parsed: ParsedAdmission): Promise<ProviderAdmissionResult> {
    const { base, tenantKey, capability, providerKey, executionMode, requestFingerprint, attemptNumber } = parsed;
    const db = this.prisma.tenant(tenantKey);

    return db.$transaction(async (tx) => {
      const now = this.now();
      const policy = await tx.aiTenantPolicy.findFirst({
        where: { tenantKey, capability, providerKey, status: "active" },
        orderBy: { updatedAt: "desc" },
      });
      if (!policy) {
        throw new DenySignal("missing_tenant_policy");
      }
      const policyDenial = evaluateTenantPolicy(policy, capability, providerKey);
      if (policyDenial) {
        throw new DenySignal(policyDenial, policy.id, policy.policyVersion);
      }

      const existing = await tx.aiProviderBudgetReservation.findUnique({
        where: { tenantKey_requestFingerprint_attemptNumber: { tenantKey, requestFingerprint, attemptNumber } },
      });
      if (existing) {
        return this.resultFromExisting(base, existing, parsed, now, policy.id, policy.policyVersion);
      }

      const dayKey = dayPeriodKey(now);
      const monthKey = monthPeriodKey(now);
      const [tenantMonth, tenantDay, platformMonth, platformDay] = await Promise.all([
        this.findTenantCounter(tx, parsed, monthKey),
        this.findTenantCounter(tx, parsed, dayKey),
        tx.aiPlatformBudgetPeriod.findUnique({ where: { periodKey: monthKey } }),
        tx.aiPlatformBudgetPeriod.findUnique({ where: { periodKey: dayKey } }),
      ]);
      const counters: Record<ChargeScope, BudgetCounterRow | null> = {
        platform_month: platformMonth,
        platform_day: platformDay,
        tenant_month: tenantMonth,
        tenant_day: tenantDay,
      };
      for (const scope of CHARGE_ORDER) {
        const denial = evaluateBudgetCounterRow(counters[scope], now);
        if (denial) {
          throw new DenySignal(denial, policy.id, policy.policyVersion);
        }
      }

      // Inserting the reservation first takes the (tenant, fingerprint, attempt) key, so two concurrent
      // identical admissions serialise here and the loser re-reads the winner.
      const reservation = await tx.aiProviderBudgetReservation.create({
        data: {
          tenantKey,
          budgetPolicyId: (counters.tenant_month as BudgetCounterRow).id,
          capability,
          providerKey,
          executionMode,
          periodKey: monthKey,
          requestFingerprint,
          attemptNumber,
          requestedEstimatedCostMicros: parsed.estimateMicros,
          reservedCostMicros: parsed.estimateMicros,
          currency: SUPPORTED_CURRENCY,
          status: "reserved",
          correlationId: this.safeCorrelation(parsed.correlationId),
          expiresAt: new Date(now.getTime() + UNCLAIMED_RESERVATION_TTL_MS),
        },
      });

      // Fixed lock order across every code path. All four must fit or the whole transaction rolls back.
      for (const scope of CHARGE_ORDER) {
        const row = counters[scope] as BudgetCounterRow;
        const charged = await this.chargeCounter(tx, scope, row.id, parsed.estimateMicros, tenantKey, now);
        if (!charged) {
          throw new DenySignal("budget_exhausted", policy.id, policy.policyVersion);
        }
      }
      await tx.aiProviderBudgetCharge.createMany({
        data: CHARGE_ORDER.map((scope) => ({
          tenantKey,
          reservationId: reservation.id,
          scope,
          counterRowId: (counters[scope] as BudgetCounterRow).id,
          amountMicros: parsed.estimateMicros,
        })),
      });

      this.logEvent("ai.provider.admission", {
        decision: "ALLOW",
        tenantKey,
        capability,
        attemptNumber,
        reservationId: reservation.id,
        estimatedCostMicros: microsToString(parsed.estimateMicros),
      });
      return this.allow(base, reservation.id, "reserved", parsed.estimateMicros, policy.id, policy.policyVersion, { day: dayKey, month: monthKey });
    }, RESERVATION_TX_OPTIONS);
  }

  private findTenantCounter(tx: Prisma.TransactionClient, parsed: ParsedAdmission, periodKey: string) {
    return tx.aiProviderBudgetPolicy.findFirst({
      where: {
        tenantKey: parsed.tenantKey,
        capability: parsed.capability,
        providerKey: parsed.providerKey,
        executionMode: parsed.executionMode,
        periodKey,
        enabled: true,
      },
      orderBy: { updatedAt: "desc" },
    });
  }

  /**
   * One conditional UPDATE per counter. PostgreSQL serialises concurrent updates to the same row and re-evaluates
   * the predicate against the new value, so two workers cannot both pass the same remaining-budget check.
   */
  private async chargeCounter(
    tx: Prisma.TransactionClient,
    scope: ChargeScope,
    rowId: string,
    estimate: bigint,
    tenantKey: string,
    now: Date,
  ): Promise<boolean> {
    if (scope === "platform_day" || scope === "platform_month") {
      // RLS-BYPASS: ai_platform_budget_periods is a deliberately global table with no tenant_key; the row id is in the predicate.
      const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        UPDATE "ai_platform_budget_periods"
        SET
          "reserved_spend_micros" = "reserved_spend_micros" + ${estimate},
          "request_count" = "request_count" + 1,
          "version" = "version" + 1,
          "updated_at" = NOW()
        WHERE "id" = ${rowId}
          AND "enabled" = true
          AND "currency" = ${SUPPORTED_CURRENCY}
          AND "period_started_at" <= ${now}
          AND "period_ends_at" > ${now}
          AND "request_count" < "request_limit"
          AND ("reserved_spend_micros" + "spent_spend_micros" + ${estimate}) <= "spend_limit_micros"
        RETURNING "id"
      `);
      return rows.length === 1;
    }
    // RLS-BYPASS: this conditional reservation updates one tenant-scoped budget row and includes tenant_key in the predicate.
    const rows = await tx.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      UPDATE "ai_provider_budget_policies"
      SET
        "reserved_spend_micros" = "reserved_spend_micros" + ${estimate},
        "request_count" = "request_count" + 1,
        "version" = "version" + 1,
        "updated_at" = NOW()
      WHERE "id" = ${rowId}
        AND "tenant_key" = ${tenantKey}
        AND "enabled" = true
        AND "currency" = ${SUPPORTED_CURRENCY}
        AND "period_started_at" <= ${now}
        AND "period_ends_at" > ${now}
        AND "request_count" < "request_limit"
        AND ("reserved_spend_micros" + "spent_spend_micros" + ${estimate}) <= "spend_limit_micros"
      RETURNING "id"
    `);
    return rows.length === 1;
  }

  private resultFromExisting(
    base: AdmissionBase,
    existing: {
      id: string;
      status: string;
      capability: string;
      providerKey: string;
      executionMode: string;
      currency: string;
      reservedCostMicros: bigint;
      expiresAt: Date;
    },
    parsed: ParsedAdmission,
    now: Date,
    policyId: string,
    policyVersion: string,
  ): ProviderAdmissionResult {
    const status = existing.status as AiReservationStatus;
    const withRef = { ...base, reservationId: existing.id, reservationStatus: status, policyId, policyVersion };
    if (
      existing.capability !== parsed.capability ||
      existing.providerKey !== parsed.providerKey ||
      existing.executionMode !== parsed.executionMode ||
      existing.currency !== SUPPORTED_CURRENCY
    ) {
      return this.denyWith(withRef, "budget_indeterminate");
    }
    if (status === "reserved" && existing.expiresAt > now) {
      // Idempotent while unclaimed: the claim, not the admission, arbitrates who dispatches.
      return this.allow(base, existing.id, "reserved", existing.reservedCostMicros, policyId, policyVersion);
    }
    if (status === "dispatching") {
      return this.denyWith(withRef, "reservation_in_flight");
    }
    if (status === "budget_blocked") {
      return this.denyWith(withRef, "budget_exhausted");
    }
    return this.denyWith(withRef, "reservation_settled");
  }

  /** Records that this attempt was blocked by budget, so a later look at the attempt shows why. Idempotent. */
  private async recordBlockedAttempt(parsed: ParsedAdmission): Promise<void> {
    const now = this.now();
    const db = this.prisma.tenant(parsed.tenantKey);
    const monthKey = monthPeriodKey(now);
    const counter = await this.findTenantCounter(db as unknown as Prisma.TransactionClient, parsed, monthKey);
    if (!counter) {
      return;
    }
    try {
      await db.aiProviderBudgetReservation.create({
        data: {
          tenantKey: parsed.tenantKey,
          budgetPolicyId: counter.id,
          capability: parsed.capability,
          providerKey: parsed.providerKey,
          executionMode: parsed.executionMode,
          periodKey: monthKey,
          requestFingerprint: parsed.requestFingerprint,
          attemptNumber: parsed.attemptNumber,
          requestedEstimatedCostMicros: parsed.estimateMicros,
          reservedCostMicros: 0n,
          currency: SUPPORTED_CURRENCY,
          status: "budget_blocked",
          settledAt: now,
          settlementReason: "budget_exhausted",
          correlationId: this.safeCorrelation(parsed.correlationId),
        },
      });
    } catch (error) {
      if (!this.isUniqueViolation(error)) {
        throw error;
      }
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Claim, re-validation, settlement
  // ---------------------------------------------------------------------------------------------

  /** Compare-and-set `reserved -> dispatching`. Only the caller that gets `claimed: true` may dispatch. */
  async claim(ref: ReservationRef): Promise<ReservationClaimResult> {
    const tenantKey = normalizeTenantKey(ref.tenantKey);
    const db = this.prisma.tenant(tenantKey);
    const now = this.now();
    const claimToken = randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + DISPATCH_LEASE_MS);

    const updated = await db.aiProviderBudgetReservation.updateMany({
      where: { id: ref.reservationId, tenantKey, status: "reserved", expiresAt: { gt: now } },
      data: { status: "dispatching", claimedAt: now, leaseExpiresAt, claimToken },
    });
    if (updated.count === 1) {
      return { claimed: true, claimToken, leaseExpiresAt };
    }
    const current = await db.aiProviderBudgetReservation.findFirst({
      where: { id: ref.reservationId, tenantKey },
      select: { status: true, expiresAt: true },
    });
    if (!current) {
      return { claimed: false, reason: "not_found" };
    }
    if (current.status === "dispatching") {
      return { claimed: false, reason: "duplicate_in_flight" };
    }
    if (current.status === "reserved") {
      return { claimed: false, reason: "expired" };
    }
    return { claimed: false, reason: "not_reserved" };
  }

  /**
   * Re-evaluates every mutable control from fresh reads, immediately before dispatch. Nothing captured at
   * admission is trusted. Any failure or unreadable control is a denial.
   */
  async revalidateBeforeDispatch(context: {
    tenantKey: string;
    reservationId: string;
    claimToken: string;
    capability: string;
    providerKey: string;
    modelKey: string;
  }): Promise<RevalidationResult> {
    const tenantKey = normalizeTenantKey(context.tenantKey);
    try {
      if (!this.deployFlagEnabled()) {
        return { ok: false, reason: "platform_feature_disabled" };
      }
      if (
        !this.capabilityRegistry.isInAi001Scope(context.capability) ||
        this.capabilityRegistry.isExplicitlyOutOfScope(context.capability) ||
        !isLiveCapability(context.capability)
      ) {
        return { ok: false, reason: "capability_disallowed" };
      }
      const db = this.prisma.tenant(tenantKey);
      const now = this.now();
      const reservation = await db.aiProviderBudgetReservation.findFirst({
        where: { id: context.reservationId, tenantKey },
        include: { charges: true },
      });
      if (
        !reservation ||
        reservation.status !== "dispatching" ||
        reservation.claimToken !== context.claimToken ||
        !reservation.leaseExpiresAt ||
        reservation.leaseExpiresAt.getTime() < now.getTime() + PROVIDER_TIMEOUT_MS
      ) {
        return { ok: false, reason: "reservation_in_flight" };
      }

      const platformDenial = evaluatePlatformControl(await this.loadPlatformControl(tenantKey), {
        tenantKey,
        providerKey: context.providerKey,
        modelKey: context.modelKey,
        estimatedCostMicros: reservation.requestedEstimatedCostMicros,
      });
      if (platformDenial) {
        return { ok: false, reason: platformDenial };
      }

      const policy = await db.aiTenantPolicy.findFirst({
        where: { tenantKey, capability: context.capability, providerKey: context.providerKey, status: "active" },
        orderBy: { updatedAt: "desc" },
      });
      if (!policy) {
        return { ok: false, reason: "missing_tenant_policy" };
      }
      const policyDenial = evaluateTenantPolicy(policy, context.capability, context.providerKey);
      if (policyDenial) {
        return { ok: false, reason: policyDenial };
      }

      if (reservation.charges.length !== CHARGE_ORDER.length) {
        return { ok: false, reason: "budget_indeterminate" };
      }
      for (const charge of reservation.charges) {
        const row =
          charge.scope === "platform_day" || charge.scope === "platform_month"
            ? await db.aiPlatformBudgetPeriod.findUnique({ where: { id: charge.counterRowId } })
            : await db.aiProviderBudgetPolicy.findFirst({ where: { id: charge.counterRowId, tenantKey } });
        const denial = evaluateBudgetCounterRow(row, now);
        if (denial) {
          return { ok: false, reason: denial };
        }
      }
      return { ok: true };
    } catch (error) {
      this.logger.error(`pre-dispatch revalidation failed closed: ${this.errorName(error)}`);
      return { ok: false, reason: "control_unreadable" };
    }
  }

  /**
   * Settles a reservation exactly once. Every transition is a compare-and-set on the current status, in the same
   * transaction as the counter changes, so status and counters cannot diverge and a repeat is a no-op.
   */
  async settle(ref: ReservationRef & { claimToken?: string }, settlement: ReservationSettlement): Promise<ReservationSettlementResult> {
    return this.applySettlement(ref, settlement, { system: false });
  }

  private async applySettlement(
    ref: ReservationRef & { claimToken?: string },
    settlement: ReservationSettlement,
    options: { system: boolean },
  ): Promise<ReservationSettlementResult> {
    const tenantKey = normalizeTenantKey(ref.tenantKey);
    const db = this.prisma.tenant(tenantKey);
    const now = this.now();

    let actual: bigint | null = null;
    if (settlement.kind === "reconcile") {
      actual = parseMicros("actualCostMicros", settlement.actualCostMicros);
    }
    const fromStatuses: string[] =
      settlement.kind === "reconcile" ? ["dispatching"] : settlement.kind === "cancel" ? ["reserved", "dispatching"] : ["dispatching"];
    const toStatus = settlement.kind === "reconcile" ? "reconciled" : settlement.kind === "cancel" ? "cancelled" : "expired";
    const reason = settlement.kind === "reconcile" ? "provider_usage" : settlement.reason.slice(0, 120);

    return db.$transaction(async (tx) => {
      const flipped = await tx.aiProviderBudgetReservation.updateMany({
        where: {
          id: ref.reservationId,
          tenantKey,
          status: { in: fromStatuses },
          // A worker must present the claim token to leave `dispatching`; the sweeper acts as the system.
          ...(options.system ? {} : { OR: [{ status: "reserved" }, { claimToken: ref.claimToken ?? "" }] }),
        },
        data: {
          status: toStatus,
          settledAt: now,
          actualCostMicros: actual,
          settlementReason: reason,
        },
      });

      if (flipped.count !== 1) {
        const current = await tx.aiProviderBudgetReservation.findFirst({ where: { id: ref.reservationId, tenantKey } });
        if (!current) {
          return { applied: false as const, status: "not_found" as const, reconcileConflict: false };
        }
        const conflict = settlement.kind === "reconcile" && current.status === "reconciled" && current.actualCostMicros !== actual;
        if (conflict) {
          this.logEvent("ai.provider.reconcile_conflict", { tenantKey, reservationId: ref.reservationId });
        }
        return { applied: false as const, status: current.status as AiReservationStatus, reconcileConflict: conflict };
      }

      const reservation = await tx.aiProviderBudgetReservation.findFirstOrThrow({
        where: { id: ref.reservationId, tenantKey },
        include: { charges: true },
      });
      const charges = [...reservation.charges].sort(
        (a, b) => CHARGE_ORDER.indexOf(a.scope as ChargeScope) - CHARGE_ORDER.indexOf(b.scope as ChargeScope),
      );
      let settledTotal = 0n;
      for (const charge of charges) {
        const settled = settlement.kind === "reconcile" ? (actual as bigint) : settlement.kind === "cancel" ? 0n : charge.amountMicros;
        settledTotal = settled;
        const counterUpdate = {
          reservedSpendMicros: { decrement: charge.amountMicros },
          spentSpendMicros: { increment: settled },
          ...(settlement.kind === "cancel" ? { requestCount: { decrement: 1 } } : {}),
          version: { increment: 1 },
        };
        if (charge.scope === "platform_day" || charge.scope === "platform_month") {
          await tx.aiPlatformBudgetPeriod.update({ where: { id: charge.counterRowId }, data: counterUpdate });
        } else {
          await tx.aiProviderBudgetPolicy.update({ where: { id: charge.counterRowId, tenantKey }, data: counterUpdate });
        }
        await tx.aiProviderBudgetCharge.update({ where: { id: charge.id, tenantKey }, data: { settledAmountMicros: settled } });
      }

      const overrun = settlement.kind === "reconcile" && (actual as bigint) > reservation.reservedCostMicros;
      this.logEvent("ai.provider.settlement", {
        tenantKey,
        reservationId: ref.reservationId,
        outcome: toStatus,
        reason,
        settledCostMicros: microsToString(settledTotal),
        reservedCostMicros: microsToString(reservation.reservedCostMicros),
        overrun,
      });
      return {
        applied: true as const,
        status: toStatus as "reconciled" | "cancelled" | "expired",
        settledCostMicros: microsToString(settledTotal),
        overrun,
      };
    }, RESERVATION_TX_OPTIONS);
  }

  // ---------------------------------------------------------------------------------------------
  // Expiry
  // ---------------------------------------------------------------------------------------------

  /**
   * Unclaimed reservations past their TTL are cancelled and released (the provider was provably never called).
   * Dispatching reservations past their lease are expired and settled at the estimate (billing unknown).
   * Safe to run concurrently: every transition is a compare-and-set.
   */
  async sweepExpired(options: { tenantKey: string; limit?: number }): Promise<ProviderReservationSweepSummary> {
    const tenantKey = normalizeTenantKey(options.tenantKey);
    const limit = Math.max(1, Math.min(options.limit ?? 100, 500));
    const db = this.prisma.tenant(tenantKey);
    const now = this.now();
    const summary: ProviderReservationSweepSummary = { scanned: 0, cancelledUnclaimed: 0, expiredDispatching: 0, skipped: 0 };

    const unclaimed = await db.aiProviderBudgetReservation.findMany({
      where: { tenantKey, status: "reserved", expiresAt: { lt: now } },
      orderBy: { expiresAt: "asc" },
      take: limit,
      select: { id: true },
    });
    for (const row of unclaimed) {
      summary.scanned += 1;
      const result = await this.applySettlement({ tenantKey, reservationId: row.id }, { kind: "cancel", reason: "unclaimed_ttl_expired" }, { system: true });
      if (result.applied) {
        summary.cancelledUnclaimed += 1;
      } else {
        summary.skipped += 1;
      }
    }

    const lapsed = await db.aiProviderBudgetReservation.findMany({
      where: { tenantKey, status: "dispatching", leaseExpiresAt: { lt: now } },
      orderBy: { leaseExpiresAt: "asc" },
      take: limit,
      select: { id: true },
    });
    for (const row of lapsed) {
      summary.scanned += 1;
      const result = await this.applySettlement(
        { tenantKey, reservationId: row.id },
        { kind: "expire_unknown_billing", reason: "lease_expired" },
        { system: true },
      );
      if (result.applied) {
        summary.expiredDispatching += 1;
      } else {
        summary.skipped += 1;
      }
    }
    return summary;
  }

  // ---------------------------------------------------------------------------------------------
  // Guarded run: admit, claim, revalidate, work, settle
  // ---------------------------------------------------------------------------------------------

  /**
   * The generic wrapper a future adapter call runs inside. In 004b-i the callback is supplied by tests only; no
   * product code path calls this method. It never persists suggestions and never mutates Product data.
   */
  async runWithReservation<T>(
    input: AdmitProviderExecutionInput,
    work: (context: DispatchContext) => Promise<DispatchWorkResult<T>>,
  ): Promise<GovernedRunResult<T>> {
    const admission = await this.admit(input);
    if (!admission.allowed || !admission.reservationId) {
      return { status: "denied", admission };
    }
    const ref = { tenantKey: admission.tenantKey, reservationId: admission.reservationId };

    const claim = await this.claim(ref);
    if (!claim.claimed) {
      return { status: "duplicate_in_flight", reservationId: admission.reservationId };
    }

    const revalidation = await this.revalidateBeforeDispatch({
      ...ref,
      claimToken: claim.claimToken,
      capability: admission.capability,
      providerKey: admission.providerKey,
      modelKey: admission.modelKey,
    });
    if (!revalidation.ok) {
      await this.settle({ ...ref, claimToken: claim.claimToken }, { kind: "cancel", reason: `revalidation_${revalidation.reason}` });
      return { status: "provider_disabled", reason: revalidation.reason, reservationId: admission.reservationId };
    }

    let outcome: DispatchWorkResult<T>;
    try {
      outcome = await work({ ...ref, claimToken: claim.claimToken, leaseExpiresAt: claim.leaseExpiresAt });
    } catch (error) {
      this.logger.error(`dispatch work threw: ${this.errorName(error)}`);
      const settlement = await this.settle({ ...ref, claimToken: claim.claimToken }, { kind: "expire_unknown_billing", reason: "work_threw" });
      return { status: "work_threw", reservationId: admission.reservationId, settlement };
    }

    const settlement = await this.settle({ ...ref, claimToken: claim.claimToken }, this.settlementFor(outcome.billing));
    if (!settlement.applied) {
      return { status: "result_discarded", reason: "late_result", reservationId: admission.reservationId, settlement };
    }
    if (await this.killActive(ref.tenantKey, admission)) {
      return { status: "result_discarded", reason: "kill_switch_during_call", reservationId: admission.reservationId, settlement };
    }
    return { status: "completed", reservationId: admission.reservationId, settlement, ...(outcome.value === undefined ? {} : { value: outcome.value }) };
  }

  private settlementFor(billing: DispatchBilling): ReservationSettlement {
    switch (billing.kind) {
      case "usage":
        return { kind: "reconcile", actualCostMicros: billing.actualCostMicros };
      case "confirmed_non_billable":
        return { kind: "cancel", reason: "confirmed_non_billable" };
      default:
        return { kind: "expire_unknown_billing", reason: "billing_unknown" };
    }
  }

  /** True when a control that can stop provider use has turned off while the call was in flight. */
  private async killActive(tenantKey: string, admission: ProviderAdmissionResult): Promise<boolean> {
    try {
      if (!this.deployFlagEnabled()) {
        return true;
      }
      const platformDenial = evaluatePlatformControl(await this.loadPlatformControl(tenantKey), {
        tenantKey,
        providerKey: admission.providerKey,
        modelKey: admission.modelKey,
        estimatedCostMicros: parsePositiveMicros("estimate", admission.requestedEstimatedCostMicros),
      });
      if (platformDenial === "platform_kill_switch" || platformDenial === "platform_feature_disabled" || platformDenial === "control_unreadable") {
        return true;
      }
      const policy = await this.prisma.tenant(tenantKey).aiTenantPolicy.findFirst({
        where: { tenantKey, capability: admission.capability, providerKey: admission.providerKey, status: "active" },
        orderBy: { updatedAt: "desc" },
      });
      return !policy || policy.killSwitchEnabled || policy.tenantOptOut || !policy.providerExecutionEnabled;
    } catch {
      return true;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // helpers
  // ---------------------------------------------------------------------------------------------

  private parseAdmission(input: AdmitProviderExecutionInput): ParsedAdmission {
    const tenantKey = normalizeTenantKey(input.tenantKey);
    const capability = this.text("capability", input.capability);
    const providerKey = this.text("providerKey", input.providerKey);
    const modelKey = this.text("modelKey", input.modelKey);
    const requestFingerprint = this.text("requestFingerprint", input.requestFingerprint);
    const attemptNumber = input.attemptNumber ?? 1;
    if (!Number.isInteger(attemptNumber) || attemptNumber < 1 || attemptNumber > MAX_ATTEMPT_NUMBER) {
      throw new InvalidMoneyError("attemptNumber", "must be an integer from 1 to 10.");
    }
    const currency = String(input.currency ?? SUPPORTED_CURRENCY).trim().toUpperCase();
    if (currency !== SUPPORTED_CURRENCY) {
      throw new InvalidMoneyError("currency", "must be USD.");
    }
    const estimateMicros = parsePositiveMicros("requestedEstimatedCostMicros", input.requestedEstimatedCostMicros);
    const executionMode = String(input.executionMode ?? "live_provider");
    const base: AdmissionBase = {
      tenantKey,
      capability,
      providerKey,
      modelKey,
      executionMode: executionMode as ProviderAdmissionResult["executionMode"],
      attemptNumber,
      requestFingerprint,
      requestedEstimatedCostMicros: microsToString(estimateMicros),
      reservedCostMicros: "0",
      currency,
      providerCallAttempted: false,
      canonicalProductMutationEnabled: false,
    };
    return {
      base,
      tenantKey,
      capability,
      providerKey,
      modelKey,
      requestFingerprint,
      attemptNumber,
      estimateMicros,
      executionMode,
      correlationId: input.correlationId ?? null,
    };
  }

  private text(field: string, value: unknown): string {
    if (typeof value !== "string" || value.trim().length === 0 || value.length > 256) {
      throw new InvalidMoneyError(field, "is required.");
    }
    return value.trim();
  }

  private safeCorrelation(value: string | null): string | null {
    return typeof value === "string" && value.length > 0 ? value.slice(0, 128) : null;
  }

  private invalidRequest(input: AdmitProviderExecutionInput, error: unknown): ProviderAdmissionResult {
    this.logger.warn(`admission rejected as invalid_request: ${this.errorName(error)}`);
    const clip = (value: unknown) => String(value ?? "").slice(0, 128);
    return {
      decision: "DENY",
      allowed: false,
      denialReason: "invalid_request",
      tenantKey: clip(input?.tenantKey),
      capability: clip(input?.capability),
      providerKey: clip(input?.providerKey),
      modelKey: clip(input?.modelKey),
      executionMode: "live_provider",
      attemptNumber: 1,
      requestFingerprint: clip(input?.requestFingerprint),
      requestedEstimatedCostMicros: "0",
      reservedCostMicros: "0",
      currency: SUPPORTED_CURRENCY,
      providerCallAttempted: false,
      canonicalProductMutationEnabled: false,
    };
  }

  private allow(
    base: AdmissionBase,
    reservationId: string,
    status: AiReservationStatus,
    reserved: bigint,
    policyId: string,
    policyVersion: string,
    budgetPeriodKeys?: { day: string; month: string },
  ): ProviderAdmissionResult {
    return {
      ...base,
      decision: "ALLOW",
      allowed: true,
      reservationId,
      reservationStatus: status,
      reservedCostMicros: microsToString(reserved),
      policyId,
      policyVersion,
      ...(budgetPeriodKeys ? { budgetPeriodKeys } : {}),
    };
  }

  private deny(
    base: AdmissionBase,
    reason: AiProviderExecutionDenialReason,
    policyId?: string,
    policyVersion?: string,
  ): ProviderAdmissionResult {
    this.logEvent("ai.provider.admission", {
      decision: "DENY",
      tenantKey: base.tenantKey,
      capability: base.capability,
      attemptNumber: base.attemptNumber,
      gate: reason,
    });
    return {
      ...base,
      decision: "DENY",
      allowed: false,
      denialReason: reason,
      reservedCostMicros: "0",
      ...(policyId ? { policyId } : {}),
      ...(policyVersion ? { policyVersion } : {}),
    };
  }

  private denyWith(
    base: AdmissionBase & { reservationId?: string; reservationStatus?: AiReservationStatus; policyId?: string; policyVersion?: string },
    reason: AiProviderExecutionDenialReason,
  ): ProviderAdmissionResult {
    return { ...base, decision: "DENY", allowed: false, denialReason: reason, reservedCostMicros: "0" };
  }

  private isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
  }

  private errorName(error: unknown): string {
    return error instanceof Error ? error.name : "unknown_error";
  }

  /** Structured, payload-free event. Money is always a decimal string. No prompt, payload, key or product value. */
  private logEvent(event: string, fields: Record<string, unknown>): void {
    this.logger.log(JSON.stringify({ event, ...fields }));
  }
}

type ParsedAdmission = {
  base: AdmissionBase;
  tenantKey: string;
  capability: string;
  providerKey: string;
  modelKey: string;
  requestFingerprint: string;
  attemptNumber: number;
  estimateMicros: bigint;
  executionMode: string;
  correlationId: string | null;
};

