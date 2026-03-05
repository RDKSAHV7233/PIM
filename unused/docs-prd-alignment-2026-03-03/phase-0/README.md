# Phase 0 Workspace

Use this folder to execute and close Phase 0.

## Structure
- `EXECUTION_PLAN.md`: week-by-week plan
- `interviews/`: interview script, notes template, tracker CSV
- `pricing/`: pricing script and results CSV
- `workflow/`: usability test script and log CSV
- `decisions/`: MVP sign-off, canonical model, ADRs
- `outputs/`: synthesis and gate-review templates

## How to run Phase 0
1. Fill `interviews/INTERVIEW_TRACKER.csv` as interviews complete.
2. Fill `pricing/PRICING_RESULTS.csv` from pricing calls.
3. Fill `workflow/USABILITY_LOG.csv` from workflow sessions.
4. Complete decision docs and gate review.
5. Run `python tools/phase0/check_phase0.py` for readiness summary.
6. Run `python tools/phase0/summarize_phase0.py` to generate live weekly synthesis.
7. Run `python tools/phase0/ops.py status` for operator dashboard.
8. Run `python tools/phase0/ops.py followups` for due outreach actions.
