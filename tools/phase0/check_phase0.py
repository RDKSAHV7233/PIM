from __future__ import annotations

import csv
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]


def read_csv(path: Path):
    if not path.exists():
        return []
    with path.open(newline="", encoding="utf-8") as f:
        return list(csv.DictReader(f))


def count_interviews_done(rows):
    done_values = {"done", "completed", "complete"}
    return sum(1 for r in rows if (r.get("status", "").strip().lower() in done_values))


def count_pricing_sessions(rows):
    # Count rows where at least one meaningful field is filled.
    return sum(
        1
        for r in rows
        if any(
            (r.get(k, "") or "").strip()
            for k in ["seller_name", "preferred_tier", "budget_ceiling_inr", "buy_confidence"]
        )
    )


def workflow_task_completion_rate(rows):
    if not rows:
        return 0.0
    done_values = {"done", "completed", "complete", "pass", "passed"}
    task_fields = ["task_1_status", "task_2_status", "task_3_status", "task_4_status"]
    total_tasks = 0
    done_tasks = 0
    for row in rows:
        for field in task_fields:
            value = (row.get(field, "") or "").strip().lower()
            if value:
                total_tasks += 1
                if value in done_values:
                    done_tasks += 1
    if total_tasks == 0:
        return 0.0
    return (done_tasks / total_tasks) * 100.0


def mvp_signoff_is_approved(path: Path):
    if not path.exists():
        return False
    lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
    for raw in lines:
        line = raw.strip().lower()
        if line.startswith("decision:") or line.startswith("- decision:"):
            # Accept only explicit approved decision and reject template variants.
            return ("approved" in line) and ("not approved" not in line) and ("/" not in line)
    return False


def exists(path: Path):
    return "Yes" if path.exists() else "No"


def main():
    interview_csv = ROOT / "docs/phase-0/interviews/INTERVIEW_TRACKER.csv"
    pricing_csv = ROOT / "docs/phase-0/pricing/PRICING_RESULTS.csv"
    usability_csv = ROOT / "docs/phase-0/workflow/USABILITY_LOG.csv"
    mvp_signoff = ROOT / "docs/phase-0/decisions/MVP_SCOPE_SIGNOFF.md"
    canonical_model = ROOT / "docs/phase-0/decisions/CANONICAL_MODEL_V0.md"
    adrs_dir = ROOT / "docs/phase-0/decisions/adrs"

    interviews = read_csv(interview_csv)
    pricing = read_csv(pricing_csv)
    usability = read_csv(usability_csv)

    interview_done_count = count_interviews_done(interviews)
    pricing_session_count = count_pricing_sessions(pricing)
    completion_rate = workflow_task_completion_rate(usability)

    adr_count = len(list(adrs_dir.glob("ADR-*.md"))) if adrs_dir.exists() else 0
    signoff_approved = mvp_signoff_is_approved(mvp_signoff)

    checks = [
        ("Interviews completed (>=20)", interview_done_count >= 20, str(interview_done_count)),
        ("Pricing sessions with data (>=5)", pricing_session_count >= 5, str(pricing_session_count)),
        ("Workflow completion rate (>=80%)", completion_rate >= 80.0, f"{completion_rate:.1f}%"),
        ("MVP sign-off approved", signoff_approved, "Yes" if signoff_approved else "No"),
        ("Canonical model exists", canonical_model.exists(), exists(canonical_model)),
        ("ADR count (>=6)", adr_count >= 6, str(adr_count)),
    ]

    print("Phase 0 Gate Readiness")
    print("=" * 24)
    all_ok = True
    for name, ok, value in checks:
        status = "OK" if ok else "PENDING"
        if not ok:
            all_ok = False
        print(f"- {name}: {status} (value: {value})")

    print("-" * 24)
    print(f"Gate Recommendation: {'GO' if all_ok else 'NOT READY'}")


if __name__ == "__main__":
    main()
