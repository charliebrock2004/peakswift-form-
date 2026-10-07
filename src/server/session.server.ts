import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { getRequest, getRequestHeader, setResponseHeader } from "@tanstack/react-start/server";
import { getSql } from "@/lib/db";

const COOKIE = "ps_studio";
const MAX_AGE = 60 * 60 * 24 * 14;

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function timingSafeHex(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

function cookieValue(token: string, maxAge: number): string {
  const request = getRequest();
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const secure = forwarded === "https" || new URL(request.url).protocol === "https:";
  const parts = [
    `${COOKIE}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${maxAge}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export async function sessionFromCookie(cookieHeader: string | null): Promise<boolean> {
  const token = readCookie(cookieHeader, COOKIE);
  if (!token || token.length < 20) return false;
  const sql = await getSql();
  const rows = await sql<{ token_hash: string }>`
    select token_hash from studio_sessions
    where token_hash = ${sha256(token)} and expires_at > now()
    limit 1
  `;
  return rows.length > 0;
}

export async function hasStudioSession(): Promise<boolean> {
  return sessionFromCookie(getRequestHeader("cookie") ?? null);
}

export async function openStudioSession(): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const sql = await getSql();
  await sql`
    insert into studio_sessions (token_hash, expires_at)
    values (${sha256(token)}, now() + interval '14 days')
  `;
  setResponseHeader("Set-Cookie", cookieValue(token, MAX_AGE));
}

export async function closeStudioSession(): Promise<void> {
  const token = readCookie(getRequestHeader("cookie") ?? null, COOKIE);
  if (token) {
    const sql = await getSql();
    await sql`delete from studio_sessions where token_hash = ${sha256(token)}`;
  }
  setResponseHeader("Set-Cookie", cookieValue("", 0));
}

export async function clearAllStudioSessions(): Promise<void> {
  const sql = await getSql();
  await sql`delete from studio_sessions`;
}
