import { createFileRoute } from "@tanstack/react-router";
import { errorResponse } from "@/server/errors";

export const Route = createFileRoute("/api/brief-finalise")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as { token?: unknown };
          const { finaliseBrief } = await import("@/server/briefs.server");
          const result = await finaliseBrief(typeof body.token === "string" ? body.token : "", new URL(request.url).origin);
          return Response.json(result);
        } catch (error) {
          return errorResponse("api/brief-finalise", error, "We couldn’t submit your enquiry.");
        }
      },
    },
  },
});
