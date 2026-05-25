# Vexa PIM Release Notes

---

## May 2026

### Week of May 26 — v0.9.1-release

**Faster catalog operations and channel sync**
Search, filter, and list operations on large catalogs are now faster. Vexa now keeps an intelligent background index of your products by status and category so that common catalog views and channel readiness checks complete more quickly as your catalog grows.

**Channel sync no longer creates duplicate jobs**
If a product is already queued for a channel sync run, Vexa now detects this and skips it cleanly instead of queuing a second job. Large catalogs with many products can now run automated sync reliably without generating duplicate submissions.

**Notifications link to the right place after product removal**
Notifications pointing to a product that has since been deleted or removed now redirect you to the product catalog instead of showing an error page. A one-time repair is available for any pre-existing notifications via an operator script.

### Week of May 17 — v0.9.0-pilot

**Approval comment threads on every product**
Reviewers and editors can now leave inline comments on a product's approval thread. Each comment captures who posted it, their role, and when. Comments appear in the approval queue and in the product detail view. Use comments to record review feedback, capture revision notes, or hand a product back to an editor with context.

**Product activity timeline**
Every product detail page now includes an `Activity` tab that shows the history of edits, approvals, comments, and channel publish events for that product. Each entry shows the actor, role, action, and timestamp sourced from the audit trail. Use this to see what happened to a product without digging through the audit log.

**OIDC SSO with self-serve admin configuration**
You can now sign in to Vexa using your own identity provider via OIDC. Workspace admins can configure the identity provider connection themselves under Admin → OIDC SSO: enter your issuer URL, client ID, client secret, callback URL, and optional scopes/claims mapping. Every change requires you to confirm with your password (step-up authentication) so a hijacked admin session cannot silently rewire sign-in. OIDC enforcement (requiring all users to sign in via your IdP) remains a future-release item.

**Honest Meesho status in connector setup**
The Meesho connector tile in `Channels → Connectors` now clearly indicates the connector is in development. Export and direct publish are not yet available, and any attempt to queue a Meesho export is now blocked with a clear message. Sellers using Meesho should continue to use the existing manual Supplier Panel upload until Vexa's Meesho export ships.

**Operations counts disclose the window cap**
The `Operations` dashboard counts for Submission Jobs and the Dead Letter Queue now show `200+` when more than 200 records are in the window, with the helper text disclosing that you are seeing the most recent 200. Click through to the full list to scroll older entries.

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
