import { explainMailError } from "../lib/onboarding/mail-errors.ts";
import {
  createSmtpSender,
  DEFAULT_NOTIFY_TO,
  describeMailError,
  diagnoseMailConfig,
  isPlainEmail,
  type MailEnvState,
  type OutgoingMail,
  type SendMail,
} from "./mailer.ts";
import { createResendSender, RESEND_DEFAULT_FROM, ResendError } from "./resend.ts";

export type EmailProviderKind = "resend" | "smtp";

export type EmailTransport = {
  kind: EmailProviderKind;
  send: SendMail;
  from: string;
  to: string;
  /** True when Gmail SMTP sends to its own account (Gmail files that under Sent Mail). */
  sendsToItself: boolean;
  describeError: (error: unknown) => string;
};

export type EmailSetup = {
  transport: EmailTransport | null;
  provider: EmailProviderKind | null;
  problem: string | null;
  variables: Record<string, MailEnvState>;
};

export const RESEND_ENV_NAMES = ["RESEND_API_KEY", "RESEND_FROM"] as const;

function clean(value: string | undefined): string {
  return (value ?? "").replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").trim().replace(/^["']+|["']+$/g, "");
}

function state(raw: string | undefined): MailEnvState {
  return raw === undefined ? "missing" : clean(raw) === "" ? "blank" : "set";
}

/** Address part of `Name <addr>` or a bare address. */
function addressOf(value: string): string {
  const angled = /<([^<>]+)>\s*$/.exec(value);
  return (angled ? angled[1]! : value).trim();
}

function redact(message: string, secret: string): string {
  return secret ? message.split(secret).join("[redacted]") : message;
}

/** Resend first. If Resend refuses the key, send through Gmail when that account is configured. */
export async function sendResendOrSmtp(
  resendSend: SendMail,
  smtpSend: SendMail | null,
  smtpFrom: string,
  mail: OutgoingMail,
) {
  try {
    return await resendSend(mail);
  } catch (error) {
    const authFailed = error instanceof ResendError && (error.status === 401 || error.status === 403);
    if (!authFailed || !smtpSend) throw error;
    try {
      // Gmail only accepts mail from the authenticated account, not RESEND_FROM.
      return await smtpSend({ ...mail, from: smtpFrom });
    } catch (smtpError) {
      const smtpMessage = smtpError instanceof Error ? smtpError.message : String(smtpError);
      throw new ResendError(error.status, `${error.message}; Gmail fallback also failed: ${smtpMessage}`);
    }
  }
}

/**
 * Chooses how notifications are sent. Resend (RESEND_API_KEY) is preferred:
 * HTTPS API, delivery records and idempotency. Gmail SMTP (SMTP_USER +
 * SMTP_PASSWORD) remains as a fallback. Reasons name variables, never values.
 */
export function resolveEmailSetup(env: NodeJS.ProcessEnv = process.env, fetchImpl?: typeof fetch): EmailSetup {
  const smtp = diagnoseMailConfig(env);
  const variables: Record<string, MailEnvState> = {
    RESEND_API_KEY: state(env.RESEND_API_KEY),
    RESEND_FROM: state(env.RESEND_FROM),
    ...smtp.variables,
  };
  const toRaw = clean(env.NOTIFY_TO);
  const to = toRaw ? addressOf(toRaw) : DEFAULT_NOTIFY_TO;

  const apiKey = clean(env.RESEND_API_KEY);
  if (apiKey) {
    const fail = (problem: string): EmailSetup => ({ transport: null, provider: "resend", problem, variables });
    if (!/^re_[A-Za-z0-9_]{8,}$/.test(apiKey)) {
      return fail("RESEND_API_KEY does not look like a Resend API key (it should start with re_). Copy it again from resend.com → API Keys.");
    }
    const fromRaw = clean(env.RESEND_FROM);
    const from = fromRaw || RESEND_DEFAULT_FROM;
    if (!isPlainEmail(addressOf(from))) return fail("RESEND_FROM is not an email address. Remove it to use onboarding@resend.dev.");
    if (!isPlainEmail(to)) return fail("NOTIFY_TO is not a single email address. Remove it to use the default.");
    const resendSend = createResendSender(apiKey, fetchImpl);
    const smtpSend = smtp.config ? createSmtpSender(smtp.config) : null;
    return {
      provider: "resend",
      problem: null,
      variables,
      transport: {
        kind: "resend",
        send: (mail) => sendResendOrSmtp(resendSend, smtpSend, smtp.config?.from ?? "", mail),
        from,
        to,
        sendsToItself: false,
        describeError: (error) => {
          const message = redact(error instanceof Error ? error.message : String(error), apiKey)
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 500);
          const hint = explainMailError(message);
          return hint ? `${message} — ${hint}` : message;
        },
      },
    };
  }

  if (smtp.config) {
    const config = smtp.config;
    return {
      provider: "smtp",
      problem: null,
      variables,
      transport: {
        kind: "smtp",
        send: createSmtpSender(config),
        from: config.from,
        to: config.to,
        sendsToItself: config.user.toLowerCase() === config.to.toLowerCase(),
        describeError: (error) => describeMailError(error, config),
      },
    };
  }

  const anySmtp = Object.entries(smtp.variables).some(([, value]) => value === "set");
  return {
    transport: null,
    provider: anySmtp ? "smtp" : null,
    problem: anySmtp
      ? smtp.problem
      : "No email provider is configured in this deployment. Set RESEND_API_KEY (recommended) or SMTP_USER + SMTP_PASSWORD, for the environment this deployment runs in.",
    variables,
  };
}
