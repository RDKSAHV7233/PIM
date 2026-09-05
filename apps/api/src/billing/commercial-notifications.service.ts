import { Injectable, Logger } from "@nestjs/common";
import { AuthEmailService } from "../auth/auth-email.service";
import {
  escapeHtml,
  hasCommercialContactPath,
  renderEmailHtml,
  renderEmailText,
  resolveCommercialContactText,
  resolveEmailBrandConfig,
} from "../auth/email-template";
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
    if (!this.assertCommercialContactPath("notifyTenantAdmins")) {
      return { recipientCount: 0 };
    }

    const tenantDb = this.prisma.tenant(input.tenantKey);
    const workspace = await tenantDb.workspaceDirectory.findUnique({
      where: { tenantKey: input.tenantKey },
      select: { workspaceSlug: true, displayName: true },
    });

    const recipients = await this.resolveRecipients(tenantDb, input.tenantKey, input.profile.billingContactEmail);
    if (recipients.length === 0) {
      this.logger.warn(`No active tenant admins available for commercial notification tenant=${input.tenantKey}`);
      return { recipientCount: 0 };
    }

    const workspaceSlug = String(workspace?.workspaceSlug ?? input.tenantKey).trim();
    const displayName = String(workspace?.displayName ?? workspaceSlug).trim() || workspaceSlug;
    const subject = this.buildSubject(input.event, displayName);
    const intro = this.buildIntro(input.event, displayName);
    const detailLines = this.buildProfileDetailLines(input.profile, workspaceSlug, displayName);
    const brand = resolveEmailBrandConfig();

    const bodyHtml = `<p>${escapeHtml(intro)}</p>${this.buildDetailTableHtml(detailLines)}`;
    const bodyText = [intro, "", ...detailLines.map(([k, v]) => `${k}: ${v}`), "", resolveCommercialContactText()].join("\n");

    const templateInput = {
      logoUrl: brand.logoUrl,
      bannerUrl: brand.bannerUrl,
      title: subject,
      bodyHtml,
      bodyText,
      workspaceName: displayName,
      workspaceSlug,
      footerReason: "You received this email because you are listed as an admin or billing contact for this Vexa PIM workspace.",
      signatureType: "commercial" as const,
      commercialContactUrl: brand.commercialContactUrl,
      commercialContactEmail: brand.commercialContactEmail,
      supportUrl: brand.supportUrl,
      supportEmail: brand.supportEmail,
    };

    await Promise.all(
      recipients.map((recipient) =>
        this.authEmailService.send({
          to: recipient,
          subject,
          from: brand.notificationsFrom || undefined,
          text: renderEmailText(templateInput),
          html: renderEmailHtml(templateInput),
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
    if (!this.assertCommercialContactPath("notifyPaymentFailed")) {
      return { recipientCount: 0 };
    }

    const tenantDb = this.prisma.tenant(input.tenantKey);
    const workspace = await tenantDb.workspaceDirectory.findUnique({
      where: { tenantKey: input.tenantKey },
      select: { workspaceSlug: true, displayName: true },
    });
    const recipients = await this.resolveRecipients(tenantDb, input.tenantKey, input.profile.billingContactEmail);
    if (recipients.length === 0) {
      return { recipientCount: 0 };
    }
    const workspaceSlug = String(workspace?.workspaceSlug ?? input.tenantKey).trim();
    const displayName = String(workspace?.displayName ?? workspaceSlug).trim() || workspaceSlug;
    const subject = `Payment failed: ${displayName}`;
    const grace = input.profile.graceEndsAt ? new Date(input.profile.graceEndsAt).toDateString() : null;
    const graceLine = grace ? `Access will be suspended if payment is not resolved by ${grace}.` : "Please update your payment method to avoid service interruption.";
    const brand = resolveEmailBrandConfig();

    const bodyText = [`A payment for your Vexa PIM workspace ${displayName} has failed.`, "", graceLine, "", resolveCommercialContactText()].join("\n");
    const bodyHtml = `<p>${escapeHtml(`A payment for your Vexa PIM workspace ${displayName} has failed.`)}</p><p>${escapeHtml(graceLine)}</p>`;

    const templateInput = {
      logoUrl: brand.logoUrl,
      bannerUrl: brand.bannerUrl,
      title: subject,
      bodyHtml,
      bodyText,
      workspaceName: displayName,
      workspaceSlug,
      footerReason: "You received this email because you are listed as an admin or billing contact for this Vexa PIM workspace.",
      signatureType: "commercial" as const,
      commercialContactUrl: brand.commercialContactUrl,
      commercialContactEmail: brand.commercialContactEmail,
      supportUrl: brand.supportUrl,
      supportEmail: brand.supportEmail,
    };

    await Promise.all(
      recipients.map((recipient) =>
        this.authEmailService.send({
          to: recipient,
          subject,
          text: renderEmailText(templateInput),
          html: renderEmailHtml(templateInput),
          from: brand.notificationsFrom || undefined,
          category: "commercial_status_notice",
          metadata: { event: "payment_failed", tenantKey: input.tenantKey, workspaceSlug },
        }),
      ),
    );
    return { recipientCount: recipients.length };
  }

  async notifyTrialEnding(input: { tenantKey: string; profile: PlanProfileSummary; daysRemaining: number }): Promise<{ recipientCount: number }> {
    if (!this.assertCommercialContactPath("notifyTrialEnding")) {
      return { recipientCount: 0 };
    }

    const tenantDb = this.prisma.tenant(input.tenantKey);
    const workspace = await tenantDb.workspaceDirectory.findUnique({
      where: { tenantKey: input.tenantKey },
      select: { workspaceSlug: true, displayName: true },
    });
    const recipients = await this.resolveRecipients(tenantDb, input.tenantKey, input.profile.billingContactEmail);
    if (recipients.length === 0) {
      return { recipientCount: 0 };
    }
    const workspaceSlug = String(workspace?.workspaceSlug ?? input.tenantKey).trim();
    const displayName = String(workspace?.displayName ?? workspaceSlug).trim() || workspaceSlug;
    const dayWord = input.daysRemaining === 1 ? "day" : "days";
    const subject = `Your Vexa PIM trial ends in ${input.daysRemaining} ${dayWord}: ${displayName}`;
    const brand = resolveEmailBrandConfig();

    const bodyText = [`Your Vexa PIM trial for ${displayName} ends in ${input.daysRemaining} ${dayWord}.`, "", "To continue using Vexa PIM after the trial, please upgrade your plan.", "", resolveCommercialContactText()].join("\n");
    const bodyHtml = `<p>${escapeHtml(`Your Vexa PIM trial for ${displayName} ends in ${input.daysRemaining} ${dayWord}.`)}</p><p>To continue using Vexa PIM after the trial, please upgrade your plan.</p>`;

    const templateInput = {
      logoUrl: brand.logoUrl,
      bannerUrl: brand.bannerUrl,
      title: subject,
      bodyHtml,
      bodyText,
      workspaceName: displayName,
      workspaceSlug,
      footerReason: "You received this email because you are listed as an admin or billing contact for this Vexa PIM workspace.",
      signatureType: "commercial" as const,
      commercialContactUrl: brand.commercialContactUrl,
      commercialContactEmail: brand.commercialContactEmail,
      supportUrl: brand.supportUrl,
      supportEmail: brand.supportEmail,
    };

    await Promise.all(
      recipients.map((recipient) =>
        this.authEmailService.send({
          to: recipient,
          subject,
          text: renderEmailText(templateInput),
          html: renderEmailHtml(templateInput),
          from: brand.notificationsFrom || undefined,
          category: "commercial_status_notice",
          metadata: { event: `trial_ending_${input.daysRemaining}d`, tenantKey: input.tenantKey, workspaceSlug, daysRemaining: String(input.daysRemaining) },
        }),
      ),
    );
    return { recipientCount: recipients.length };
  }

  async notifyCommercialOpsUpgradeRequest(input: { tenantKey: string; request: CommercialRequestSummary }): Promise<{ recipientCount: number }> {
    const contactEmail = String(process.env.PIM_COMMERCIAL_CONTACT_EMAIL ?? "").trim().toLowerCase();
    if (!contactEmail) {
      return { recipientCount: 0 };
    }

    const workspaceSlug = String(input.request.workspaceSlug ?? input.tenantKey).trim() || input.tenantKey;
    const displayName = String(input.request.displayName ?? workspaceSlug).trim() || workspaceSlug;
    const subject = `Upgrade request: ${displayName}`;
    const brand = resolveEmailBrandConfig();

    const detailLines: Array<[string, string]> = [
      ["Workspace", displayName], ["Workspace slug", workspaceSlug], ["Tenant key", input.tenantKey],
      ["Current plan tier", input.request.currentPlanTier], ["Requested plan tier", input.request.requestedPlanTier ?? "not specified"],
      ["Current billing status", input.request.currentBillingStatus], ["Current access status", input.request.currentAccessStatus],
      ["Requester", input.request.requestedBy], ["Requester role", input.request.requesterRole], ["Source", input.request.source],
    ];
    if (input.request.notes) detailLines.push(["Notes", input.request.notes]);

    const bodyText = [`${input.request.requestedBy} requested a commercial plan review.`, "", ...detailLines.map(([k, v]) => `${k}: ${v}`), "", "Review this request in the Vexa commercial workflow."].join("\n");
    const bodyHtml = `<p>${escapeHtml(`${input.request.requestedBy} requested a commercial plan review.`)}</p>${this.buildDetailTableHtml(detailLines)}<p>Review this request in the Vexa commercial workflow.</p>`;

    const templateInput = {
      logoUrl: brand.logoUrl, bannerUrl: brand.bannerUrl, title: subject, bodyHtml, bodyText,
      workspaceName: displayName, workspaceSlug,
      footerReason: "You received this email because you are the Vexa PIM commercial operations contact.",
      signatureType: "commercial" as const,
      commercialContactUrl: brand.commercialContactUrl, commercialContactEmail: brand.commercialContactEmail,
      supportUrl: brand.supportUrl, supportEmail: brand.supportEmail,
    };

    await this.authEmailService.send({
      to: contactEmail, subject,
      from: brand.notificationsFrom || undefined,
      text: renderEmailText(templateInput), html: renderEmailHtml(templateInput),
      category: "commercial_upgrade_request",
      metadata: { event: "commercial_upgrade_request_created", tenantKey: input.tenantKey, requestId: input.request.id, workspaceSlug, requestedBy: input.request.requestedBy, currentPlanTier: input.request.currentPlanTier, currentBillingStatus: input.request.currentBillingStatus, currentAccessStatus: input.request.currentAccessStatus },
    });
    return { recipientCount: 1 };
  }

  /**
   * Deliberately its own method, not a reuse of notifyCommercialOpsUpgradeRequest — that
   * one's subject/body ("Upgrade request: {name}" / "{requestedBy} requested a commercial
   * plan review") narrates a tenant-initiated request. An overage flag is the opposite: a
   * system-detected limit breach from a non-blocking action (nobody asked for anything, and
   * nothing was blocked) — reusing that copy verbatim would misrepresent what happened to
   * the person reading the email.
   */
  async notifyCommercialOpsOverageFlag(input: { tenantKey: string; request: CommercialRequestSummary }): Promise<{ recipientCount: number }> {
    const contactEmail = String(process.env.PIM_COMMERCIAL_CONTACT_EMAIL ?? "").trim().toLowerCase();
    if (!contactEmail) {
      return { recipientCount: 0 };
    }

    const workspaceSlug = String(input.request.workspaceSlug ?? input.tenantKey).trim() || input.tenantKey;
    const displayName = String(input.request.displayName ?? workspaceSlug).trim() || workspaceSlug;
    const snapshot = input.request.usageSnapshot ?? {};
    const resource = String(snapshot.resource ?? "unknown resource");
    const current = snapshot.current ?? "?";
    const limit = snapshot.limit ?? "?";
    const subject = `Plan limit exceeded: ${displayName}`;
    const brand = resolveEmailBrandConfig();

    const detailLines: Array<[string, string]> = [
      ["Workspace", displayName], ["Workspace slug", workspaceSlug], ["Tenant key", input.tenantKey],
      ["Resource over limit", resource], ["Current usage", String(current)], ["Plan limit", String(limit)],
      ["Current plan tier", input.request.currentPlanTier],
      ["Current billing status", input.request.currentBillingStatus], ["Current access status", input.request.currentAccessStatus],
      ["Detected via", input.request.source],
    ];
    if (input.request.notes) detailLines.push(["Notes", input.request.notes]);

    const introText = `${displayName}'s ${resource} usage (${current}) exceeded its plan limit (${limit}). No customer action was blocked — this is a follow-up flag for commercial review, not an incident.`;
    const bodyText = [introText, "", ...detailLines.map(([k, v]) => `${k}: ${v}`), "", "Review this in the Vexa commercial workflow."].join("\n");
    const bodyHtml = `<p>${escapeHtml(introText)}</p>${this.buildDetailTableHtml(detailLines)}<p>Review this in the Vexa commercial workflow.</p>`;

    const templateInput = {
      logoUrl: brand.logoUrl, bannerUrl: brand.bannerUrl, title: subject, bodyHtml, bodyText,
      workspaceName: displayName, workspaceSlug,
      footerReason: "You received this email because you are the Vexa PIM commercial operations contact.",
      signatureType: "commercial" as const,
      commercialContactUrl: brand.commercialContactUrl, commercialContactEmail: brand.commercialContactEmail,
      supportUrl: brand.supportUrl, supportEmail: brand.supportEmail,
    };

    await this.authEmailService.send({
      to: contactEmail, subject,
      text: renderEmailText(templateInput), html: renderEmailHtml(templateInput),
      category: "commercial_overage_flag",
      metadata: { event: "commercial_overage_flag_created", tenantKey: input.tenantKey, requestId: input.request.id, workspaceSlug, resource, current, limit, currentPlanTier: input.request.currentPlanTier, currentBillingStatus: input.request.currentBillingStatus, currentAccessStatus: input.request.currentAccessStatus },
    });
    return { recipientCount: 1 };
  }

  async notifyTenantAdminsUpgradeRequestStatus(input: { tenantKey: string; request: CommercialRequestSummary }): Promise<{ recipientCount: number }> {
    if (!this.assertCommercialContactPath("notifyTenantAdminsUpgradeRequestStatus")) {
      return { recipientCount: 0 };
    }

    const tenantDb = this.prisma.tenant(input.tenantKey);
    const workspace = await tenantDb.workspaceDirectory.findUnique({ where: { tenantKey: input.tenantKey }, select: { workspaceSlug: true, displayName: true } });
    const profile = await tenantDb.tenantPlanProfile.findUnique({ where: { tenantKey: input.tenantKey }, select: { billingContactEmail: true } });
    const recipients = await this.resolveRecipients(tenantDb, input.tenantKey, profile?.billingContactEmail ?? null);
    if (recipients.length === 0) return { recipientCount: 0 };

    const workspaceSlug = String(workspace?.workspaceSlug ?? input.tenantKey).trim() || input.tenantKey;
    const displayName = String(workspace?.displayName ?? workspaceSlug).trim() || workspaceSlug;
    const subject = this.buildUpgradeRequestStatusSubject(input.request.status, displayName);
    const statusLabel = this.presentUpgradeRequestStatus(input.request.status);
    const brand = resolveEmailBrandConfig();

    const detailLines: Array<[string, string]> = [
      ["Workspace", displayName], ["Workspace slug", workspaceSlug],
      ["Current plan tier", input.request.currentPlanTier], ["Current billing status", input.request.currentBillingStatus],
      ["Current access status", input.request.currentAccessStatus], ["Request status", statusLabel],
    ];
    if (input.request.notes) detailLines.push(["Request notes", input.request.notes]);
    if (input.request.resolvedAt) detailLines.push(["Updated at", input.request.resolvedAt]);

    const bodyText = [`Your Vexa PIM upgrade request is now ${statusLabel}.`, "", ...detailLines.map(([k, v]) => `${k}: ${v}`), "", resolveCommercialContactText()].join("\n");
    const bodyHtml = `<p>${escapeHtml(`Your Vexa PIM upgrade request is now ${statusLabel}.`)}</p>${this.buildDetailTableHtml(detailLines)}`;

    const templateInput = {
      logoUrl: brand.logoUrl, bannerUrl: brand.bannerUrl, title: subject, bodyHtml, bodyText,
      workspaceName: displayName, workspaceSlug,
      footerReason: "You received this email because you are listed as an admin or billing contact for this Vexa PIM workspace.",
      signatureType: "commercial" as const,
      commercialContactUrl: brand.commercialContactUrl, commercialContactEmail: brand.commercialContactEmail,
      supportUrl: brand.supportUrl, supportEmail: brand.supportEmail,
    };

    await Promise.all(
      recipients.map((recipient) =>
        this.authEmailService.send({
          to: recipient, subject,
          from: brand.notificationsFrom || undefined,
          text: renderEmailText(templateInput), html: renderEmailHtml(templateInput),
          category: "commercial_status_notice",
          metadata: { event: "commercial_upgrade_request_status_updated", tenantKey: input.tenantKey, requestId: input.request.id, requestStatus: input.request.status, workspaceSlug },
        }),
      ),
    );
    return { recipientCount: recipients.length };
  }

  private assertCommercialContactPath(caller: string): boolean {
    if (hasCommercialContactPath()) return true;
    const appEnv = String(process.env.APP_ENV ?? "development").trim().toLowerCase();
    if (appEnv === "production" || appEnv === "staging") {
      this.logger.error(
        `BLOCKED commercial email send in ${caller}: no commercial contact path configured (PIM_COMMERCIAL_CONTACT_URL or PIM_COMMERCIAL_CONTACT_EMAIL). ` +
          `This should not happen — env validation requires at least one in staging/production.`,
      );
      return false;
    }
    return true;
  }

  private async resolveRecipients(tenantDb: ReturnType<PrismaService["tenant"]>, tenantKey: string, billingContactEmail: string | null): Promise<string[]> {
    const explicitContact = String(billingContactEmail ?? "").trim().toLowerCase();
    if (explicitContact) return [explicitContact];
    const admins = await tenantDb.authIdentity.findMany({ where: { tenantKey, role: "admin", isActive: true }, orderBy: { userId: "asc" }, take: 20, select: { userId: true } });
    return admins.map((admin) => String(admin.userId ?? "").trim().toLowerCase()).filter((value, index, values) => value.length > 0 && values.indexOf(value) === index);
  }

  private buildSubject(event: CommercialNotificationEvent, displayName: string): string {
    if (event === "tenant_access_suspended") return `Workspace access suspended: ${displayName}`;
    if (event === "tenant_access_resumed") return `Workspace access restored: ${displayName}`;
    if (event === "plan_tier_changed") return `Plan updated: ${displayName}`;
    return `Commercial status updated: ${displayName}`;
  }

  private buildIntro(event: CommercialNotificationEvent, displayName: string): string {
    if (event === "tenant_access_suspended") return `${displayName} is now suspended.`;
    if (event === "tenant_access_resumed") return `${displayName} has been restored.`;
    if (event === "plan_tier_changed") return `${displayName} has a new commercial plan configuration.`;
    return `${displayName} has an updated commercial status.`;
  }

  private buildProfileDetailLines(profile: PlanProfileSummary, workspaceSlug: string, displayName: string): Array<[string, string]> {
    const lines: Array<[string, string]> = [["Workspace", displayName], ["Workspace slug", workspaceSlug], ["Plan tier", profile.planTier], ["Billing status", profile.billingStatus], ["Access status", profile.accessStatus]];
    if (profile.graceEndsAt) lines.push(["Grace ends at", profile.graceEndsAt]);
    if (profile.paidThroughAt) lines.push(["Paid through", profile.paidThroughAt]);
    if (profile.trialEndsAt) lines.push(["Trial ends at", profile.trialEndsAt]);
    if (profile.suspendedAt) lines.push(["Suspended at", profile.suspendedAt]);
    if (profile.suspensionReason) lines.push(["Reason", profile.suspensionReason]);
    if (profile.billingContactEmail) lines.push(["Billing contact", profile.billingContactEmail]);
    return lines;
  }

  private buildDetailTableHtml(rows: Array<[string, string]>): string {
    const tableRows = rows.map(([label, value]) => `<tr><td><strong>${escapeHtml(label)}</strong></td><td>${escapeHtml(value)}</td></tr>`).join("");
    return `<table style="border-collapse:collapse;margin:12px 0;">${tableRows}</table>`;
  }

  private buildUpgradeRequestStatusSubject(status: string, displayName: string): string {
    if (status === "acknowledged") return `Upgrade request acknowledged: ${displayName}`;
    if (status === "resolved") return `Upgrade request resolved: ${displayName}`;
    if (status === "cancelled") return `Upgrade request closed: ${displayName}`;
    return `Upgrade request updated: ${displayName}`;
  }

  private presentUpgradeRequestStatus(status: string): string {
    if (status === "acknowledged") return "acknowledged";
    if (status === "resolved") return "resolved";
    if (status === "cancelled") return "closed";
    return "open";
  }
}
