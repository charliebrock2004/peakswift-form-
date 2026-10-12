import { HttpError } from "@/server/errors";
import { deploymentInfo, emailStatusFrom, runTestEmail, type EmailStatus, type TestEmailResult } from "@/server/email-check";
import { resolveEmailSetup } from "@/server/email-transport";
import { hasStudioSession } from "@/server/session.server";

const TEST_INTERVAL_MS = 30_000;
let lastTestAt = 0;

async function requireStudio(): Promise<void> {
  if (!(await hasStudioSession())) throw new HttpError(401, "Open Studio with your access code first.");
}

export async function studioEmailStatus(): Promise<EmailStatus> {
  await requireStudio();
  return emailStatusFrom(resolveEmailSetup(), deploymentInfo());
}

export async function studioSendTestEmail(): Promise<TestEmailResult> {
  await requireStudio();
  const now = Date.now();
  if (now - lastTestAt < TEST_INTERVAL_MS) {
    return { ok: false, error: "A test email was just sent. Wait 30 seconds before sending another." };
  }
  lastTestAt = now;
  const setup = resolveEmailSetup();
  const result = await runTestEmail(setup.transport, emailStatusFrom(setup, deploymentInfo()).problem);
  if (result.ok) console.log(`[email-test] ${result.provider} accepted for ${result.recipient}: ${result.response}`);
  else console.error(`[email-test] failed: ${result.error}`);
  return result;
}
