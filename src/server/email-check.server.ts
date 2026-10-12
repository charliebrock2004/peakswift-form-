import { HttpError } from "@/server/errors";
import { createSmtpSender, describeMailError, diagnoseMailConfig } from "@/server/mailer";
import { emailStatusFrom, runTestEmail, type EmailStatus, type TestEmailResult } from "@/server/email-check";
import { hasStudioSession } from "@/server/session.server";

const TEST_INTERVAL_MS = 30_000;
let lastTestAt = 0;

async function requireStudio(): Promise<void> {
  if (!(await hasStudioSession())) throw new HttpError(401, "Open Studio with your access code first.");
}

export async function studioEmailStatus(): Promise<EmailStatus> {
  await requireStudio();
  return emailStatusFrom(diagnoseMailConfig());
}

export async function studioSendTestEmail(): Promise<TestEmailResult> {
  await requireStudio();
  const now = Date.now();
  if (now - lastTestAt < TEST_INTERVAL_MS) {
    return { ok: false, error: "A test email was just sent. Wait 30 seconds before sending another." };
  }
  lastTestAt = now;
  const diagnosis = diagnoseMailConfig();
  const config = diagnosis.config;
  const result = await runTestEmail(
    config,
    diagnosis.problem,
    config ? createSmtpSender(config) : null,
    (error) => describeMailError(error, config),
  );
  if (result.ok) console.log(`[email-test] accepted for ${result.recipient}: ${result.response} message-id ${result.messageId}`);
  else console.error(`[email-test] failed: ${result.error}`);
  return result;
}
