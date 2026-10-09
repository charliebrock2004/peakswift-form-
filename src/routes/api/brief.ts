import { createFileRoute } from "@tanstack/react-router";
import { errorResponse } from "@/server/errors";

export const Route = createFileRoute("/api/brief")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const length = Number(request.headers.get("content-length") ?? "0");
          if (length > 500_000) return Response.json({ error: "That form is too large." }, { status: 413 });
          const body = (await request.json()) as { brief?: unknown; confirmed?: unknown };
          const { createBrief } = await import("@/server/briefs.server");
          const result = await createBrief(body.brief, body.confirmed === true);
          return Response.json(result);
        } catch (error) {
          return errorResponse("api/brief", error, "We couldn’t save your enquiry.");
        }
      },
    },
  },
});
