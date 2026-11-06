import nodemailer, { type Transporter } from "nodemailer";
import type { AppConfig } from "../env";

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface Mailer {
  send(message: MailMessage): Promise<void>;
}

class ConsoleMailer implements Mailer {
  constructor(private readonly logger: { info: (obj: object, msg?: string) => void }) {}

  async send(message: MailMessage): Promise<void> {
    this.logger.info(
      { to: message.to, subject: message.subject },
      `mail (console transport)\n${message.text}`,
    );
  }
}

class SmtpMailer implements Mailer {
  private readonly transporter: Transporter;

  constructor(config: AppConfig) {
    this.transporter = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_PORT === 465,
      auth: config.SMTP_USER ? { user: config.SMTP_USER, pass: config.SMTP_PASSWORD } : undefined,
    });
  }

  async send(message: MailMessage): Promise<void> {
    await this.transporter.sendMail({
      from: process.env.SMTP_FROM ?? "Aplora <no-reply@aplora.local>",
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  }
}

export function createMailer(config: AppConfig, logger: { info: (obj: object, msg?: string) => void }): Mailer {
  if (config.MAIL_TRANSPORT === "smtp") return new SmtpMailer(config);
  return new ConsoleMailer(logger);
}

export function verificationEmail(link: string): MailMessage["text"] {
  return [
    "Welcome to Aplora.",
    "",
    "Confirm your email address to finish setting up your account:",
    link,
    "",
    "The link expires in 24 hours. If you did not create an account, you can ignore this message.",
  ].join("\n");
}

export function passwordResetEmail(link: string): MailMessage["text"] {
  return [
    "Someone requested a password reset for your Aplora account.",
    "",
    "Choose a new password here:",
    link,
    "",
    "The link expires in 1 hour. If this was not you, no action is needed.",
  ].join("\n");
}
