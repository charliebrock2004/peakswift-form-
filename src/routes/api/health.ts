import { createFileRoute } from "@tanstack/react-router";

/**
 * /api/health: public callers get only { ok, commit }. A signed-in Studio
 * session, or `Authorization: Bearer <CRON_SECRET>`, gets the full diagnostic
 * report (states only, never secrets).
 */
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const [
          { healthReport },
          { sessionFromCookie },
          { cronAuthorised, HEALTH_HEADERS, publicHealth },
        ] = await Promise.all([
          import("@/server/health.server"),
          import("@/server/session.server"),
          import("@/server/health-public"),
        ]);
        const report = await healthReport();
        const full =
          cronAuthorised(request.headers.get("authorization"), process.env.CRON_SECRET) ||
          (await sessionFromCookie(request.headers.get("cookie")).catch(() => false));
        return Response.json(full ? report : publicHealth(report), {
          status: report.ok ? 200 : 503,
          headers: HEALTH_HEADERS,
        });
      },
    },
  },
});
