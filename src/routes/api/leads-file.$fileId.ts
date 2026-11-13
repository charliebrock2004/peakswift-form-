import { createFileRoute } from "@tanstack/react-router";
import { HttpError } from "@/server/errors";

/**
 * One free example request image, for PeakSwift Leads' server only.
 *
 * Not reachable from a browser session: the request must carry a valid
 * signature (FORMS_INTEGRATION_SECRET, five-minute window, bound to this exact
 * path). Leads proxies the bytes to its owner behind its own login, so the
 * file never gets a public URL.
 */
export const Route = createFileRoute("/api/leads-file/$fileId")({
  server: {
    handlers: {
      GET: async ({ request, params }) => {
        const { secretList, verifySignature, SIGNATURE_HEADER, TIMESTAMP_HEADER } = await import("@/lib/integration/signing");
        const url = new URL(request.url);
        const verdict = verifySignature({
          secrets: secretList(process.env.FORMS_INTEGRATION_SECRET),
          signature: request.headers.get(SIGNATURE_HEADER),
          timestamp: request.headers.get(TIMESTAMP_HEADER),
          method: "GET",
          path: url.pathname + url.search,
          body: "",
        });
        if (!verdict.ok) {
          const status = verdict.reason === "not_configured" ? 503 : 401;
          return Response.json({ error: status === 503 ? "Not configured." : "Not authorised." }, { status, headers: { "cache-control": "no-store" } });
        }
        try {
          const { readExampleFileForLeads } = await import("@/server/briefs.server");
          const file = await readExampleFileForLeads(params.fileId);
          return new Response(Buffer.from(file.bytes), {
            headers: {
              "Content-Type": file.mime,
              "Content-Length": String(file.bytes.byteLength),
              "X-Filename": encodeURIComponent(file.filename),
              "X-Content-Type-Options": "nosniff",
              "Content-Security-Policy": "default-src 'none'; sandbox",
              "Cache-Control": "private, no-store",
            },
          });
        } catch (error) {
          if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
          console.error(error);
          return Response.json({ error: "Could not open that file." }, { status: 500 });
        }
      },
    },
  },
});
