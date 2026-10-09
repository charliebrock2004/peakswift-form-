import { createFileRoute } from "@tanstack/react-router";
import { timingSafeEqual } from "node:crypto";

function authorised(header: string | null): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret || secret.length < 16 || !header) return false;
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/**
 * Called by the Vercel Cron in vercel.json. Re-sends notification emails that
 * failed or were saved before email was configured. Requires CRON_SECRET.
 */
export const Route = createFileRoute("/api/notify-retry")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!authorised(request.headers.get("authorization"))) {
          return Response.json({ error: "Not authorised." }, { status: 401 });
        }
        try {
          const { retryNotifications } = await import("@/server/briefs.server");
          const result = await retryNotifications(new URL(request.url).origin);
          return Response.json(result);
        } catch (error) {
          console.error(error);
          return Response.json({ error: "Retry failed." }, { status: 500 });
        }
      },
    },
  },
});
