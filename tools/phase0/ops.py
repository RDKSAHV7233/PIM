from __future__ import annotations

import argparse
import csv
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parents[2]
PHASE0 = ROOT / "docs" / "phase-0"


DONE_VALUES = {"done", "completed", "complete"}
TASK_DONE_VALUES = DONE_VALUES | {"pass", "passed"}


def read_csv(path: Path):
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def norm(value: str) -> str:
    return (value or "").strip()


def lower(value: str) -> str:
    return norm(value).lower()


def parse_iso_date(raw: str):
    text = norm(raw)
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%Y/%m/%d"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    return None


def is_signoff_approved(path: Path):
    if not path.exists():
        return False
    lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    for raw in lines:
        line = raw.strip().lower()
        if line.startswith("decision:") or line.startswith("- decision:"):
            return ("approved" in line) and ("not approved" not in line) and ("/" not in line)
    return False


def count_interviews_completed(rows):
    return sum(1 for r in rows if lower(r.get("status", "")) in DONE_VALUES)


def count_pricing_sessions(rows):
    keys = ["seller_name", "preferred_tier", "budget_ceiling_inr", "buy_confidence"]
    return sum(1 for r in rows if any(norm(r.get(k, "")) for k in keys))


def count_usability_sessions(rows):
    keys = ["participant", "task_1_status", "task_2_status", "task_3_status", "task_4_status"]
    return sum(1 for r in rows if any(norm(r.get(k, "")) for k in keys))


def workflow_completion_rate(rows):
    task_fields = ["task_1_status", "task_2_status", "task_3_status", "task_4_status"]
    total = 0
    done = 0
    for r in rows:
        for field in task_fields:
            value = lower(r.get(field, ""))
            if value:
                total += 1
                if value in TASK_DONE_VALUES:
                    done += 1
    return 0.0 if total == 0 else (done / total) * 100.0


def count_adrs(adrs_dir: Path):
    if not adrs_dir.exists():
        return 0
    return len(list(adrs_dir.glob("ADR-*.md")))


def target_gap(actual: int, target_min: int):
    return max(0, target_min - actual)


def contact_status_summary(rows):
    bucket = {}
    for row in rows:
        status = lower(row.get("status", "")) or "unknown"
        bucket[status] = bucket.get(status, 0) + 1
    return sorted(bucket.items(), key=lambda x: x[0])


@dataclass
class FollowUpItem:
    lead_id: str
    company_name: str
    contact_name: str
    status: str
    next_action: str
    next_action_date: str
    owner: str
    notes: str


def iter_followups_due(rows: Iterable[dict], today: date):
    followup_statuses = {
        "contacted",
        "replied",
        "scheduled",
        "reschedule",
        "follow-up",
        "followup",
    }
    for row in rows:
        status = lower(row.get("status", ""))
        next_action = norm(row.get("next_action", ""))
        next_date_raw = norm(row.get("next_action_date", ""))
        next_date = parse_iso_date(next_date_raw)

        if status in {"new", "completed", "dropped"} and not next_action:
            continue

        is_due = False
        if next_date and next_date <= today:
            is_due = True
        if not next_date and (status in followup_statuses or next_action):
            is_due = True

        if is_due:
            yield FollowUpItem(
                lead_id=norm(row.get("lead_id", "")),
                company_name=norm(row.get("company_name", "")),
                contact_name=norm(row.get("contact_name", "")),
                status=norm(row.get("status", "")),
                next_action=next_action,
                next_action_date=next_date_raw,
                owner=norm(row.get("owner", "")),
                notes=norm(row.get("notes", "")),
            )


def print_status():
    interviews = read_csv(PHASE0 / "interviews" / "INTERVIEW_TRACKER.csv")
    pricing = read_csv(PHASE0 / "pricing" / "PRICING_RESULTS.csv")
    usability = read_csv(PHASE0 / "workflow" / "USABILITY_LOG.csv")
    contacts = read_csv(PHASE0 / "interviews" / "CONTACT_PIPELINE.csv")
    signoff = PHASE0 / "decisions" / "MVP_SCOPE_SIGNOFF.md"
    adrs_dir = PHASE0 / "decisions" / "adrs"

    interviews_done = count_interviews_completed(interviews)
    pricing_done = count_pricing_sessions(pricing)
    usability_done = count_usability_sessions(usability)
    completion_rate = workflow_completion_rate(usability)
    signoff_ok = is_signoff_approved(signoff)
    adr_count = count_adrs(adrs_dir)

    print("Phase 0 Operator Status")
    print("=" * 24)
    print(f"- Interviews completed: {interviews_done} / 20 (minimum gate)")
    print(f"- Pricing sessions with data: {pricing_done} / 5")
    print(f"- Usability sessions with data: {usability_done} / 5")
    print(f"- Workflow task completion rate: {completion_rate:.1f}% / 80% target")
    print(f"- MVP sign-off approved: {'Yes' if signoff_ok else 'No'}")
    print(f"- ADR files present: {adr_count} / 6")
    print("-" * 24)

    print("Contact Pipeline")
    for status, count in contact_status_summary(contacts):
        print(f"- {status}: {count}")

    print("-" * 24)
    print("Immediate Targets")
    print(f"- Interviews to schedule now: {target_gap(interviews_done, 20)}")
    print(f"- Pricing calls to run now: {target_gap(pricing_done, 5)}")
    print(f"- Usability sessions to run now: {target_gap(usability_done, 5)}")
    if completion_rate < 80.0 and usability_done > 0:
        print("- Workflow quality gap: improve task design or prototype clarity")


def print_followups(limit: int):
    contacts = read_csv(PHASE0 / "interviews" / "CONTACT_PIPELINE.csv")
    today = date.today()
    due = list(iter_followups_due(contacts, today))

    print("Contact Follow-Ups Due")
    print("=" * 24)
    if not due:
        print("- No due follow-ups based on current pipeline data.")
        return

    due_sorted = sorted(
        due,
        key=lambda x: (
            parse_iso_date(x.next_action_date) or date(1970, 1, 1),
            x.lead_id,
        ),
    )
    for item in due_sorted[:limit]:
        who = item.contact_name or item.company_name or "unknown"
        when = item.next_action_date or "no-date"
        owner = item.owner or "unassigned"
        action = item.next_action or "follow up"
        print(f"- {item.lead_id}: {who} | status={item.status or 'unknown'} | due={when} | owner={owner} | action={action}")

    remaining = len(due_sorted) - min(len(due_sorted), limit)
    if remaining > 0:
        print(f"- ... and {remaining} more")


def build_parser():
    parser = argparse.ArgumentParser(description="Phase 0 operations helper")
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("status", help="Show Phase 0 progress, targets, and pipeline summary")

    followups = sub.add_parser("followups", help="Show due contact follow-ups")
    followups.add_argument("--limit", type=int, default=20, help="Max rows to print")
    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()

    if args.command == "status":
        print_status()
    elif args.command == "followups":
        print_followups(limit=args.limit)


if __name__ == "__main__":
    main()
