import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { advisoriesFrom, evaluate, validateExceptions } from "./audit-gate.mjs";

const TODAY = new Date("2026-11-18T12:00:00Z");

const advisory = (overrides = {}) => ({
  source: 1,
  name: "picomatch",
  title: "ReDoS",
  severity: "high",
  range: "<=4.0.7",
  url: "https://github.com/advisories/GHSA-aaaa-bbbb-cccc",
  ...overrides,
});

const report = (...vias) => ({
  vulnerabilities: {
    picomatch: { name: "picomatch", severity: "high", via: vias },
    vite: { name: "vite", severity: "high", via: ["picomatch"] },
  },
});

const exception = (overrides = {}) => ({
  id: "GHSA-aaaa-bbbb-cccc",
  package: "picomatch",
  scope: "build-only",
  markers: ["POSIX_REGEX_SOURCE"],
  reason: "build tooling only",
  owner: "Charlie",
  expires: "2026-12-18",
  ...overrides,
});

function cleanOutput() {
  const dir = mkdtempSync(join(tmpdir(), "audit-out-"));
  mkdirSync(join(dir, "functions"));
  writeFileSync(join(dir, "functions", "server.mjs"), "export const ok = 1;");
  return dir;
}

describe("audit gate", () => {
  it("reads each advisory once, however many packages it reaches", () => {
    const list = advisoriesFrom(report(advisory()));
    assert.equal(list.length, 1);
    assert.equal(list[0].id, "GHSA-aaaa-bbbb-cccc");
  });

  it("refuses a missing or broken report instead of passing", () => {
    assert.throws(() => advisoriesFrom({ error: { code: "ENOTFOUND" } }));
    assert.throws(() => advisoriesFrom(null));
  });

  it("fails a high advisory with no exception", () => {
    const result = evaluate({
      advisories: advisoriesFrom(report(advisory())),
      exceptions: [],
      today: TODAY,
      outputDir: cleanOutput(),
    });
    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0], /Upgrade, or add a reviewed exception/);
  });

  it("fails a critical advisory with no exception", () => {
    const result = evaluate({
      advisories: advisoriesFrom(report(advisory({ severity: "critical" }))),
      exceptions: [],
      today: TODAY,
      outputDir: cleanOutput(),
    });
    assert.equal(result.failures.length, 1);
  });

  it("passes a build-only exception when the package is not in the output", () => {
    const result = evaluate({
      advisories: advisoriesFrom(report(advisory())),
      exceptions: [exception()],
      today: TODAY,
      outputDir: cleanOutput(),
    });
    assert.deepEqual(result.failures, []);
    assert.equal(result.notes.length, 1);
  });

  it("fails a build-only exception when a marker appears in the output", () => {
    const dir = cleanOutput();
    writeFileSync(
      join(dir, "functions", "chunk.mjs"),
      "const t={POSIX_REGEX_SOURCE:{alnum:'a-zA-Z0-9'}};",
    );
    const result = evaluate({
      advisories: advisoriesFrom(report(advisory())),
      exceptions: [exception()],
      today: TODAY,
      outputDir: dir,
    });
    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0], /no longer applies/);
  });

  it("fails a build-only exception when the package name is in an output path", () => {
    const dir = cleanOutput();
    mkdirSync(join(dir, "functions", "node_modules", "picomatch"), { recursive: true });
    writeFileSync(
      join(dir, "functions", "node_modules", "picomatch", "index.js"),
      "module.exports = 1;",
    );
    const result = evaluate({
      advisories: advisoriesFrom(report(advisory())),
      exceptions: [exception()],
      today: TODAY,
      outputDir: dir,
    });
    assert.equal(result.failures.length, 1);
  });

  it("fails a build-only exception when there is no build to check", () => {
    const result = evaluate({
      advisories: advisoriesFrom(report(advisory())),
      exceptions: [exception()],
      today: TODAY,
      outputDir: null,
    });
    assert.match(result.failures[0], /Run the build first/);
  });

  it("fails once the exception has expired", () => {
    const result = evaluate({
      advisories: advisoriesFrom(report(advisory())),
      exceptions: [exception({ expires: "2026-11-17" })],
      today: TODAY,
      outputDir: cleanOutput(),
    });
    assert.match(result.failures.join("\n"), /expired on 2026-11-17/);
  });

  it("still honours an exception on its expiry day", () => {
    const result = evaluate({
      advisories: advisoriesFrom(report(advisory())),
      exceptions: [exception({ expires: "2026-11-18" })],
      today: TODAY,
      outputDir: cleanOutput(),
    });
    assert.deepEqual(result.failures, []);
  });

  it("does not let an exception for one advisory cover another", () => {
    const other = advisory({
      url: "https://github.com/advisories/GHSA-zzzz-yyyy-xxxx",
      title: "Other",
    });
    const result = evaluate({
      advisories: advisoriesFrom(report(advisory(), other)),
      exceptions: [exception()],
      today: TODAY,
      outputDir: cleanOutput(),
    });
    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0], /GHSA-zzzz-yyyy-xxxx/);
  });

  it("warns on moderate advisories without blocking", () => {
    const result = evaluate({
      advisories: advisoriesFrom(report(advisory({ severity: "moderate" }))),
      exceptions: [],
      today: TODAY,
      outputDir: cleanOutput(),
    });
    assert.deepEqual(result.failures, []);
    assert.match(result.warnings[0], /^moderate:/);
  });

  it("reports an exception that no longer matches anything", () => {
    const result = evaluate({
      advisories: [],
      exceptions: [exception()],
      today: TODAY,
      outputDir: cleanOutput(),
    });
    assert.deepEqual(result.failures, []);
    assert.match(result.warnings[0], /no longer matches/);
  });

  it("rejects exceptions without a reason, owner or valid expiry", () => {
    assert.match(validateExceptions([exception({ reason: "" })], TODAY).join(), /missing reason/);
    assert.match(
      validateExceptions([exception({ owner: undefined })], TODAY).join(),
      /missing owner/,
    );
    assert.match(validateExceptions([exception({ expires: "soon" })], TODAY).join(), /YYYY-MM-DD/);
    assert.match(
      validateExceptions([exception({ scope: "whatever" })], TODAY).join(),
      /scope must be/,
    );
    assert.match(validateExceptions({}, TODAY).join(), /JSON array/);
  });

  it("rejects an exception that expires more than 90 days ahead", () => {
    assert.match(
      validateExceptions([exception({ expires: "2027-06-01" })], TODAY).join(),
      /more than 90 days/,
    );
  });

  it("an invalid exceptions file fails the gate even with no advisories", () => {
    const result = evaluate({
      advisories: [],
      exceptions: [exception({ owner: "" })],
      today: TODAY,
      outputDir: cleanOutput(),
    });
    assert.equal(result.failures.length, 1);
  });
});
