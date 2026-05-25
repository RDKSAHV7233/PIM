---
title: Product Workflow Explainer
audience: sellers
status: active
last_updated: 2026-05-25
owner: Product
---

Use this guide if you want to understand how products move through Vexa PIM from first import to live on a marketplace.

## 1. The Four Statuses

Every product in Vexa PIM has a status that controls what can be done with it.

| Status | Meaning | Who sets it |
|--------|---------|-------------|
| **Draft** | Newly imported or created; not yet reviewed | Set automatically on import |
| **In Review** | Submitted for approval by an editor | Set by any editor or above |
| **Approved** | Reviewed and cleared for publishing | Set by a reviewer, publisher, or admin |
| **Published** | Submitted to at least one marketplace channel | Set by a publisher or admin after channel push |

A product can only be published after it has been approved. Approval cannot be skipped.

## 2. Workflow Diagram

```
  IMPORT / MANUAL CREATE
         │
         ▼
      [DRAFT] ◄─────────────────────────────────────────┐
         │                                               │
         │  Editor submits for review                    │
         ▼                                               │
    [IN REVIEW] ─── Reviewer rejects ──► [DRAFT] + note │
         │                                               │
         │  Reviewer / Publisher / Admin approves        │
         ▼                                               │
    [APPROVED] ◄────────────── Admin can reset ──────────┤
         │                                               │
         │  Publisher / Admin publishes to channel       │
         ▼                                               │
    [PUBLISHED] ─── Admin reverts to approved ──────────►┘
```

## 3. Moving a Product Through Each Stage

### Draft → In Review

Any user with the **Editor** role or above can submit a product for review.

1. Open the product in **Catalog**.
2. Fill in all required fields (fields with red borders are missing or invalid).
3. Click **Submit for Review**.
4. The product status changes to **In Review**.

You can still edit a product while it is in Draft. Once it is In Review, editing is restricted to users with Reviewer role or above.

### In Review → Approved or Rejected

A **Reviewer**, **Publisher**, or **Admin** reviews the product.

To **approve**:
1. Open the product.
2. Click **Approve**.
3. Optionally add an approval note.
4. The product status changes to **Approved**.

To **reject**:
1. Open the product.
2. Click **Reject**.
3. Enter a rejection reason (required — this is shown to the editor).
4. The product returns to **Draft** status with your note visible.

The editor who submitted the product receives an in-app notification when it is approved or rejected.

### Approved → Published

A **Publisher** or **Admin** can push approved products to a connected marketplace channel.

1. From **Catalog**, select one or more approved products.
2. Click **Publish to Channel**.
3. Choose the channel (Amazon India, Flipkart, etc.).
4. Click **Confirm**.
5. The product status changes to **Published**.

Submission progress for each channel is tracked under **Channels → Submissions**. A product can be published to multiple channels — its status reflects the most recent channel action.

### What "Rejected" Means

Rejected means the reviewer found something wrong. The product goes back to **Draft**. The rejection reason is visible on the product detail page and in the editor's notification.

What to do:
1. Open the product.
2. Read the rejection reason at the top of the page.
3. Fix the identified fields.
4. Click **Submit for Review** again.

## 4. Who Can Do What

| Action | Viewer | Editor | Reviewer | Publisher | Admin |
|--------|--------|--------|----------|-----------|-------|
| View products | Yes | Yes | Yes | Yes | Yes |
| Edit draft products | No | Yes | Yes | Yes | Yes |
| Submit for review | No | Yes | Yes | Yes | Yes |
| Approve / reject | No | No | Yes | Yes | Yes |
| Publish to channel | No | No | No | Yes | Yes |
| Reset approved → draft | No | No | No | No | Yes |

For the full permission matrix across all features, see [RBAC Permissions Matrix](../security/rbac-permissions-matrix.md).

## 5. Bulk Operations

All workflow transitions support bulk selection:
- Select multiple products in Catalog using the checkboxes.
- Use the **Actions** dropdown to apply the transition to all selected products at once.
- Bulk approve, bulk reject, and bulk publish all follow the same rules as single-product transitions.

## 6. Frequently Asked Questions

**Can I edit a product after it is approved?**
Yes, but editing resets the status to Draft and requires re-approval before publishing.

**Can I unpublish a product?**
You can set it back to Approved. The marketplace retains the listing until you remove it through the marketplace's own interface. Vexa does not currently support remote de-listing.

**What if I approved the wrong product?**
An Admin can reset an approved product back to Draft. Contact your workspace admin.

**How long does marketplace submission take?**
Amazon submissions can take minutes to several hours depending on Amazon's processing queue. Flipkart is typically faster. The Submissions page shows real-time status.
