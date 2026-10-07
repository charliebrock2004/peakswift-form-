const LOCAL_SETUP_KEY = "PEAKSWIFT";

/**
 * Studio's first-run key. Production (Vercel) must set STUDIO_SETUP_KEY.
 * The local fallback exists only so this preview keeps the existing setup
 * flow; it is never used once the app is deployed.
 */
export function resolveSetupKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const fromEnv = env.STUDIO_SETUP_KEY?.trim();
  if (fromEnv) {
    if (fromEnv.length < 8 || fromEnv.length > 200) return null;
    return fromEnv;
  }
  if (env.VERCEL === "1" || env.VERCEL_ENV) return null;
  return LOCAL_SETUP_KEY;
}
