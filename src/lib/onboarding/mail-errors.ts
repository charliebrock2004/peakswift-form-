/**
 * Plain-language explanations for the SMTP failures Gmail actually returns,
 * so Studio can say what to fix instead of showing only a raw server reply.
 * Input is an error message that has already had credentials removed.
 */
const RULES: Array<[RegExp, string]> = [
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
