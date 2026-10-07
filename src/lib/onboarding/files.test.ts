import assert from "node:assert/strict";
import test from "node:test";
import { isSafeSvg, safeFilename, sniffImage } from "./files.ts";

test("sniffs the image types the form accepts", () => {
  assert.equal(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0x00])), "image/jpeg");
  assert.equal(sniffImage(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), "image/png");
  const webp = new Uint8Array(12);
  webp.set([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  assert.equal(sniffImage(webp), "image/webp");
  assert.equal(sniffImage(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'></svg>")), "image/svg+xml");
  assert.equal(sniffImage(new TextEncoder().encode("not an image")), null);
});

test("rejects svg files that can run script", () => {
  const safe = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10z"/></svg>`;
  assert.equal(isSafeSvg(safe), true);
  assert.equal(isSafeSvg(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`), false);
  assert.equal(isSafeSvg(`<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"></svg>`), false);
});

test("stored filenames keep a sniffed extension", () => {
  assert.equal(safeFilename("../../logo.svg", "image/png"), "logo.png");
  assert.equal(safeFilename("team photo.JPG", "image/jpeg"), "team photo.jpg");
});
