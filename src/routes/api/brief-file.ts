import { createFileRoute } from "@tanstack/react-router";
import { HttpError } from "@/server/errors";

function fail(error: unknown): Response {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  console.error(error);
  return Response.json({ error: "That file could not be saved. Please try again." }, { status: 500 });
}

export const Route = createFileRoute("/api/brief-file")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const form = await request.formData();
          const token = String(form.get("token") ?? "");
          const kind = String(form.get("kind") ?? "");
          const file = form.get("file");
          if (!(file instanceof File)) {
            return Response.json({ error: "Choose a file to upload." }, { status: 400 });
          }
          const { addBriefFile } = await import("@/server/briefs.server");
          const bytes = new Uint8Array(await file.arrayBuffer());
          const saved = await addBriefFile(token, kind, file.name, bytes);
          return Response.json(saved);
        } catch (error) {
          return fail(error);
        }
      },
    },
  },
});
