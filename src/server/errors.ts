export class HttpError extends Error {
  status: number;
  fields?: Record<string, string>;

  constructor(status: number, message: string, fields?: Record<string, string>) {
    super(message);
    this.status = status;
    this.fields = fields;
  }
}

const FALLBACK_CONTACT = "Please try again in a moment, or email PeakSwiftstudio@gmail.com.";

/**
 * JSON error response for the public submission routes. Known errors keep
 * their message and status; anything unexpected is logged with the route so
 * it can be found in the Vercel function logs, and the client is told plainly
 * that nothing was saved.
 */
export function errorResponse(route: string, error: unknown, fallback: string): Response {
  if (error instanceof HttpError) {
    return Response.json({ error: error.message, fields: error.fields ?? null }, { status: error.status });
  }
  // Matched by name so this module never imports the database code.
  if (error instanceof Error && error.name === "DatabaseNotConfiguredError") {
    console.error(`[${route}] ${error.message}`);
    return Response.json(
      { error: `Our enquiry form is temporarily unavailable. ${FALLBACK_CONTACT}`, code: "database_not_configured" },
      { status: 503 },
    );
  }
  console.error(`[${route}] failed:`, error);
  return Response.json({ error: `${fallback} ${FALLBACK_CONTACT}` }, { status: 500 });
}
