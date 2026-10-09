import { createFileRoute } from "@tanstack/react-router";

/** Open /api/health to see whether the form can accept enquiries. Reports states only, never secrets. */
export const Route = createFileRoute("/api/health")({
  server: {
    handlers: {
      GET: async () => {
        const { healthReport } = await import("@/server/health.server");
        const report = await healthReport();
        return Response.json(report, {
          status: report.ok ? 200 : 503,
          headers: { "Cache-Control": "no-store" },
        });
      },
    },
  },
});
