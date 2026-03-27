import { Injectable, Logger } from "@nestjs/common";
import { AuthEmailService } from "../auth/auth-email.service";
import { PrismaService } from "../prisma/prisma.service";
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
      return `If you need help, contact TEJ commercial ops at ${contactUrl}.`;
    }
    const contactEmail = String(process.env.PIM_COMMERCIAL_CONTACT_EMAIL ?? "").trim();
    if (contactEmail) {
      return `If you need help, contact TEJ commercial ops at ${contactEmail}.`;
    }
    return "If you need help, contact TEJ commercial ops.";
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
