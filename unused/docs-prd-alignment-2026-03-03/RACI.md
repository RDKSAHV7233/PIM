# RACI Matrix

Roles:
- `PO`: Product Owner
- `EL`: Engineering Lead
- `PM`: Program Manager
- `QA`: QA Lead
- `GTM`: Go-to-Market Lead
- `DS`: Data/Analytics Lead

## Phase Ownership

### Phase 0
- Interviews and synthesis: `A=PO`, `R=PO/PM`, `C=GTM`, `I=EL`
- Pricing validation: `A=GTM`, `R=GTM/PO`, `C=PM`, `I=EL`
- MVP scope sign-off: `A=PO`, `R=PO`, `C=EL/GTM`, `I=QA/PM`
- Canonical model and ADRs: `A=EL`, `R=EL`, `C=PO`, `I=PM/QA`

### Phase 1-4 (MVP Build)
- Backlog execution: `A=EL`, `R=EL/QA`, `C=PO`, `I=PM/GTM`
- Release readiness: `A=EL`, `R=QA`, `C=PO`, `I=PM/GTM`
- Pilot onboarding: `A=GTM`, `R=GTM/PO`, `C=EL`, `I=PM`

### Phase 5-8 (Growth Build)
- Feature prioritization: `A=PO`, `R=PO`, `C=GTM/DS/EL`, `I=PM/QA`
- Model/rule quality loops: `A=DS`, `R=DS/EL`, `C=PO`, `I=PM`
- Expansion release decisions: `A=PO`, `R=EL/QA`, `C=GTM`, `I=PM`

## Cross-Cutting
- Security and access control: `A=EL`, `R=EL`, `C=QA`, `I=PO`
- Audit and compliance reporting: `A=QA`, `R=QA/EL`, `C=PO`, `I=PM`
- KPI reporting: `A=PM`, `R=PM/DS`, `C=PO/EL`, `I=GTM`
