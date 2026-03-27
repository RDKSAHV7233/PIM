export interface CommercialContactContext {
  tenantKey: string;
  planTier: string;
  requesterId?: string | null;
  source?: string;
}

export interface CommercialContactTarget {
  href: string;
  label: string;
  helperText: string;
}

function getCommercialContactUrl(): string {
  return String(process.env.PIM_COMMERCIAL_CONTACT_URL ?? "").trim();
}

function getCommercialContactEmail(): string {
  return String(process.env.PIM_COMMERCIAL_CONTACT_EMAIL ?? "").trim();
}

export function resolveCommercialContactTarget(
  context: CommercialContactContext,
): CommercialContactTarget | null {
  const tenantKey = String(context.tenantKey ?? "").trim();
  const planTier = String(context.planTier ?? "").trim().toUpperCase();
  const requesterId = String(context.requesterId ?? "").trim();
  const source = String(context.source ?? "admin_plan").trim();

  const configuredUrl = getCommercialContactUrl();
  if (configuredUrl) {
    const target = new URL(configuredUrl);
    if (tenantKey) {
      target.searchParams.set("tenantKey", tenantKey);
    }
    if (planTier) {
      target.searchParams.set("planTier", planTier);
    }
    if (requesterId) {
      target.searchParams.set("requesterId", requesterId);
    }
    if (source) {
      target.searchParams.set("source", source);
    }
    return {
      href: target.toString(),
      label: "Request upgrade",
      helperText: "TEJ will review your current plan and follow up on commercial changes.",
    };
  }

  const configuredEmail = getCommercialContactEmail();
  if (configuredEmail) {
    const subject = `TEJ PIM upgrade request: ${tenantKey || "workspace"}`;
    const bodyLines = [
      "Please review this TEJ PIM plan request.",
      "",
      `Tenant key: ${tenantKey || "unknown"}`,
      `Current plan: ${planTier || "unknown"}`,
      `Requester: ${requesterId || "unknown"}`,
      `Source: ${source || "admin_plan"}`,
    ];
    return {
      href: `mailto:${encodeURIComponent(configuredEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(bodyLines.join("\n"))}`,
      label: "Request upgrade",
      helperText: "TEJ will review your current plan and follow up on commercial changes.",
    };
  }

  return null;
}
