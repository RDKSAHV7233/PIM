# Daily Operations (Phase 0)

## Morning (15 minutes)
1. Run `python tools/phase0/ops.py status`
2. Run `python tools/phase0/ops.py followups`
3. Set outreach/interview targets for the day.

## During the Day
1. Update `interviews/CONTACT_PIPELINE.csv` after each outreach action.
2. Fill `interviews/INTERVIEW_TRACKER.csv` immediately after each interview.
3. Fill `pricing/PRICING_RESULTS.csv` after each pricing conversation.
4. Fill `workflow/USABILITY_LOG.csv` after each usability session.

## End of Day (10 minutes)
1. Run `python tools/phase0/summarize_phase0.py`
2. Run `python tools/phase0/check_phase0.py`
3. Save key insights in `outputs/SYNTHESIS_REPORT_TEMPLATE.md` draft section.

## Weekly Review
1. Compare actual vs targets in `tools/phase0/ops.py status`.
2. Update `docs/AUTONOMOUS_STATUS.md`.
3. Confirm next-week numeric targets.
