import { createFileRoute } from "@tanstack/react-router";
import { HttpError } from "@/server/errors";

export const Route = createFileRoute("/api/brief-finalise")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json()) as { token?: unknown };
          const { finaliseBrief } = await import("@/server/briefs.server");
          const result = await finaliseBrief(typeof body.token === "string" ? body.token : "");
          return Response.json(result);
        } catch (error) {
          if (error instanceof HttpError) {
            return Response.json({ error: error.message }, { status: error.status });
          }
          console.error(error);
          return Response.json({ error: "Could not send the form. Please try again." }, { status: 500 });
        }
      },
    },
  },
});
