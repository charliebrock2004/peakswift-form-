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

/** What the SMTP server said when it took the message. */
export type SendReceipt = { messageId: string; response: string };

export type SendMail = (mail: OutgoingMail) => Promise<SendReceipt>;

/** The slice of nodemailer's sendMail result this relies on. */
export type SmtpInfo = { messageId?: string; response?: string; accepted?: unknown[]; rejected?: unknown[] };

/**
 * Turns the server's reply into a receipt, or throws when the recipient was not
 * accepted. nodemailer resolves even if some recipients were rejected, so a
 * resolved promise alone is not proof of acceptance.
 */
export function receiptFrom(info: SmtpInfo, to: string): SendReceipt {
  const accepted = (info.accepted ?? []).map((item) => String(item).toLowerCase());
  const rejected = (info.rejected ?? []).map(String);
  if (rejected.length > 0 || !accepted.includes(to.toLowerCase())) {
    throw new Error(`Recipient not accepted by the mail server: ${info.response ?? "no response"}`);
  }
  return {
    messageId: String(info.messageId ?? "").slice(0, 300),
    response: String(info.response ?? "").replace(/\s+/g, " ").trim().slice(0, 300),
  };
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

const EMAIL = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export function isPlainEmail(value: string): boolean {
  return EMAIL.test(value) && !/[\r\n,;]/.test(value);
}

/** Variable names accepted for each setting, first match wins. Names only; values are never reported. */
export const MAIL_ENV_NAMES = {
  user: ["SMTP_USER", "SMTP_USERNAME", "GMAIL_USER"],
  password: ["SMTP_PASSWORD", "SMTP_PASS", "GMAIL_APP_PASSWORD"],
  host: ["SMTP_HOST"],
  port: ["SMTP_PORT"],
  from: ["NOTIFY_FROM"],
  to: ["NOTIFY_TO"],
} as const;

export type MailEnvState = "set" | "blank" | "missing";

export type MailDiagnosis = {
  config: MailConfig | null;
  /** Why email is off, naming variables but never their values. Null when configured. */
  problem: string | null;
  /** Presence of every recognised variable name. */
  variables: Record<string, MailEnvState>;
};

/** Removes invisible characters that phone keyboards and copy-paste add. */
function clean(value: string): string {
  return value.replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").trim();
}

/** Accepts `addr`, `"addr"` and `Name <addr>`; returns the bare address. */
function normaliseAddress(value: string): string {
  let out = clean(value);
  const angled = /<([^<>]+)>\s*$/.exec(out);
  if (angled) out = angled[1]!.trim();
  return out.replace(/^["']+|["']+$/g, "").trim();
}

function pick(env: NodeJS.ProcessEnv, names: readonly string[]): { name: string; value: string } | null {
  for (const name of names) {
    const raw = env[name];
    if (raw !== undefined && clean(raw) !== "") return { name, value: raw };
  }
  return null;
}

/**
 * Works out the SMTP settings and, when they are unusable, exactly why. Every
 * reason that used to make email silently "not-configured" now has a message
 * naming the variable involved.
 */
export function diagnoseMailConfig(env: NodeJS.ProcessEnv = process.env): MailDiagnosis {
  const variables: Record<string, MailEnvState> = {};
  for (const names of Object.values(MAIL_ENV_NAMES)) {
    for (const name of names) {
      const raw = env[name];
      variables[name] = raw === undefined ? "missing" : clean(raw) === "" ? "blank" : "set";
    }
  }
  const fail = (problem: string): MailDiagnosis => ({ config: null, problem, variables });

  const userVar = pick(env, MAIL_ENV_NAMES.user);
  const passwordVar = pick(env, MAIL_ENV_NAMES.password);
  if (!userVar) return fail("SMTP_USER is missing or blank in this deployment's environment.");
  if (!passwordVar) return fail("SMTP_PASSWORD is missing or blank in this deployment's environment.");

  const host = clean(env.SMTP_HOST ?? "") || "smtp.gmail.com";
  const gmail = host === "smtp.gmail.com";
  let user = normaliseAddress(userVar.value);
  // Gmail accepts a bare username; the From address still needs the domain.
  if (gmail && !user.includes("@")) user = `${user}@gmail.com`;
  // Google shows App Passwords as four groups of four; the spaces are not part of it.
  const password = gmail ? clean(passwordVar.value).replace(/\s+/g, "") : clean(passwordVar.value);

  const portText = clean(env.SMTP_PORT ?? "") || "465";
  const port = Number(portText);
  if (!/^\d+$/.test(portText) || port <= 0 || port > 65535) {
    return fail("SMTP_PORT is not a port number. Remove it to use Gmail's default (465).");
  }

  const fromRaw = clean(env.NOTIFY_FROM ?? "");
  const from = fromRaw ? normaliseAddress(fromRaw) : user;
  if (!isPlainEmail(from)) {
    return fail(
      fromRaw
        ? "NOTIFY_FROM is not a single email address."
        : gmail
          ? `${userVar.name} is not an email address. Use the full Gmail address, e.g. name@gmail.com.`
          : "Set NOTIFY_FROM to the sender address for this SMTP provider.",
    );
  }
  const toRaw = clean(env.NOTIFY_TO ?? "");
  const to = toRaw ? normaliseAddress(toRaw) : DEFAULT_NOTIFY_TO;
  if (!isPlainEmail(to)) return fail("NOTIFY_TO is not a single email address. Remove it to use the default.");

  return {
    config: { host, port, secure: port === 465, user: gmail ? user : clean(userVar.value), password, from, to },
    problem: null,
    variables,
  };
}

/** Returns null when email is not configured, so callers can keep the brief as pending. */
export function resolveMailConfig(env: NodeJS.ProcessEnv = process.env): MailConfig | null {
  return diagnoseMailConfig(env).config;
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
      const info = await transport.sendMail({
        from: { name: "PeakSwift Enquiries", address: mail.from },
        to: mail.to,
        replyTo: mail.replyTo,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
      });
      return receiptFrom(info, mail.to);
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
