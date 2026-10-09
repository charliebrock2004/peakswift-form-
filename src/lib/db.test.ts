import assert from "node:assert/strict";
import test from "node:test";

// Regression: production on Vercel had no usable DATABASE_URL, silently fell
// back to the embedded preview database (not bundled for Vercel) and every
// submission failed with a generic 500. It must now fail with a clear,
// recognisable configuration error instead.
test("on Vercel without DATABASE_URL the database refuses the preview fallback with a clear error", async () => {
  delete process.env.DATABASE_URL;
  process.env.VERCEL = "1";
  const { getSql, dbSource } = await import("./db.ts");
  assert.equal(dbSource, "pglite");
  await assert.rejects(getSql(), (error: Error) => {
    assert.equal(error.name, "DatabaseNotConfiguredError");
    assert.match(error.message, /DATABASE_URL/);
    return true;
  });
});
