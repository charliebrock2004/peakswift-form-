/**
 * Plain-language explanations for the SMTP failures Gmail actually returns,
 * so Studio can say what to fix instead of showing only a raw server reply.
 * Input is an error message that has already had credentials removed.
 */
const RULES: Array<[RegExp, string]> = [
  [
    /only send testing emails to your own email|verify a domain/i,
    "Resend only delivers from onboarding@resend.dev to the address your Resend account was created with. Create the Resend account with PeakSwiftstudio@gmail.com (or verify your own domain at resend.com/domains and set RESEND_FROM).",
  ],
  [
    /Resend rejected the email \(HTTP (401|403)\)|API key is invalid|restricted_api_key|invalid_api_key/i,
    "Resend refused the API key. Create a new key at resend.com/api-keys (Sending access is enough), put it in RESEND_API_KEY in Vercel for Production and Preview, and redeploy.",
  ],
  [
    /Resend rejected the email \(HTTP 429\)|rate limit/i,
    "Resend's rate limit was hit. The email will be retried automatically.",
  ],
  [
    /Resend rejected the email \(HTTP 422\)/i,
    "Resend refused the message details (usually the sender address). Remove RESEND_FROM to use onboarding@resend.dev, or verify that domain in Resend.",
  ],
  [
    /Resend did not respond|Could not reach Resend/i,
    "Resend could not be reached from the server. The email will be retried automatically.",
  ],
  [
    /535|Username and Password not accepted|BadCredentials|Invalid login|authentication failed/i,
    "Gmail rejected the login. SMTP_PASSWORD must be a 16-character Google App Password created for the SMTP_USER account (with 2-Step Verification turned on) — not the normal Gmail password. Create a new App Password, update SMTP_PASSWORD in Vercel (Production), and redeploy.",
  ],
  [
    /534|Application-specific password required|WebLoginRequired|InvalidSecondFactor/i,
    "Gmail needs an App Password for this account. Turn on 2-Step Verification, create an App Password at myaccount.google.com/apppasswords, put it in SMTP_PASSWORD in Vercel (Production), and redeploy.",
  ],
  [
    /Daily user sending limit|5\.4\.5|quota/i,
    "Gmail's daily sending limit was reached for this account. Emails will go out again once the limit resets (usually within 24 hours).",
  ],
  [
    /5\.1\.1|550|553|No such user|Recipient not accepted|recipient address rejected/i,
    "The recipient address was refused. Check NOTIFY_TO (or remove it to use PeakSwiftstudio@gmail.com).",
  ],
  [
    /ETIMEDOUT|ECONNREFUSED|ECONNRESET|ESOCKET|ECONNECTION|EDNS|ENOTFOUND|Greeting never received|timeout|socket/i,
    "The mail server could not be reached. Check SMTP_HOST and SMTP_PORT (remove both to use Gmail's defaults). Pending emails are retried automatically.",
  ],
  [
    /\b4\d\d\b|4\.\d\.\d|temporar/i,
    "The mail server reported a temporary problem. The email will be retried automatically.",
  ],
];

export function explainMailError(message: string): string | null {
  for (const [pattern, hint] of RULES) if (pattern.test(message)) return hint;
  return null;
}

/** Gmail files messages an account sends to itself under Sent Mail, not the Inbox. */
export const SELF_SEND_NOTE =
  "This account is emailing itself, so Gmail files the notification under Sent Mail rather than the Inbox. Search Gmail with the rfc822msgid shown, or use a separate sender account in SMTP_USER/SMTP_PASSWORD to have it arrive in the Inbox.";
