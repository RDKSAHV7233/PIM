import { Injectable, Logger } from "@nestjs/common";
import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

type AuthEmailProvider = "file" | "resend";

export interface AuthEmailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  category: "password_reset" | "account_unlock" | "account_export_ready";
  metadata?: Record<string, unknown>;
}

function resolveProvider(): AuthEmailProvider {
  const raw = String(process.env.AUTH_EMAIL_PROVIDER ?? "").trim().toLowerCase();
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
    await this.writeOutboxFile(message);
  }

  private async sendViaResend(message: AuthEmailMessage): Promise<void> {
    const apiKey = String(process.env.AUTH_EMAIL_RESEND_API_KEY ?? "").trim();
    const from = String(process.env.AUTH_EMAIL_FROM ?? "").trim();
    if (!apiKey || !from) {
      this.logger.warn("AUTH_EMAIL_PROVIDER=resend but AUTH_EMAIL_RESEND_API_KEY or AUTH_EMAIL_FROM is missing. Falling back to file outbox.");
      await this.writeOutboxFile(message);
      return;
    }

    const payload: Record<string, unknown> = {
      from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      html: message.html,
      tags: [
        {
          name: "category",
          value: message.category,
        },
      ],
    };
    const replyTo = String(process.env.AUTH_EMAIL_REPLY_TO ?? "").trim();
    if (replyTo) {
      payload.reply_to = replyTo;
    }

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      throw new Error(`Resend email delivery failed: ${response.status} ${body}`.trim());
    }
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
