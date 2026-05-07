# Vexa PIM Release Notes

---

## May 2026

### Week of May 7

**Large Import Mode MVP**
Vexa now supports single-file CSV imports from `10,001` up to `30,000` rows through `Large file mode`. These uploads are staged first, validated server-side, and then processed in safe internal `1,000`-row background batches behind one visible parent import run.

**One progress view for large imports**
Large CSV imports now surface one parent progress experience in `Operations -> Imports` instead of forcing operators to manage child processing batches directly. Repair rows and row-level outcomes stay unified at the run level.

**Combined error reporting**
When a large import run fails rows, operators can download one combined error report across the run instead of collecting separate reports from each internal batch.

**Safer import boundary handling**
CSV uploads above `30,000` rows are explicitly blocked in the MVP, and `Large file mode` remains CSV-only. JSON imports continue to use the existing standard import path.

## March 2026

### Week of March 19

**Safer sign-in and admin recovery**
Sign-in now uses stronger per-user password protection. If someone loses access or gets locked out, your workspace admin can help directly from Settings instead of waiting on an email flow that is not yet live.

**Connector transparency**
Amazon India and Meesho now show more accurate connector status labels. Amazon India is marked as limited until full credential validation is live, and Meesho clearly indicates that it works through Excel export rather than direct publish.

**Privacy and compliance**
Terms of service, privacy policy, data retention policy, and data processing agreement documents are now available. Account export requests are handled through workspace admins so the process is explicit and trackable.

**Workspace user management**
Admins can now manage users directly from Settings -> Users & Roles. Roles, lock and unlock actions, password resets through admins, and deactivation are all available inside the product.

**Performance improvements**
Dashboard and billing pages respond faster on repeat visits. We reduced repeated background calculations so common monitoring pages feel more immediate during day-to-day use.

### Week of March 17

**Product detail workflow improvements**
The product detail experience is now organized around clearer tabbed sections. This makes it easier to move between content, variants, channel setup, quality, and activity without losing context.

**Imports and operational guidance**
Import and operational workflows now surface clearer guidance and status messaging. This reduces guesswork when preparing data for channel submission and follow-up actions.
