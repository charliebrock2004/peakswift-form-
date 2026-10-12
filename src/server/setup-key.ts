const LOCAL_SETUP_KEY = "PEAKSWIFT";
const MIN_LENGTH = 8;
const MAX_LENGTH = 200;

export type SetupKeyState = "set" | "missing" | "too-short" | "too-long";

export type SetupKeyDiagnosis = {
  /** The key to compare against, or null when Studio setup cannot run. */
  key: string | null;
  state: SetupKeyState;
  /** Why setup cannot run, naming the variable and environment. Never the value. */
  problem: string | null;
};

/** Removes surrounding whitespace/quotes and invisible characters added by copy-paste. */
export function normaliseSetupKey(value: string): string {
  return value
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .trim();
}

function onVercel(env: NodeJS.ProcessEnv): boolean {
  return env.VERCEL === "1" || Boolean(env.VERCEL_ENV);
}

function where(env: NodeJS.ProcessEnv): string {
  const environment = env.VERCEL_ENV?.trim();
  if (!environment) return "this deployment";
  const branch = env.VERCEL_GIT_COMMIT_REF?.trim();
  return `this ${environment} deployment${branch ? ` (branch ${branch})` : ""}`;
}

/**
 * Studio's first-run key. On Vercel STUDIO_SETUP_KEY must be set (8–200
 * characters); there is deliberately no fallback, so a public deployment can
 * never be claimed with a known default. Locally, without the variable, the
 * key is PEAKSWIFT so the preview keeps working.
 */
export function diagnoseSetupKey(env: NodeJS.ProcessEnv = process.env): SetupKeyDiagnosis {
  const raw = env.STUDIO_SETUP_KEY;
  const value = raw === undefined ? "" : normaliseSetupKey(raw);
  const fix =
    "In Vercel → Settings → Environment Variables, set STUDIO_SETUP_KEY to a private value of 8–200 characters for Production and Preview, then redeploy.";
  if (value) {
    if (value.length < MIN_LENGTH) {
      return { key: null, state: "too-short", problem: `STUDIO_SETUP_KEY is shorter than ${MIN_LENGTH} characters in ${where(env)}. ${fix}` };
    }
    if (value.length > MAX_LENGTH) {
      return { key: null, state: "too-long", problem: `STUDIO_SETUP_KEY is longer than ${MAX_LENGTH} characters in ${where(env)}. ${fix}` };
    }
    return { key: value, state: "set", problem: null };
  }
  if (onVercel(env)) {
    return { key: null, state: "missing", problem: `STUDIO_SETUP_KEY is not set in ${where(env)}. ${fix}` };
  }
  return { key: LOCAL_SETUP_KEY, state: "missing", problem: null };
}

export function resolveSetupKey(env: NodeJS.ProcessEnv = process.env): string | null {
  return diagnoseSetupKey(env).key;
}
