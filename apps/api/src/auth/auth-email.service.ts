import { Injectable, Logger } from "@nestjs/common";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const RESEND_TIMEOUT_MS = 10_000;

type AuthEmailProvider = "file" | "console" | "resend";

export interface AuthEmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  from?: string;
  replyTo?: string;
  category:
    | "password_reset"
    | "account_unlock"
    | "account_export_ready"
    | "signup_verification"
    | "commercial_status_notice"
    | "commercial_upgrade_request";
  metadata?: Record<string, unknown>;
}

function resolveProvider(): AuthEmailProvider {
  const raw = String(process.env.AUTH_EMAIL_PROVIDER ?? "").trim().toLowerCase();
  if (raw === "console") {
    return "console";
  }
  return raw === "resend" ? "resend" : "file";
}

function sanitizeSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/^_+|_+$/g, "") || "email";
}

@Injectable()
export class AuthEmailService {
  private readonly logger = new Logger(AuthEmailService.name);
  private readonly provider = resolveProvider();

  async send(message: AuthEmailMessage): Promise<void> {
    if (this.provider === "resend") {
      await this.sendViaResend(message);
      return;
    }
    if (this.provider === "console") {
      this.logToConsole(message);
      return;
    }
    await this.writeOutboxFile(message);
  }

  private async sendViaResend(message: AuthEmailMessage): Promise<void> {
    const apiKey = String(process.env.AUTH_EMAIL_RESEND_API_KEY ?? "").trim();
    const defaultFrom = String(process.env.AUTH_EMAIL_FROM ?? "").trim();
    const from = (message.from || defaultFrom).trim();
    if (!apiKey || !from) {
      this.logger.error(
        "AUTH_EMAIL_PROVIDER=resend but AUTH_EMAIL_RESEND_API_KEY or AUTH_EMAIL_FROM is missing. Email delivery is misconfigured.",
      );
      throw new Error("EMAIL_PROVIDER_MISCONFIGURED");
    }

    const replyTo = (message.replyTo || message.from || String(process.env.AUTH_EMAIL_REPLY_TO ?? "")).trim();

    const response = await this.callResendApi(apiKey, from, replyTo, message);
    if (response.ok) return;

    const body = await response.text().catch(() => "");

    if (response.status === 403 && message.from && defaultFrom && message.from !== defaultFrom) {
      this.logger.warn(
        `Resend rejected from="${message.from}" (403). Retrying with default "${defaultFrom}". Verify domain in Resend dashboard.`,
      );
      const fallbackReply = (message.replyTo || String(process.env.AUTH_EMAIL_REPLY_TO ?? "")).trim();
      const retry = await this.callResendApi(apiKey, defaultFrom, fallbackReply, message);
      if (retry.ok) return;
      const retryBody = await retry.text().catch(() => "");
      throw new Error(`Resend email delivery failed on fallback: ${retry.status} ${retryBody}`.trim());
    }

    throw new Error(`Resend email delivery failed: ${response.status} ${body}`.trim());
  }

  private async callResendApi(
    apiKey: string,
    from: string,
    replyTo: string,
    message: AuthEmailMessage,
  ): Promise<Response> {
    const payload: Record<string, unknown> = {
      from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
      tags: [{ name: "category", value: message.category }],
    };
    if (replyTo) {
      payload.reply_to = replyTo;
    }
    return fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(RESEND_TIMEOUT_MS),
    });
  }

  private logToConsole(message: AuthEmailMessage): void {
    this.logger.log(
      JSON.stringify(
        {
          provider: "console",
          writtenAt: new Date().toISOString(),
          ...message,
        },
        null,
        2,
      ),
    );
  }

  private async writeOutboxFile(message: AuthEmailMessage): Promise<void> {
    const baseDir = String(process.env.AUTH_EMAIL_OUTBOX_DIR ?? "").trim() || path.join(process.cwd(), "storage", "auth-email-outbox");
    await fs.mkdir(baseDir, { recursive: true });
    const fileName = `${new Date().toISOString().replace(/[:.]/g, "-")}-${message.category}-${sanitizeSegment(message.to)}-${randomUUID()}.json`;
    const filePath = path.join(baseDir, fileName);
    await fs.writeFile(
      filePath,
      JSON.stringify(
        {
          ...message,
          provider: "file",
          writtenAt: new Date().toISOString(),
        },
        null,
        2,
      ),
      "utf8",
    );
  }
}
