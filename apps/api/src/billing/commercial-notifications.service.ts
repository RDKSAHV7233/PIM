import { Injectable, Logger } from "@nestjs/common";
import { AuthEmailService } from "../auth/auth-email.service";
import { PrismaService } from "../prisma/prisma.service";
import { type CommercialRequestSummary } from "./commercial-requests.service";
import { type PlanProfileSummary } from "./plan-usage.service";

type CommercialNotificationEvent =
  | "plan_tier_changed"
  | "tenant_access_suspended"
  | "tenant_access_resumed"
  | "tenant_billing_status_set"
  | "tenant_commercial_state_updated";

@Injectable()
export class CommercialNotificationsService {
  private readonly logger = new Logger(CommercialNotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authEmailService: AuthEmailService,
  ) {}

  async notifyTenantAdmins(input: {
    tenantKey: string;
    event: CommercialNotificationEvent;
    profile: PlanProfileSummary;
  }): Promise<{ recipientCount: number }> {
    const workspace = await this.prisma.tenant().workspaceDirectory.findUnique({
      where: {
        tenantKey: input.tenantKey,
      },
      select: {
        workspaceSlug: true,
        displayName: true,
      },
    });

    const recipients = await this.resolveRecipients(input.tenantKey, input.profile.billingContactEmail);
    if (recipients.length === 0) {
      this.logger.warn(`No active tenant admins available for commercial notification tenant=${input.tenantKey}`);
      return { recipientCount: 0 };
    }

    const workspaceSlug = String(workspace?.workspaceSlug ?? input.tenantKey).trim();
    const displayName = String(workspace?.displayName ?? workspaceSlug).trim() || workspaceSlug;
    const subject = this.buildSubject(input.event, displayName);
    const text = this.buildText(input.event, {
      displayName,
      workspaceSlug,
      profile: input.profile,
    });
    const html = this.buildHtml(input.event, {
      displayName,
      workspaceSlug,
      profile: input.profile,
    });

    await Promise.all(
      recipients.map((recipient) =>
        this.authEmailService.send({
          to: recipient,
          subject,
          text,
          html,
          category: "commercial_status_notice",
          metadata: {
            event: input.event,
            tenantKey: input.tenantKey,
            workspaceSlug,
            planTier: input.profile.planTier,
            billingStatus: input.profile.billingStatus,
            accessStatus: input.profile.accessStatus,
            billingContactEmail: input.profile.billingContactEmail,
          },
        }),
      ),
    );

    return { recipientCount: recipients.length };
  }

  async notifyPaymentFailed(input: { tenantKey: string; profile: PlanProfileSummary }): Promise<{ recipientCount: number }> {
    const workspace = await this.prisma.tenant().workspaceDirectory.findUnique({
      where: { tenantKey: input.tenantKey },
      select: { workspaceSlug: true, displayName: true },
    });
    const recipients = await this.resolveRecipients(input.tenantKey, input.profile.billingContactEmail);
    if (recipients.length === 0) {
      return { recipientCount: 0 };
    }
    const workspaceSlug = String(workspace?.workspaceSlug ?? input.tenantKey).trim();
    const displayName = String(workspace?.displayName ?? workspaceSlug).trim() || workspaceSlug;
    const subject = `Payment failed: ${displayName}`;
    const grace = input.profile.graceEndsAt ? new Date(input.profile.graceEndsAt).toDateString() : null;
    const graceLine = grace ? `Access will be suspended if payment is not resolved by ${grace}.` : "Please update your payment method to avoid service interruption.";
    const text = [
      `A payment for your Vexa PIM workspace ${displayName} has failed.`,
      "",
      graceLine,
      "",
      this.resolveCommercialContactLine(),
    ].join("\n");
    const html = [
      `<p>${this.escapeHtml(`A payment for your Vexa PIM workspace ${displayName} has failed.`)}</p>`,
      `<p>${this.escapeHtml(graceLine)}</p>`,
      `<p>${this.escapeHtml(this.resolveCommercialContactLine())}</p>`,
    ].join("");
    await Promise.all(
      recipients.map((recipient) =>
        this.authEmailService.send({
          to: recipient,
          subject,
          text,
          html,
          category: "commercial_status_notice",
          metadata: { event: "payment_failed", tenantKey: input.tenantKey, workspaceSlug },
        }),
      ),
    );
    return { recipientCount: recipients.length };
  }

  async notifyTrialEnding(input: {
    tenantKey: string;
    profile: PlanProfileSummary;
    daysRemaining: number;
  }): Promise<{ recipientCount: number }> {
    const workspace = await this.prisma.tenant().workspaceDirectory.findUnique({
      where: { tenantKey: input.tenantKey },
      select: { workspaceSlug: true, displayName: true },
    });
    const recipients = await this.resolveRecipients(input.tenantKey, input.profile.billingContactEmail);
    if (recipients.length === 0) {
      return { recipientCount: 0 };
    }
    const workspaceSlug = String(workspace?.workspaceSlug ?? input.tenantKey).trim();
    const displayName = String(workspace?.displayName ?? workspaceSlug).trim() || workspaceSlug;
    const dayWord = input.daysRemaining === 1 ? "day" : "days";
    const subject = `Your Vexa PIM trial ends in ${input.daysRemaining} ${dayWord}: ${displayName}`;
    const text = [
      `Your Vexa PIM trial for ${displayName} ends in ${input.daysRemaining} ${dayWord}.`,
      "",
      "To continue using Vexa PIM after the trial, please upgrade your plan.",
      "",
      this.resolveCommercialContactLine(),
    ].join("\n");
    const html = [
      `<p>${this.escapeHtml(`Your Vexa PIM trial for ${displayName} ends in ${input.daysRemaining} ${dayWord}.`)}</p>`,
      `<p>To continue using Vexa PIM after the trial, please upgrade your plan.</p>`,
      `<p>${this.escapeHtml(this.resolveCommercialContactLine())}</p>`,
    ].join("");
    await Promise.all(
      recipients.map((recipient) =>
        this.authEmailService.send({
          to: recipient,
          subject,
          text,
          html,
          category: "commercial_status_notice",
          metadata: {
            event: `trial_ending_${input.daysRemaining}d`,
            tenantKey: input.tenantKey,
            workspaceSlug,
            daysRemaining: String(input.daysRemaining),
          },
        }),
      ),
    );
    return { recipientCount: recipients.length };
  }

  async notifyCommercialOpsUpgradeRequest(input: {
    tenantKey: string;
    request: CommercialRequestSummary;
  }): Promise<{ recipientCount: number }> {
    const contactEmail = String(process.env.PIM_COMMERCIAL_CONTACT_EMAIL ?? "").trim().toLowerCase();
    if (!contactEmail) {
      return { recipientCount: 0 };
    }

    const workspaceSlug = String(input.request.workspaceSlug ?? input.tenantKey).trim() || input.tenantKey;
    const displayName = String(input.request.displayName ?? workspaceSlug).trim() || workspaceSlug;
    const subject = `Upgrade request: ${displayName}`;
    const textLines = [
      `${input.request.requestedBy} requested a commercial plan review.`,
      "",
      `Workspace: ${displayName}`,
      `Workspace slug: ${workspaceSlug}`,
      `Tenant key: ${input.tenantKey}`,
      `Current plan tier: ${input.request.currentPlanTier}`,
      `Current billing status: ${input.request.currentBillingStatus}`,
      `Current access status: ${input.request.currentAccessStatus}`,
      `Requester role: ${input.request.requesterRole}`,
      `Source: ${input.request.source}`,
    ];
    if (input.request.notes) {
      textLines.push(`Notes: ${input.request.notes}`);
    }
    textLines.push("");
    textLines.push("Review this request in the Vexa commercial workflow.");

    const html = [
      `<p>${this.escapeHtml(`${input.request.requestedBy} requested a commercial plan review.`)}</p>`,
      "<table>",
      `<tr><td><strong>Workspace</strong></td><td>${this.escapeHtml(displayName)}</td></tr>`,
      `<tr><td><strong>Workspace slug</strong></td><td>${this.escapeHtml(workspaceSlug)}</td></tr>`,
      `<tr><td><strong>Tenant key</strong></td><td>${this.escapeHtml(input.tenantKey)}</td></tr>`,
      `<tr><td><strong>Current plan tier</strong></td><td>${this.escapeHtml(input.request.currentPlanTier)}</td></tr>`,
      `<tr><td><strong>Current billing status</strong></td><td>${this.escapeHtml(input.request.currentBillingStatus)}</td></tr>`,
      `<tr><td><strong>Current access status</strong></td><td>${this.escapeHtml(input.request.currentAccessStatus)}</td></tr>`,
      `<tr><td><strong>Requester</strong></td><td>${this.escapeHtml(input.request.requestedBy)}</td></tr>`,
      `<tr><td><strong>Requester role</strong></td><td>${this.escapeHtml(input.request.requesterRole)}</td></tr>`,
      `<tr><td><strong>Source</strong></td><td>${this.escapeHtml(input.request.source)}</td></tr>`,
      input.request.notes
        ? `<tr><td><strong>Notes</strong></td><td>${this.escapeHtml(input.request.notes)}</td></tr>`
        : "",
      "</table>",
      "<p>Review this request in the Vexa commercial workflow.</p>",
    ].join("");

    await this.authEmailService.send({
      to: contactEmail,
      subject,
      text: textLines.join("\n"),
      html,
      category: "commercial_upgrade_request",
      metadata: {
        event: "commercial_upgrade_request_created",
        tenantKey: input.tenantKey,
        requestId: input.request.id,
        workspaceSlug,
        requestedBy: input.request.requestedBy,
        currentPlanTier: input.request.currentPlanTier,
        currentBillingStatus: input.request.currentBillingStatus,
        currentAccessStatus: input.request.currentAccessStatus,
      },
    });
    return { recipientCount: 1 };
  }

  async notifyTenantAdminsUpgradeRequestStatus(input: {
    tenantKey: string;
    request: CommercialRequestSummary;
  }): Promise<{ recipientCount: number }> {
    const workspace = await this.prisma.tenant().workspaceDirectory.findUnique({
      where: {
        tenantKey: input.tenantKey,
      },
      select: {
        workspaceSlug: true,
        displayName: true,
      },
    });
    const profile = await this.prisma.tenant().tenantPlanProfile.findUnique({
      where: {
        tenantKey: input.tenantKey,
      },
      select: {
        billingContactEmail: true,
      },
    });

    const recipients = await this.resolveRecipients(input.tenantKey, profile?.billingContactEmail ?? null);
    if (recipients.length === 0) {
      return { recipientCount: 0 };
    }

    const workspaceSlug = String(workspace?.workspaceSlug ?? input.tenantKey).trim() || input.tenantKey;
    const displayName = String(workspace?.displayName ?? workspaceSlug).trim() || workspaceSlug;
    const subject = this.buildUpgradeRequestStatusSubject(input.request.status, displayName);
    const statusLabel = this.presentUpgradeRequestStatus(input.request.status);
    const textLines = [
      `Your Vexa PIM upgrade request is now ${statusLabel}.`,
      "",
      `Workspace: ${displayName}`,
      `Workspace slug: ${workspaceSlug}`,
      `Current plan tier: ${input.request.currentPlanTier}`,
      `Current billing status: ${input.request.currentBillingStatus}`,
      `Current access status: ${input.request.currentAccessStatus}`,
      `Request status: ${statusLabel}`,
    ];
    if (input.request.notes) {
      textLines.push(`Request notes: ${input.request.notes}`);
    }
    if (input.request.resolvedAt) {
      textLines.push(`Updated at: ${input.request.resolvedAt}`);
    }
    textLines.push("");
    textLines.push(this.resolveCommercialContactLine());

    const htmlRows = [
      ["Workspace", this.escapeHtml(displayName)],
      ["Workspace slug", this.escapeHtml(workspaceSlug)],
      ["Current plan tier", this.escapeHtml(input.request.currentPlanTier)],
      ["Current billing status", this.escapeHtml(input.request.currentBillingStatus)],
      ["Current access status", this.escapeHtml(input.request.currentAccessStatus)],
      ["Request status", this.escapeHtml(statusLabel)],
    ];
    if (input.request.notes) {
      htmlRows.push(["Request notes", this.escapeHtml(input.request.notes)]);
    }
    if (input.request.resolvedAt) {
      htmlRows.push(["Updated at", this.escapeHtml(input.request.resolvedAt)]);
    }
    const tableRows = htmlRows
      .map(([label, value]) => `<tr><td><strong>${label}</strong></td><td>${value}</td></tr>`)
      .join("");

    await Promise.all(
      recipients.map((recipient) =>
        this.authEmailService.send({
          to: recipient,
          subject,
          text: textLines.join("\n"),
          html: `<p>${this.escapeHtml(`Your Vexa PIM upgrade request is now ${statusLabel}.`)}</p><table>${tableRows}</table><p>${this.escapeHtml(this.resolveCommercialContactLine())}</p>`,
          category: "commercial_status_notice",
          metadata: {
            event: "commercial_upgrade_request_status_updated",
            tenantKey: input.tenantKey,
            requestId: input.request.id,
            requestStatus: input.request.status,
            workspaceSlug,
          },
        }),
      ),
    );

    return { recipientCount: recipients.length };
  }

  private async resolveRecipients(tenantKey: string, billingContactEmail: string | null): Promise<string[]> {
    const explicitContact = String(billingContactEmail ?? "").trim().toLowerCase();
    if (explicitContact) {
      return [explicitContact];
    }

    const admins = await this.prisma.tenant().authIdentity.findMany({
      where: {
        tenantKey,
        role: "admin",
        isActive: true,
      },
      orderBy: {
        userId: "asc",
      },
      take: 20, // defensive cap — admin recipients; no tenant has more than a handful of admins
      select: {
        userId: true,
      },
    });

    return admins
      .map((admin) => String(admin.userId ?? "").trim().toLowerCase())
      .filter((value, index, values) => value.length > 0 && values.indexOf(value) === index);
  }

  private buildSubject(event: CommercialNotificationEvent, displayName: string): string {
    if (event === "tenant_access_suspended") {
      return `Workspace access suspended: ${displayName}`;
    }
    if (event === "tenant_access_resumed") {
      return `Workspace access restored: ${displayName}`;
    }
    if (event === "plan_tier_changed") {
      return `Plan updated: ${displayName}`;
    }
    return `Commercial status updated: ${displayName}`;
  }

  private buildText(
    event: CommercialNotificationEvent,
    input: {
      displayName: string;
      workspaceSlug: string;
      profile: PlanProfileSummary;
    },
  ): string {
    const lines = [
      this.buildIntro(event, input.displayName),
      "",
      `Workspace: ${input.displayName}`,
      `Workspace slug: ${input.workspaceSlug}`,
      `Plan tier: ${input.profile.planTier}`,
      `Billing status: ${input.profile.billingStatus}`,
      `Access status: ${input.profile.accessStatus}`,
    ];
    if (input.profile.graceEndsAt) {
      lines.push(`Grace ends at: ${input.profile.graceEndsAt}`);
    }
    if (input.profile.paidThroughAt) {
      lines.push(`Paid through: ${input.profile.paidThroughAt}`);
    }
    if (input.profile.trialEndsAt) {
      lines.push(`Trial ends at: ${input.profile.trialEndsAt}`);
    }
    if (input.profile.suspendedAt) {
      lines.push(`Suspended at: ${input.profile.suspendedAt}`);
    }
    if (input.profile.suspensionReason) {
      lines.push(`Reason: ${input.profile.suspensionReason}`);
    }
    if (input.profile.billingContactEmail) {
      lines.push(`Billing contact: ${input.profile.billingContactEmail}`);
    }
    lines.push("");
    lines.push(this.resolveCommercialContactLine());
    return lines.join("\n");
  }

  private buildHtml(
    event: CommercialNotificationEvent,
    input: {
      displayName: string;
      workspaceSlug: string;
      profile: PlanProfileSummary;
    },
  ): string {
    const rows = [
      ["Workspace", this.escapeHtml(input.displayName)],
      ["Workspace slug", this.escapeHtml(input.workspaceSlug)],
      ["Plan tier", this.escapeHtml(input.profile.planTier)],
      ["Billing status", this.escapeHtml(input.profile.billingStatus)],
      ["Access status", this.escapeHtml(input.profile.accessStatus)],
    ];
    if (input.profile.graceEndsAt) {
      rows.push(["Grace ends at", this.escapeHtml(input.profile.graceEndsAt)]);
    }
    if (input.profile.paidThroughAt) {
      rows.push(["Paid through", this.escapeHtml(input.profile.paidThroughAt)]);
    }
    if (input.profile.trialEndsAt) {
      rows.push(["Trial ends at", this.escapeHtml(input.profile.trialEndsAt)]);
    }
    if (input.profile.suspendedAt) {
      rows.push(["Suspended at", this.escapeHtml(input.profile.suspendedAt)]);
    }
    if (input.profile.suspensionReason) {
      rows.push(["Reason", this.escapeHtml(input.profile.suspensionReason)]);
    }
    if (input.profile.billingContactEmail) {
      rows.push(["Billing contact", this.escapeHtml(input.profile.billingContactEmail)]);
    }
    const tableRows = rows
      .map(([label, value]) => `<tr><td><strong>${label}</strong></td><td>${value}</td></tr>`)
      .join("");

    return [
      `<p>${this.escapeHtml(this.buildIntro(event, input.displayName))}</p>`,
      `<table>${tableRows}</table>`,
      `<p>${this.escapeHtml(this.resolveCommercialContactLine())}</p>`,
    ].join("");
  }

  private buildIntro(event: CommercialNotificationEvent, displayName: string): string {
    if (event === "tenant_access_suspended") {
      return `${displayName} is now suspended.`;
    }
    if (event === "tenant_access_resumed") {
      return `${displayName} has been restored.`;
    }
    if (event === "plan_tier_changed") {
      return `${displayName} has a new commercial plan configuration.`;
    }
    return `${displayName} has an updated commercial status.`;
  }

  private resolveCommercialContactLine(): string {
    const contactUrl = String(process.env.PIM_COMMERCIAL_CONTACT_URL ?? "").trim();
    if (contactUrl) {
      return `If you need help, contact Vexa commercial ops at ${contactUrl}.`;
    }
    const contactEmail = String(process.env.PIM_COMMERCIAL_CONTACT_EMAIL ?? "").trim();
    if (contactEmail) {
      return `If you need help, contact Vexa commercial ops at ${contactEmail}.`;
    }
    return "If you need help, contact Vexa commercial ops.";
  }

  private buildUpgradeRequestStatusSubject(status: string, displayName: string): string {
    if (status === "acknowledged") {
      return `Upgrade request acknowledged: ${displayName}`;
    }
    if (status === "resolved") {
      return `Upgrade request resolved: ${displayName}`;
    }
    if (status === "cancelled") {
      return `Upgrade request closed: ${displayName}`;
    }
    return `Upgrade request updated: ${displayName}`;
  }

  private presentUpgradeRequestStatus(status: string): string {
    if (status === "acknowledged") {
      return "acknowledged";
    }
    if (status === "resolved") {
      return "resolved";
    }
    if (status === "cancelled") {
      return "closed";
    }
    return "open";
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
}
