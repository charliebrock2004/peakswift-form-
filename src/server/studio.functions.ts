import { createServerFn } from "@tanstack/react-start";

function text(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

export const getStudioState = createServerFn({ method: "GET" }).handler(async () => {
  const { studioState } = await import("@/server/studio-auth.server");
  const mode = await studioState();
  return { mode };
});

export const setupStudio = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({
    setupKey: text((input as { setupKey?: unknown })?.setupKey, 80),
    accessCode: text((input as { accessCode?: unknown })?.accessCode, 80),
  }))
  .handler(async ({ data }) => {
    const { claimStudio } = await import("@/server/studio-auth.server");
    const error = await claimStudio(data.setupKey, data.accessCode);
    return error ? { ok: false as const, error } : { ok: true as const };
  });

export const loginStudio = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({
    accessCode: text((input as { accessCode?: unknown })?.accessCode, 80),
  }))
  .handler(async ({ data }) => {
    const { loginStudio: signIn } = await import("@/server/studio-auth.server");
    const error = await signIn(data.accessCode);
    return error ? { ok: false as const, error } : { ok: true as const };
  });

export const logoutStudio = createServerFn({ method: "POST" }).handler(async () => {
  const { logoutStudio: signOut } = await import("@/server/studio-auth.server");
  await signOut();
  return { ok: true as const };
});

export const fetchBriefs = createServerFn({ method: "GET" }).handler(async () => {
  const { listBriefs } = await import("@/server/briefs.server");
  try {
    const briefs = await listBriefs();
    return { ok: true as const, briefs };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load briefs.";
    const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 500;
    return { ok: false as const, error: message, status };
  }
});

export const fetchBrief = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({ id: text((input as { id?: unknown })?.id, 80) }))
  .handler(async ({ data }) => {
    const { readBrief } = await import("@/server/briefs.server");
    try {
      const detail = await readBrief(data.id);
      return { ok: true as const, detail };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not open that brief.";
      return { ok: false as const, error: message };
    }
  });

export const updateBriefStatus = createServerFn({ method: "POST" })
  .validator((input: unknown) => ({
    id: text((input as { id?: unknown })?.id, 80),
    status: text((input as { status?: unknown })?.status, 20),
  }))
  .handler(async ({ data }) => {
    const { setBriefStatus } = await import("@/server/briefs.server");
    try {
      await setBriefStatus(data.id, data.status);
      return { ok: true as const };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not update that brief.";
      return { ok: false as const, error: message };
    }
  });
