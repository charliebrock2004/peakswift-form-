import { SELF_SEND_NOTE } from "../lib/onboarding/mail-errors.ts";
import type { EmailProviderKind, EmailSetup, EmailTransport } from "./email-transport.ts";

/** Which Vercel deployment answered: catches a domain serving a Preview build without Production variables. */
export type DeploymentInfo = { environment: string | null; branch: string | null; commit: string | null };

export function deploymentInfo(env: NodeJS.ProcessEnv = process.env): DeploymentInfo {
  return {
    environment: env.VERCEL_ENV?.trim() || null,
    branch: env.VERCEL_GIT_COMMIT_REF?.trim() || null,
    commit: env.VERCEL_GIT_COMMIT_SHA?.trim().slice(0, 7) || null,
  };
}

export type EmailStatus = {
  configured: boolean;
  provider: EmailProviderKind | null;
  problem: string | null;
  sender: string | null;
  recipient: string | null;
  sendsToItself: boolean;
  note: string | null;
  deployment: DeploymentInfo;
};

export type TestEmailResult =
  | { ok: true; provider: EmailProviderKind; response: string; messageId: string; sender: string; recipient: string; note: string | null }
  | { ok: false; error: string };

/** What Studio shows about email. Addresses and states only; never keys or passwords. */
export function emailStatusFrom(setup: EmailSetup, deployment: DeploymentInfo): EmailStatus {
  const transport = setup.transport;
  const sendsToItself = Boolean(transport?.sendsToItself);
  let problem = setup.problem;
  if (problem && deployment.environment && deployment.environment !== "production") {
    problem += ` This is a ${deployment.environment} deployment${deployment.branch ? ` (branch ${deployment.branch})` : ""}: Vercel only gives it variables enabled for "${deployment.environment === "preview" ? "Preview" : deployment.environment}".`;
  }
  return {
    configured: Boolean(transport),
    provider: setup.provider,
    problem,
    sender: transport?.from ?? null,
    recipient: transport?.to ?? null,
    sendsToItself,
    note: sendsToItself ? SELF_SEND_NOTE : null,
    deployment,
  };
}

/**
 * Sends one real test email through the same transport as client
 * notifications and reports the provider's exact answer.
 */
export async function runTestEmail(
  transport: EmailTransport | null,
  problem: string | null,
  now: Date = new Date(),
): Promise<TestEmailResult> {
  if (!transport) return { ok: false, error: problem ?? "Email is not configured." };
  const stamp = now.toISOString().replace("T", " ").slice(0, 19) + " UTC";
  try {
    const receipt = await transport.send({
      to: transport.to,
      from: transport.from,
      subject: `PeakSwift test email — ${stamp}`,
      text: [
        "This is a test from PeakSwift Studio.",
        "",
        "If you can read this, client enquiry notifications are being delivered to this inbox.",
        `Sent: ${stamp}`,
      ].join("\n"),
      html: `<p>This is a test from PeakSwift Studio.</p><p>If you can read this, client enquiry notifications are being delivered to this inbox.</p><p style="color:#6b6b6b">Sent: ${stamp}</p>`,
    });
    return {
      ok: true,
      provider: transport.kind,
      response: receipt.response,
      messageId: receipt.messageId,
      sender: transport.from,
      recipient: transport.to,
      note: transport.sendsToItself ? SELF_SEND_NOTE : null,
    };
  } catch (error) {
    return { ok: false, error: transport.describeError(error) };
  }
}
