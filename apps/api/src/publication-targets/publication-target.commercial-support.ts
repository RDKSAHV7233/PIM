import type { CommercialSupportFact } from "./publication-target.types";

/**
 * Commercial-support records (ADR-0015 section 5, Sprint 5.1c-1).
 *
 * `commerciallySupported` is a Product Owner decision, recorded as an auditable record. It is never inferred from
 * a launch stage, an adapter's existence, an installation, or healthy credentials. No record means not supported.
 *
 * Records are appended by PR. A record is superseded or ended by revoking or expiring it, never by editing history:
 * add a new record and set `revokedAt` on the old one.
 *
 * Nothing reads this yet; 5.1c-3 turns it into the evaluator's `commercialSupport` fact.
 */
export interface CommercialSupportRecord {
  connector: string;
  commerciallySupported: boolean;
  /** Only the Product Owner can approve; any other value invalidates the record. */
  approvedBy: "PO";
  /** Reference to the approval (a PR, decision record or ticket), not a free-text assertion. */
  approvalRef: string;
  approvedAt: string;
  validUntil: string | null;
  revokedAt: string | null;
  reason: string;
}

/**
 * Every record the Product Owner has approved. Empty on purpose: the repository holds no Product Owner
 * commercial-support approval for any connector. Launch-stage approvals (po_review, early_access) are release
 * decisions, not commercial-support decisions, and are not records of this kind.
 */
export const COMMERCIAL_SUPPORT_RECORDS: readonly CommercialSupportRecord[] = Object.freeze([]);

/** Problems with a set of records; an empty array means they are valid. */
export function validateCommercialSupportRecords(records: readonly CommercialSupportRecord[], knownConnectors: readonly string[]): string[] {
  const problems: string[] = [];
  const active = new Map<string, number>();
  records.forEach((record, index) => {
    const where = `record ${index} (${record.connector})`;
    if (!knownConnectors.includes(record.connector)) problems.push(`${where}: unknown connector`);
    if (record.approvedBy !== "PO") problems.push(`${where}: approvedBy must be PO`);
    if (typeof record.approvalRef !== "string" || record.approvalRef.trim().length === 0) problems.push(`${where}: missing approvalRef`);
    if (typeof record.reason !== "string" || record.reason.trim().length === 0) problems.push(`${where}: missing reason`);
    const approvedMs = Date.parse(record.approvedAt);
    if (!Number.isFinite(approvedMs)) problems.push(`${where}: unparseable approvedAt`);
    if (record.validUntil !== null) {
      const untilMs = Date.parse(record.validUntil);
      if (!Number.isFinite(untilMs)) problems.push(`${where}: unparseable validUntil`);
      else if (Number.isFinite(approvedMs) && untilMs <= approvedMs) problems.push(`${where}: validUntil is not after approvedAt`);
    }
    if (record.revokedAt !== null) {
      const revokedMs = Date.parse(record.revokedAt);
      if (!Number.isFinite(revokedMs)) problems.push(`${where}: unparseable revokedAt`);
      else if (Number.isFinite(approvedMs) && revokedMs < approvedMs) problems.push(`${where}: revokedAt precedes approvedAt`);
    } else if (record.commerciallySupported) {
      active.set(record.connector, (active.get(record.connector) ?? 0) + 1);
    }
  });
  for (const [connector, count] of active) {
    if (count > 1) problems.push(`${connector}: ${count} unrevoked supporting records; revoke the older one when adding a new record`);
  }
  return problems;
}

/**
 * The evaluator's commercial-support fact for one connector at a point in time. A record counts only when it is
 * a valid Product Owner approval that is supportive, started, not expired and not revoked. Otherwise: null, which
 * the evaluator reports as NOT_COMMERCIALLY_SUPPORTED. Never returns a supportive fact without a reference.
 */
export function resolveCommercialSupportFact(
  connector: string,
  now: Date,
  records: readonly CommercialSupportRecord[] = COMMERCIAL_SUPPORT_RECORDS,
): CommercialSupportFact | null {
  const slug = String(connector ?? "").trim().toLowerCase();
  const nowMs = now.getTime();
  const current = records.filter((record) => {
    if (record.connector !== slug || record.commerciallySupported !== true || record.approvedBy !== "PO") return false;
    if (typeof record.approvalRef !== "string" || record.approvalRef.trim().length === 0) return false;
    const approvedMs = Date.parse(record.approvedAt);
    if (!Number.isFinite(approvedMs) || approvedMs > nowMs) return false;
    if (record.validUntil !== null && !(Date.parse(record.validUntil) > nowMs)) return false;
    if (record.revokedAt !== null && !(Date.parse(record.revokedAt) > nowMs)) return false;
    return true;
  });
  if (current.length === 0) return null;
  const latest = current.reduce((a, b) => (Date.parse(b.approvedAt) > Date.parse(a.approvedAt) ? b : a));
  return { commerciallySupported: true, approvedBy: latest.approvedBy, approvalRef: latest.approvalRef };
}
