import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { getRequest } from "@tanstack/react-start/server";
import { getSql } from "@/lib/db";
import { resolveSetupKey } from "@/server/setup-key";
import {
  clearAllStudioSessions,
  closeStudioSession,
  hasStudioSession,
  openStudioSession,
  sha256,
} from "@/server/session.server";

const scryptAsync = promisify(scrypt);

function clientBucket(): string {
  try {
    const request = getRequest();
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    const ip = forwarded || request.headers.get("x-real-ip")?.trim() || "local";
    return sha256(`studio:${ip}`).slice(0, 32);
  } catch {
    return "local";
  }
}

async function tooManyAttempts(): Promise<boolean> {
  const sql = await getSql();
  const id = clientBucket();
  const rows = await sql<{ failures: number }>`
    select failures from studio_attempts
    where id = ${id} and window_started_at > now() - interval '15 minutes'
  `;
  return (rows[0]?.failures ?? 0) >= 8;
}

async function noteFailure(): Promise<void> {
  const sql = await getSql();
  const id = clientBucket();
  await sql`delete from studio_attempts where window_started_at < now() - interval '1 day'`;
  await sql`
    insert into studio_attempts (id, failures, window_started_at)
    values (${id}, 1, now())
    on conflict (id) do update set
      failures = case
        when studio_attempts.window_started_at < now() - interval '15 minutes' then 1
        else studio_attempts.failures + 1
      end,
      window_started_at = case
        when studio_attempts.window_started_at < now() - interval '15 minutes' then now()
        else studio_attempts.window_started_at
      end
  `;
}

async function noteSuccess(): Promise<void> {
  const sql = await getSql();
  await sql`delete from studio_attempts where id = ${clientBucket()}`;
}

async function hashPassword(password: string, salt = randomBytes(16).toString("hex")) {
  const derived = (await scryptAsync(password, salt, 32)) as Buffer;
  return { hash: derived.toString("hex"), salt };
}

async function passwordMatches(password: string, hash: string, salt: string): Promise<boolean> {
  const derived = (await scryptAsync(password, salt, 32)) as Buffer;
  const expected = Buffer.from(hash, "hex");
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(expected, derived);
}

function setupKeyMatches(input: string, expected: string): boolean {
  const left = Buffer.from(sha256(input.trim()));
  const right = Buffer.from(sha256(expected));
  return timingSafeEqual(left, right);
}

function codeProblem(code: string): string | null {
  const value = code.trim();
  if (value.length < 8) return "Use an access code of at least 8 characters.";
  if (value.length > 80) return "That access code is too long.";
  if (/^peakswift$/i.test(value) || value.toLowerCase() === "password") {
    return "Choose a less obvious access code.";
  }
  return null;
}

async function gateRow() {
  const sql = await getSql();
  const rows = await sql<{ password_hash: string; password_salt: string }>`
    select password_hash, password_salt from studio_gate where id = 1
  `;
  return rows[0] ?? null;
}

export async function studioState(): Promise<"setup" | "login" | "ready"> {
  if (await hasStudioSession()) return "ready";
  const gate = await gateRow();
  return gate ? "login" : "setup";
}

async function saveCode(accessCode: string): Promise<string | null> {
  const problem = codeProblem(accessCode);
  if (problem) return problem;
  const { hash, salt } = await hashPassword(accessCode.trim());
  const sql = await getSql();
  await sql`
    insert into studio_gate (id, password_hash, password_salt)
    values (1, ${hash}, ${salt})
    on conflict (id) do update set password_hash = excluded.password_hash, password_salt = excluded.password_salt
  `;
  await clearAllStudioSessions();
  await openStudioSession();
  await noteSuccess();
  return null;
}

export async function claimStudio(setupKey: string, accessCode: string): Promise<string | null> {
  if (await tooManyAttempts()) return "Too many attempts. Wait a few minutes and try again.";
  const expected = resolveSetupKey();
  if (!expected) {
    return "Studio setup is not configured on this server.";
  }
  if (!setupKeyMatches(setupKey, expected)) {
    await noteFailure();
    return "That setup key isn't right.";
  }
  return saveCode(accessCode);
}

export async function loginStudio(accessCode: string): Promise<string | null> {
  if (await tooManyAttempts()) return "Too many attempts. Wait a few minutes and try again.";
  const gate = await gateRow();
  if (!gate) return "Set up the studio inbox first.";
  const ok = await passwordMatches(accessCode.trim(), gate.password_hash, gate.password_salt);
  if (!ok) {
    await noteFailure();
    return "That access code isn't right.";
  }
  await openStudioSession();
  await noteSuccess();
  return null;
}

export async function logoutStudio(): Promise<void> {
  await closeStudioSession();
}
