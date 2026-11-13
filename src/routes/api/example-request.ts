import { createFileRoute } from "@tanstack/react-router";
import { errorResponse } from "@/server/errors";

/**
 * Starts a free website homepage example request. Files then go to
 * /api/brief-file and the submission is completed by /api/brief-finalise,
 * exactly like the full brief, so uploads, retries and the idempotent submit
 * behave the same.
 */
export const Route = createFileRoute("/api/example-request")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const site = request.headers.get("sec-fetch-site");
          if (site && site !== "same-origin" && site !== "none") {
            return Response.json({ error: "Please use the form on this site." }, { status: 403 });
          }
          const length = Number(request.headers.get("content-length") ?? "0");
          if (length > 100_000) return Response.json({ error: "That form is too large." }, { status: 413 });
          const body = (await request.json()) as { request?: unknown; confirmed?: unknown; campaign?: unknown; website_url?: unknown };
          // Honeypot: a field people never see. A bot that fills it is told "thanks" and nothing is stored.
          if (typeof body.website_url === "string" && body.website_url.trim()) {
            return Response.json({ token: "", reference: "", ignored: true });
          }
          const { createExampleRequest } = await import("@/server/briefs.server");
          const result = await createExampleRequest(body.request, body.confirmed === true, body.campaign);
          return Response.json(result);
        } catch (error) {
          return errorResponse("api/example-request", error, "We couldn’t save your request.");
        }
      },
    },
  },
});
