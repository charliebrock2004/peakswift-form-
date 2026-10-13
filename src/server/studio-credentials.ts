import { createHash, timingSafeEqual } from "node:crypto";

/**
 * Studio username + password from server-side environment variables:
 *   STUDIO_USERNAME (optional, defaults to "charliebrock")
 *   STUDIO_PASSWORD (required to turn this login on)
 * The password lives only in Vercel's encrypted settings, never in Git or the
 * browser bundle. When STUDIO_PASSWORD is not set, Studio falls back to the
 * original setup-key + access-code flow.
 */
export const DEFAULT_STUDIO_USERNAME = "charliebrock";

export type StudioCredentials = { username: string; password: string };

function clean(value: string | undefined): string {
  return (value ?? "")
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .trim();
}

export function studioCredentials(env: NodeJS.ProcessEnv = process.env): StudioCredentials | null {
  const password = clean(env.STUDIO_PASSWORD);
  if (!password) return null;
  return { username: clean(env.STUDIO_USERNAME) || DEFAULT_STUDIO_USERNAME, password };
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

/** Constant-time comparison; the username is not case-sensitive, the password is. */
export function credentialsMatch(username: string, password: string, expected: StudioCredentials): boolean {
  const userOk = timingSafeEqual(digest(clean(username).toLowerCase()), digest(expected.username.toLowerCase()));
  const passOk = timingSafeEqual(digest(password), digest(expected.password));
  return userOk && passOk;
}
