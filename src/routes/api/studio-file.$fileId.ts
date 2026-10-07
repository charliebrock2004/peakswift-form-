import { createFileRoute } from "@tanstack/react-router";
import { HttpError } from "@/server/errors";

export const Route = createFileRoute("/api/studio-file/$fileId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        try {
          const { readBriefFile } = await import("@/server/briefs.server");
          const file = await readBriefFile(params.fileId, request);
          const filename = file.filename.replace(/[^\w.\- ]/g, "_");
          const disposition = file.mime === "image/svg+xml" ? "attachment" : "inline";
          return new Response(Buffer.from(file.bytes), {
            headers: {
              "Content-Type": file.mime,
              "Content-Length": String(file.bytes.byteLength),
              "Content-Disposition": `${disposition}; filename="${filename}"`,
              "X-Content-Type-Options": "nosniff",
              "Content-Security-Policy": "default-src 'none'; sandbox",
              "Cross-Origin-Resource-Policy": "same-origin",
              "Referrer-Policy": "no-referrer",
              "Cache-Control": "private, no-store",
            },
          });
        } catch (error) {
          if (error instanceof HttpError) {
            return Response.json({ error: error.message }, { status: error.status });
          }
          console.error(error);
          return Response.json({ error: "Could not open that file." }, { status: 500 });
        }
      },
    },
  },
});
