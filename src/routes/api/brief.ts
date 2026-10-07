import { createFileRoute } from "@tanstack/react-router";
import { HttpError } from "@/server/errors";

function fail(error: unknown): Response {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message, fields: error.fields ?? null }, { status: error.status });
  }
  console.error(error);
  return Response.json({ error: "Something went wrong. Please try again." }, { status: 500 });
}

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
          return fail(error);
        }
      },
    },
  },
});
