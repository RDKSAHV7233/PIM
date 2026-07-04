import {
  escapeHtml,
  formatDateUtc,
  renderEmailHtml,
  renderEmailText,
  resolveEmailBrandConfig,
  hasCommercialContactPath,
  resolveCommercialContactText,
  type EmailTemplateInput,
} from "./email-template";

// ─── escapeHtml ──────────────────────────────────────────────────────────────

describe("escapeHtml", () => {
  it("escapes all five HTML-sensitive characters", () => {
    expect(escapeHtml(`<script>alert("x'&y")</script>`)).toBe(
      "&lt;script&gt;alert(&quot;x&#39;&amp;y&quot;)&lt;/script&gt;",
    );
  });

  it("returns empty string unchanged", () => {
    expect(escapeHtml("")).toBe("");
  });

  it("leaves safe text untouched", () => {
    expect(escapeHtml("Hello World 123")).toBe("Hello World 123");
  });

  it("handles unicode without mangling", () => {
    expect(escapeHtml("Vexa PIM — 日本語")).toBe("Vexa PIM — 日本語");
  });
});

// ─── formatDateUtc ───────────────────────────────────────────────────────────

describe("formatDateUtc", () => {
  it("formats a UTC date as human-readable", () => {
    const d = new Date("2026-07-04T14:30:00Z");
    expect(formatDateUtc(d)).toBe("July 4, 2026 at 2:30 PM UTC");
  });

  it("uses 12 for noon, not 0", () => {
    const d = new Date("2026-01-15T12:05:00Z");
    expect(formatDateUtc(d)).toBe("January 15, 2026 at 12:05 PM UTC");
  });

  it("uses 12 for midnight, not 0", () => {
    const d = new Date("2026-03-01T00:00:00Z");
    expect(formatDateUtc(d)).toBe("March 1, 2026 at 12:00 AM UTC");
  });

  it("zero-pads minutes", () => {
    const d = new Date("2026-06-10T09:03:00Z");
    expect(formatDateUtc(d)).toBe("June 10, 2026 at 9:03 AM UTC");
  });
});

// ─── resolveEmailBrandConfig ─────────────────────────────────────────────────

describe("resolveEmailBrandConfig", () => {
  const VARS = [
    "PIM_EMAIL_LOGO_URL",
    "PIM_EMAIL_BANNER_URL",
    "PIM_EMAIL_SUPPORT_URL",
    "PIM_EMAIL_SUPPORT_EMAIL",
    "PIM_COMMERCIAL_CONTACT_URL",
    "PIM_COMMERCIAL_CONTACT_EMAIL",
  ];

  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const v of VARS) {
      saved[v] = process.env[v];
      delete process.env[v];
    }
  });

  afterEach(() => {
    for (const v of VARS) {
      if (saved[v] === undefined) delete process.env[v];
      else process.env[v] = saved[v];
    }
  });

  it("returns empty strings when env vars are unset", () => {
    const cfg = resolveEmailBrandConfig();
    expect(cfg.logoUrl).toBe("");
    expect(cfg.bannerUrl).toBe("");
    expect(cfg.supportUrl).toBe("");
    expect(cfg.supportEmail).toBe("");
    expect(cfg.commercialContactUrl).toBe("");
    expect(cfg.commercialContactEmail).toBe("");
  });

  it("reads values from env and trims whitespace", () => {
    process.env.PIM_EMAIL_LOGO_URL = "  https://cdn.example.com/logo.png  ";
    process.env.PIM_EMAIL_SUPPORT_EMAIL = " support@example.com ";
    const cfg = resolveEmailBrandConfig();
    expect(cfg.logoUrl).toBe("https://cdn.example.com/logo.png");
    expect(cfg.supportEmail).toBe("support@example.com");
  });
});

// ─── hasCommercialContactPath ────────────────────────────────────────────────

describe("hasCommercialContactPath", () => {
  const saved: Record<string, string | undefined> = {};
  const VARS = ["PIM_COMMERCIAL_CONTACT_URL", "PIM_COMMERCIAL_CONTACT_EMAIL"];

  beforeEach(() => {
    for (const v of VARS) {
      saved[v] = process.env[v];
      delete process.env[v];
    }
  });

  afterEach(() => {
    for (const v of VARS) {
      if (saved[v] === undefined) delete process.env[v];
      else process.env[v] = saved[v];
    }
  });

  it("returns false when neither URL nor email is set", () => {
    expect(hasCommercialContactPath()).toBe(false);
  });

  it("returns true when URL is set", () => {
    process.env.PIM_COMMERCIAL_CONTACT_URL = "https://example.com/contact";
    expect(hasCommercialContactPath()).toBe(true);
  });

  it("returns true when email is set", () => {
    process.env.PIM_COMMERCIAL_CONTACT_EMAIL = "billing@example.com";
    expect(hasCommercialContactPath()).toBe(true);
  });
});

// ─── resolveCommercialContactText ────────────────────────────────────────────

describe("resolveCommercialContactText", () => {
  const VARS = ["PIM_COMMERCIAL_CONTACT_URL", "PIM_COMMERCIAL_CONTACT_EMAIL", "APP_ENV"];
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const v of VARS) {
      saved[v] = process.env[v];
      delete process.env[v];
    }
  });

  afterEach(() => {
    for (const v of VARS) {
      if (saved[v] === undefined) delete process.env[v];
      else process.env[v] = saved[v];
    }
  });

  it("includes URL when PIM_COMMERCIAL_CONTACT_URL is set", () => {
    process.env.PIM_COMMERCIAL_CONTACT_URL = "https://example.com/contact";
    expect(resolveCommercialContactText()).toContain("https://example.com/contact");
  });

  it("includes email when only PIM_COMMERCIAL_CONTACT_EMAIL is set", () => {
    process.env.PIM_COMMERCIAL_CONTACT_EMAIL = "billing@example.com";
    expect(resolveCommercialContactText()).toContain("billing@example.com");
  });

  it("returns generic text in production when neither is set", () => {
    process.env.APP_ENV = "production";
    const text = resolveCommercialContactText();
    expect(text).toContain("contact Vexa commercial ops");
    expect(text).not.toContain("No commercial contact path configured");
  });

  it("returns config warning in development when neither is set", () => {
    process.env.APP_ENV = "development";
    const text = resolveCommercialContactText();
    expect(text).toContain("No commercial contact path configured");
  });
});

// ─── renderEmailHtml ─────────────────────────────────────────────────────────

describe("renderEmailHtml", () => {
  function baseInput(overrides?: Partial<EmailTemplateInput>): EmailTemplateInput {
    return {
      title: "Test Email",
      bodyHtml: "<p>Hello world</p>",
      bodyText: "Hello world",
      signatureType: "default",
      footerReason: "You received this because of testing.",
      ...overrides,
    };
  }

  it("produces valid HTML document with doctype", () => {
    const html = renderEmailHtml(baseInput());
    expect(html).toMatch(/^<!DOCTYPE html>/);
    expect(html).toContain("<html lang=\"en\">");
    expect(html).toContain("</html>");
  });

  it("escapes the title in <title> and <h1>", () => {
    const html = renderEmailHtml(baseInput({ title: "Hello <script>" }));
    expect(html).toContain("<title>Hello &lt;script&gt;</title>");
    expect(html).toContain("Hello &lt;script&gt;</h1>");
  });

  it("includes preheader when provided", () => {
    const html = renderEmailHtml(baseInput({ preheader: "Quick preview" }));
    expect(html).toContain("display:none");
    expect(html).toContain("Quick preview");
  });

  it("omits preheader when not provided", () => {
    const html = renderEmailHtml(baseInput());
    expect(html).not.toContain("display:none;font-size:1px");
  });

  it("renders logo image when logoUrl is provided", () => {
    const html = renderEmailHtml(baseInput({ logoUrl: "https://cdn.example.com/logo.png" }));
    expect(html).toContain('<img src="https://cdn.example.com/logo.png"');
    expect(html).toContain('alt="Vexa PIM"');
  });

  it("renders text fallback when logoUrl is empty", () => {
    const html = renderEmailHtml(baseInput());
    expect(html).toContain("Vexa PIM</span>");
    expect(html).not.toContain("<img");
  });

  it("renders banner when bannerUrl is provided", () => {
    const html = renderEmailHtml(baseInput({ bannerUrl: "https://cdn.example.com/banner.jpg" }));
    expect(html).toContain('src="https://cdn.example.com/banner.jpg"');
  });

  it("renders CTA button when label and url are provided", () => {
    const html = renderEmailHtml(baseInput({ ctaLabel: "Click me", ctaUrl: "https://example.com/action" }));
    expect(html).toContain('href="https://example.com/action"');
    expect(html).toContain("Click me");
  });

  it("omits CTA button when ctaLabel or ctaUrl is missing", () => {
    const html = renderEmailHtml(baseInput({ ctaLabel: "Click me" }));
    expect(html).not.toContain("Click me</a>");
  });

  it("escapes HTML in CTA URL to prevent injection", () => {
    const html = renderEmailHtml(baseInput({
      ctaLabel: "Go",
      ctaUrl: 'https://example.com/?q="&x=1',
    }));
    expect(html).toContain("?q=&quot;&amp;x=1");
  });

  it("escapes logo URL to prevent injection", () => {
    const html = renderEmailHtml(baseInput({ logoUrl: 'https://example.com/logo.png"onload="alert(1)' }));
    expect(html).not.toContain('onload="alert(1)"');
    expect(html).toContain("&quot;onload=&quot;alert(1)");
  });

  it("includes security signature for security type", () => {
    const html = renderEmailHtml(baseInput({ signatureType: "security" }));
    expect(html).toContain("Vexa PIM Security");
    expect(html).toContain("security action");
  });

  it("includes commercial signature for commercial type", () => {
    const html = renderEmailHtml(baseInput({ signatureType: "commercial" }));
    expect(html).toContain("Vexa PIM Commercial Team");
  });

  it("includes support signature for support type", () => {
    const html = renderEmailHtml(baseInput({ signatureType: "support" }));
    expect(html).toContain("Vexa PIM Support");
  });

  it("includes contact link in commercial signature when commercialContactUrl is set", () => {
    const html = renderEmailHtml(baseInput({
      signatureType: "commercial",
      commercialContactUrl: "https://example.com/contact",
    }));
    expect(html).toContain('href="https://example.com/contact"');
  });

  it("includes support link in support signature when supportUrl is set", () => {
    const html = renderEmailHtml(baseInput({
      signatureType: "support",
      supportUrl: "https://example.com/support",
    }));
    expect(html).toContain('href="https://example.com/support"');
  });

  it("includes footer reason text", () => {
    const html = renderEmailHtml(baseInput());
    expect(html).toContain("You received this because of testing.");
  });

  it("does not contain tracking pixels or data URIs", () => {
    const html = renderEmailHtml(baseInput({ logoUrl: "https://cdn.example.com/logo.png" }));
    expect(html).not.toContain("data:image");
    expect(html).not.toMatch(/1x1/);
  });
});

// ─── renderEmailText ─────────────────────────────────────────────────────────

describe("renderEmailText", () => {
  function baseInput(overrides?: Partial<EmailTemplateInput>): EmailTemplateInput {
    return {
      title: "Test Email",
      bodyHtml: "<p>Hello world</p>",
      bodyText: "Hello world",
      signatureType: "default",
      footerReason: "You received this because of testing.",
      ...overrides,
    };
  }

  it("starts with title and underline", () => {
    const text = renderEmailText(baseInput());
    const lines = text.split("\n");
    expect(lines[0]).toBe("Test Email");
    expect(lines[1]).toBe("=".repeat("Test Email".length));
  });

  it("includes body text", () => {
    const text = renderEmailText(baseInput({ bodyText: "This is the body." }));
    expect(text).toContain("This is the body.");
  });

  it("includes CTA label and URL when provided", () => {
    const text = renderEmailText(baseInput({ ctaLabel: "Click here", ctaUrl: "https://example.com/go" }));
    expect(text).toContain("Click here: https://example.com/go");
  });

  it("omits CTA when label or URL is missing", () => {
    const text = renderEmailText(baseInput({ ctaLabel: "Click here" }));
    expect(text).not.toContain("Click here:");
  });

  it("includes signature section after separator", () => {
    const text = renderEmailText(baseInput({ signatureType: "security" }));
    expect(text).toContain("---");
    expect(text).toContain("Vexa PIM Security");
  });

  it("includes footer reason text", () => {
    const text = renderEmailText(baseInput());
    expect(text).toContain("You received this because of testing.");
  });

  it("is fully readable without HTML tags", () => {
    const text = renderEmailText(baseInput());
    expect(text).not.toContain("<");
    expect(text).not.toContain(">");
  });

  it("includes contact info in commercial signature when commercialContactUrl is set", () => {
    const text = renderEmailText(baseInput({
      signatureType: "commercial",
      commercialContactUrl: "https://example.com/contact",
    }));
    expect(text).toContain("Contact: https://example.com/contact");
  });
});

// ─── Sender-level contract tests ─────────────────────────────────────────────

describe("sender-level: signup verification rendering", () => {
  it("formatDateUtc output never resembles ISO 8601", () => {
    const d = new Date("2026-07-04T14:30:00Z");
    const formatted = formatDateUtc(d);
    expect(formatted).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(formatted).not.toContain("Z");
    expect(formatted).toContain("July 4, 2026");
  });

  it("rendered email with formatDateUtc date does not contain ISO timestamp", () => {
    const expiryDate = new Date("2026-07-04T14:30:00Z");
    const expiryText = formatDateUtc(expiryDate);
    const html = renderEmailHtml({
      title: "Verify your Vexa PIM workspace",
      bodyHtml: `<p>This link expires ${escapeHtml(expiryText)}.</p>`,
      bodyText: `This link expires ${expiryText}.`,
      signatureType: "security",
      footerReason: "Test",
    });
    expect(html).not.toContain("2026-07-04T");
    expect(html).toContain("July 4, 2026 at 2:30 PM UTC");
  });
});

describe("sender-level: security emails (password reset, account unlock)", () => {
  function securityInput(overrides?: Partial<EmailTemplateInput>): EmailTemplateInput {
    return {
      logoUrl: "https://cdn.example.com/logo.png",
      title: "Reset your Vexa PIM password",
      bodyHtml: "<p>Use the link below to set a new password.</p>",
      bodyText: "Use the link below to set a new password.",
      ctaLabel: "Set a new password",
      ctaUrl: "https://example.com/login/reset?token=abc123&email=user%40example.com",
      signatureType: "security",
      footerReason: "You received this because a security action was requested.",
      ...overrides,
    };
  }

  it("does not render a banner image", () => {
    const html = renderEmailHtml(securityInput());
    const imgTags = html.match(/<img[^>]*>/g) ?? [];
    for (const img of imgTags) {
      expect(img).not.toContain('alt=""');
    }
  });

  it("does not contain unsubscribe wording", () => {
    const html = renderEmailHtml(securityInput());
    const text = renderEmailText(securityInput());
    expect(html.toLowerCase()).not.toContain("unsubscribe");
    expect(text.toLowerCase()).not.toContain("unsubscribe");
  });

  it("security signature does not contain unsubscribe", () => {
    const text = renderEmailText(securityInput());
    expect(text).toContain("Vexa PIM Security");
    expect(text.toLowerCase()).not.toContain("unsubscribe");
  });
});

describe("sender-level: account export email", () => {
  function exportInput(): EmailTemplateInput {
    return {
      logoUrl: "https://cdn.example.com/logo.png",
      title: "Your Vexa PIM account export is ready",
      bodyHtml: "<p>Your account export is ready.</p><p>Sign in to Vexa PIM and open Privacy settings to download it securely.</p>",
      bodyText: "Your account export is ready. Sign in to Vexa PIM and open https://app.example.com/settings/privacy to download it securely.",
      ctaLabel: "Open privacy settings",
      ctaUrl: "https://app.example.com/settings/privacy",
      signatureType: "support",
      footerReason: "You received this email because it relates to your Vexa PIM workspace.",
    };
  }

  it("does not contain a direct download link", () => {
    const html = renderEmailHtml(exportInput());
    const text = renderEmailText(exportInput());
    expect(html).not.toContain("/download");
    expect(html).not.toContain("/export/");
    expect(text).not.toContain("/download");
    expect(text).not.toContain("/export/");
  });

  it("CTA points to privacy settings, not a download URL", () => {
    const html = renderEmailHtml(exportInput());
    expect(html).toContain('href="https://app.example.com/settings/privacy"');
  });

  it("uses support signature, not security or commercial", () => {
    const text = renderEmailText(exportInput());
    expect(text).toContain("Vexa PIM Support");
    expect(text).not.toContain("Vexa PIM Security");
    expect(text).not.toContain("Vexa PIM Commercial");
  });
});

describe("sender-level: commercial contact path safety", () => {
  const VARS = ["PIM_COMMERCIAL_CONTACT_URL", "PIM_COMMERCIAL_CONTACT_EMAIL", "APP_ENV"] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const v of VARS) {
      saved[v] = process.env[v];
      delete process.env[v];
    }
  });

  afterEach(() => {
    for (const v of VARS) {
      if (saved[v] === undefined) delete process.env[v];
      else process.env[v] = saved[v];
    }
  });

  it("hasCommercialContactPath returns false when no contact path is configured in production", () => {
    process.env.APP_ENV = "production";
    expect(hasCommercialContactPath()).toBe(false);
  });

  it("prefers URL over email when both are configured", () => {
    process.env.PIM_COMMERCIAL_CONTACT_URL = "https://example.com/contact";
    process.env.PIM_COMMERCIAL_CONTACT_EMAIL = "billing@example.com";
    const text = resolveCommercialContactText();
    expect(text).toContain("https://example.com/contact");
    expect(text).not.toContain("billing@example.com");
  });

  it("commercial signature prefers URL over email in HTML", () => {
    const html = renderEmailHtml({
      title: "Test",
      bodyHtml: "<p>test</p>",
      bodyText: "test",
      signatureType: "commercial",
      footerReason: "test",
      commercialContactUrl: "https://example.com/contact",
      commercialContactEmail: "billing@example.com",
    });
    expect(html).toContain('href="https://example.com/contact"');
    expect(html).not.toContain("billing@example.com");
  });

  it("commercial signature prefers URL over email in plain text", () => {
    const text = renderEmailText({
      title: "Test",
      bodyHtml: "<p>test</p>",
      bodyText: "test",
      signatureType: "commercial",
      footerReason: "test",
      commercialContactUrl: "https://example.com/contact",
      commercialContactEmail: "billing@example.com",
    });
    expect(text).toContain("Contact: https://example.com/contact");
    expect(text).not.toContain("billing@example.com");
  });
});
