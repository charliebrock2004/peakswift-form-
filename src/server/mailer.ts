/**
 * Server-only email transport. Credentials come from environment variables and
 * are never imported by browser code.
 *
 * Defaults to Gmail SMTP with a Google App Password. Any SMTP provider (for
 * example Resend's SMTP relay once a domain is verified) works by setting
 * SMTP_HOST / SMTP_PORT as well.
 */

export const DEFAULT_NOTIFY_TO = "PeakSwiftstudio@gmail.com";

export type MailConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  from: string;
  to: string;
};

export type OutgoingMail = {
  to: string;
  from: string;
  replyTo?: string;
  subject: string;
  text: string;
  html: string;
};

export type SendMail = (mail: OutgoingMail) => Promise<void>;

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export function isPlainEmail(value: string): boolean {
  return EMAIL.test(value) && !/[\r\n,;]/.test(value);
}

/** Returns null when email is not configured, so callers can keep the brief as pending. */
export function resolveMailConfig(env: NodeJS.ProcessEnv = process.env): MailConfig | null {
  const user = env.SMTP_USER?.trim();
  const host = env.SMTP_HOST?.trim() || "smtp.gmail.com";
  // Google shows App Passwords as four groups of four; the spaces are not part of it.
  const rawPassword = env.SMTP_PASSWORD ?? "";
  const password = host === "smtp.gmail.com" ? rawPassword.replace(/\s+/g, "") : rawPassword.trim();
  if (!user || !password) return null;
  const port = Number(env.SMTP_PORT?.trim() || "465");
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
  const from = env.NOTIFY_FROM?.trim() || (isPlainEmail(user) ? user : "");
  const to = env.NOTIFY_TO?.trim() || DEFAULT_NOTIFY_TO;
  if (!isPlainEmail(from) || !isPlainEmail(to)) return null;
  return { host, port, secure: port === 465, user, password, from, to };
}

export function createSmtpSender(config: MailConfig): SendMail {
  return async (mail) => {
    const nodemailer = await import("nodemailer");
    const transport = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      // Plain SMTP is only acceptable to a local test catcher.
      requireTLS: !config.secure && !LOCAL_HOSTS.has(config.host),
      auth: { user: config.user, pass: config.password },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    try {
      await transport.sendMail({
        from: { name: "PeakSwift Enquiries", address: mail.from },
        to: mail.to,
        replyTo: mail.replyTo,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      });
    } finally {
      transport.close();
    }
  };
}

/** Error text safe to store and show in Studio: no credentials, bounded length. */
export function describeMailError(error: unknown, config?: Pick<MailConfig, "password" | "user"> | null): string {
  let message = error instanceof Error ? error.message : String(error);
  if (config?.password) message = message.split(config.password).join("[redacted]");
  return message.replace(/\s+/g, " ").trim().slice(0, 300) || "Unknown email error";
}
