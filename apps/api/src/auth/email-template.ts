export type EmailSignatureType = "security" | "commercial" | "support" | "default";

export interface EmailTemplateInput {
  logoUrl?: string;
  bannerUrl?: string;
  title: string;
  preheader?: string;
  bodyHtml: string;
  bodyText: string;
  ctaLabel?: string;
  ctaUrl?: string;
  workspaceName?: string;
  workspaceSlug?: string;
  footerReason: string;
  signatureType: EmailSignatureType;
  commercialContactUrl?: string;
  commercialContactEmail?: string;
  supportUrl?: string;
  supportEmail?: string;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function formatDateUtc(date: Date): string {
  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];
  const month = months[date.getUTCMonth()];
  const day = date.getUTCDate();
  const year = date.getUTCFullYear();
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const ampm = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;
  const displayMinutes = String(minutes).padStart(2, "0");
  return `${month} ${day}, ${year} at ${displayHour}:${displayMinutes} ${ampm} UTC`;
}

function resolveSignatureText(input: EmailTemplateInput): string {
  const contactLine = resolveContactLine(input);
  switch (input.signatureType) {
    case "security":
      return "Vexa PIM Security\nThis message relates to a security action for your workspace.";
    case "commercial":
      return `Vexa PIM Commercial Team\nBilling and workspace access support${contactLine ? `\nContact: ${contactLine}` : ""}`;
    case "support":
      return `Vexa PIM Support\nWorkspace and account support${contactLine ? `\nSupport: ${contactLine}` : ""}`;
    default:
      return `Vexa PIM Team\nProduct Information Management for ecommerce and marketplace operations${contactLine ? `\nSupport: ${contactLine}` : ""}`;
  }
}

function resolveSignatureHtml(input: EmailTemplateInput): string {
  const contactLine = resolveContactLine(input);
  const contactHtml = contactLine ? `<br>${escapeHtml(contactLine)}` : "";
  switch (input.signatureType) {
    case "security":
      return `<strong>Vexa PIM Security</strong><br>This message relates to a security action for your workspace.`;
    case "commercial": {
      const contactLinkHtml = resolveContactLinkHtml(input);
      return `<strong>Vexa PIM Commercial Team</strong><br>Billing and workspace access support${contactLinkHtml ? `<br>Contact: ${contactLinkHtml}` : contactHtml ? `<br>Contact: ${contactHtml}` : ""}`;
    }
    case "support": {
      const supportLinkHtml = resolveSupportLinkHtml(input);
      return `<strong>Vexa PIM Support</strong><br>Workspace and account support${supportLinkHtml ? `<br>Support: ${supportLinkHtml}` : ""}`;
    }
    default: {
      const supportLinkHtml = resolveSupportLinkHtml(input);
      return `<strong>Vexa PIM Team</strong><br>Product Information Management for ecommerce and marketplace operations${supportLinkHtml ? `<br>Support: ${supportLinkHtml}` : ""}`;
    }
  }
}

function resolveContactLine(input: EmailTemplateInput): string {
  if (input.signatureType === "commercial") {
    if (input.commercialContactUrl) return input.commercialContactUrl;
    if (input.commercialContactEmail) return input.commercialContactEmail;
  }
  if (input.supportUrl) return input.supportUrl;
  if (input.supportEmail) return input.supportEmail;
  return "";
}

function resolveContactLinkHtml(input: EmailTemplateInput): string {
  if (input.commercialContactUrl) {
    return `<a href="${escapeHtml(input.commercialContactUrl)}" style="color:#2563eb;">${escapeHtml(input.commercialContactUrl)}</a>`;
  }
  if (input.commercialContactEmail) {
    return `<a href="mailto:${escapeHtml(input.commercialContactEmail)}" style="color:#2563eb;">${escapeHtml(input.commercialContactEmail)}</a>`;
  }
  return "";
}

function resolveSupportLinkHtml(input: EmailTemplateInput): string {
  if (input.supportUrl) {
    return `<a href="${escapeHtml(input.supportUrl)}" style="color:#2563eb;">${escapeHtml(input.supportUrl)}</a>`;
  }
  if (input.supportEmail) {
    return `<a href="mailto:${escapeHtml(input.supportEmail)}" style="color:#2563eb;">${escapeHtml(input.supportEmail)}</a>`;
  }
  return "";
}

export function renderEmailHtml(input: EmailTemplateInput): string {
  const preheaderBlock = input.preheader
    ? `<span style="display:none;font-size:1px;color:#ffffff;max-height:0;overflow:hidden;">${escapeHtml(input.preheader)}</span>`
    : "";

  const logoBlock = input.logoUrl
    ? `<img src="${escapeHtml(input.logoUrl)}" alt="Vexa PIM" width="140" height="auto" style="display:block;max-width:140px;height:auto;border:0;" />`
    : `<span style="font-size:20px;font-weight:bold;color:#1e293b;">Vexa PIM</span>`;

  const bannerBlock = input.bannerUrl
    ? `<tr><td style="padding:0;"><img src="${escapeHtml(input.bannerUrl)}" alt="" width="600" style="display:block;max-width:100%;height:auto;border:0;" /></td></tr>`
    : "";

  const ctaBlock = input.ctaLabel && input.ctaUrl
    ? `<tr><td style="padding:24px 32px 0 32px;"><table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr><td style="background-color:#2563eb;border-radius:6px;"><a href="${escapeHtml(input.ctaUrl)}" target="_blank" style="display:inline-block;padding:12px 24px;color:#ffffff;font-size:16px;font-weight:600;text-decoration:none;">${escapeHtml(input.ctaLabel)}</a></td></tr></table></td></tr>`
    : "";

  const signatureHtml = resolveSignatureHtml(input);

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>${escapeHtml(input.title)}</title></head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;">
${preheaderBlock}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f1f5f9;">
<tr><td style="padding:24px 16px;">
<table role="presentation" width="600" cellspacing="0" cellpadding="0" border="0" style="max-width:600px;margin:0 auto;background-color:#ffffff;border-radius:8px;overflow:hidden;">
<tr><td style="padding:24px 32px 16px 32px;">${logoBlock}</td></tr>
${bannerBlock}
<tr><td style="padding:16px 32px 0 32px;"><h1 style="margin:0;font-size:22px;font-weight:700;color:#1e293b;">${escapeHtml(input.title)}</h1></td></tr>
<tr><td style="padding:16px 32px 0 32px;font-size:15px;line-height:1.6;color:#334155;">${input.bodyHtml}</td></tr>
${ctaBlock}
<tr><td style="padding:32px 32px 0 32px;border-top:1px solid #e2e8f0;margin-top:24px;"><p style="margin:0 0 8px 0;font-size:13px;line-height:1.5;color:#64748b;">${signatureHtml}</p></td></tr>
<tr><td style="padding:16px 32px 24px 32px;"><p style="margin:0;font-size:12px;line-height:1.4;color:#94a3b8;">${escapeHtml(input.footerReason)}</p></td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export function renderEmailText(input: EmailTemplateInput): string {
  const lines: string[] = [];
  lines.push(input.title);
  lines.push("=".repeat(Math.min(60, input.title.length)));
  lines.push("");
  lines.push(input.bodyText);

  if (input.ctaLabel && input.ctaUrl) {
    lines.push("");
    lines.push(`${input.ctaLabel}: ${input.ctaUrl}`);
  }

  lines.push("");
  lines.push("---");
  lines.push(resolveSignatureText(input));
  lines.push("");
  lines.push(input.footerReason);

  return lines.join("\n");
}

export function resolveEmailBrandConfig(): {
  logoUrl: string;
  bannerUrl: string;
  supportUrl: string;
  supportEmail: string;
  commercialContactUrl: string;
  commercialContactEmail: string;
  onboardingFrom: string;
  notificationsFrom: string;
  adminEmail: string;
  teamEmail: string;
} {
  return {
    logoUrl: String(process.env.PIM_EMAIL_LOGO_URL ?? "").trim(),
    bannerUrl: String(process.env.PIM_EMAIL_BANNER_URL ?? "").trim(),
    supportUrl: String(process.env.PIM_EMAIL_SUPPORT_URL ?? "").trim(),
    supportEmail: String(process.env.PIM_EMAIL_SUPPORT_EMAIL ?? "").trim(),
    commercialContactUrl: String(process.env.PIM_COMMERCIAL_CONTACT_URL ?? "").trim(),
    commercialContactEmail: String(process.env.PIM_COMMERCIAL_CONTACT_EMAIL ?? "").trim(),
    onboardingFrom: String(process.env.PIM_EMAIL_ONBOARDING_FROM ?? "").trim(),
    notificationsFrom: String(process.env.PIM_EMAIL_NOTIFICATIONS_FROM ?? "").trim(),
    adminEmail: String(process.env.PIM_EMAIL_ADMIN_EMAIL ?? "").trim(),
    teamEmail: String(process.env.PIM_EMAIL_TEAM_EMAIL ?? "").trim(),
  };
}

export function hasCommercialContactPath(): boolean {
  const config = resolveEmailBrandConfig();
  return Boolean(config.commercialContactUrl || config.commercialContactEmail);
}

export function resolveCommercialContactText(): string {
  const config = resolveEmailBrandConfig();
  if (config.commercialContactUrl) {
    return `If you need help, contact Vexa commercial ops at ${config.commercialContactUrl}.`;
  }
  if (config.commercialContactEmail) {
    return `If you need help, contact Vexa commercial ops at ${config.commercialContactEmail}.`;
  }
  const appEnv = String(process.env.APP_ENV ?? "development").trim().toLowerCase();
  if (appEnv === "production" || appEnv === "staging") {
    return "If you need help, contact Vexa commercial ops.";
  }
  return "If you need help, contact Vexa commercial ops. (No commercial contact path configured — set PIM_COMMERCIAL_CONTACT_URL or PIM_COMMERCIAL_CONTACT_EMAIL.)";
}
