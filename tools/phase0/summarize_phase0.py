from __future__ import annotations

import csv
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
PHASE0 = ROOT / "docs" / "phase-0"


def read_csv(path: Path):
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def norm(value: str) -> str:
    return (value or "").strip()


def done_count(rows, field="status"):
    done_values = {"done", "completed", "complete"}
    return sum(1 for r in rows if norm(r.get(field, "")).lower() in done_values)


def task_completion_rate(rows):
    done_values = {"done", "completed", "complete", "pass", "passed"}
    task_fields = ["task_1_status", "task_2_status", "task_3_status", "task_4_status"]
    total = 0
    done = 0
    for row in rows:
        for field in task_fields:
            v = norm(row.get(field, "")).lower()
            if v:
                total += 1
                if v in done_values:
                    done += 1
    return 0.0 if total == 0 else (done / total) * 100.0


def non_empty_count(rows, keys):
    c = 0
    for row in rows:
        if any(norm(row.get(k, "")) for k in keys):
            c += 1
    return c


def top_values(rows, key, n=5):
    counter = Counter(norm(r.get(key, "")).lower() for r in rows if norm(r.get(key, "")))
    return counter.most_common(n)


def top_pains(rows, n=5):
    counter = Counter()
    pain_fields = ["top_pain_1", "top_pain_2", "top_pain_3"]
    for r in rows:
        for field in pain_fields:
            v = norm(r.get(field, "")).lower()
            if v:
                counter[v] += 1
    return counter.most_common(n)


def format_pairs(pairs):
    if not pairs:
        return "- none"
    return "\n".join(f"- {k}: {v}" for k, v in pairs)


def main():
    interview_rows = read_csv(PHASE0 / "interviews" / "INTERVIEW_TRACKER.csv")
    pricing_rows = read_csv(PHASE0 / "pricing" / "PRICING_RESULTS.csv")
    usability_rows = read_csv(PHASE0 / "workflow" / "USABILITY_LOG.csv")
    contact_rows = read_csv(PHASE0 / "interviews" / "CONTACT_PIPELINE.csv")

    interviews_done = done_count(interview_rows, "status")
    interviews_target = "20-30"
    pricing_sessions = non_empty_count(
        pricing_rows,
        ["seller_name", "preferred_tier", "budget_ceiling_inr", "buy_confidence"],
    )
    usability_sessions = non_empty_count(
        usability_rows,
        ["participant", "task_1_status", "task_2_status", "task_3_status", "task_4_status"],
    )
    completion_rate = task_completion_rate(usability_rows)
    leads_active = non_empty_count(
        contact_rows,
        ["company_name", "contact_name", "phone", "email", "status"],
    )

    segment_mix = top_values(interview_rows, "segment", n=3)
    tier_pref = top_values(pricing_rows, "preferred_tier", n=3)
    pains = top_pains(interview_rows, n=5)
    blockers = sum(
        1
        for r in usability_rows
        if norm(r.get("critical_blocker", "")).lower() in {"yes", "y", "true", "1"}
    )

    ts = datetime.now(timezone.utc).astimezone().strftime("%Y-%m-%d %H:%M %Z")

    out = f"""# Phase 0 Live Summary

Generated at: {ts}

## Progress Snapshot
- Interviews completed: {interviews_done} (target {interviews_target})
- Pricing sessions with data: {pricing_sessions} (target >=5)
- Workflow usability sessions with data: {usability_sessions} (target >=5)
- Workflow task completion rate: {completion_rate:.1f}% (target >=80%)
- Contact pipeline rows with activity: {leads_active}

## Interview Insights (Current)
Top segment mix:
{format_pairs(segment_mix)}

Top recurring pains:
{format_pairs(pains)}

## Pricing Signals (Current)
Tier preference distribution:
{format_pairs(tier_pref)}

## Workflow Validation (Current)
- Critical blockers reported: {blockers}

## Gate Readiness Hint
- Run: `python tools/phase0/check_phase0.py`
- Status is data-driven; keep trackers updated daily.
"""

    output_path = PHASE0 / "outputs" / "PHASE0_LIVE_SUMMARY.md"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(out, encoding="utf-8")
    print(f"Wrote {output_path}")


if __name__ == "__main__":
    main()
