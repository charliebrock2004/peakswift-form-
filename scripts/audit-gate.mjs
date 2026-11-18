#!/usr/bin/env node
/**
 * Dependency advisory gate for CI. Replaces a bare `npm audit --audit-level=high`.
 *
 * - Any high or critical advisory fails the job, unless it has an exception in
 *   security/audit-exceptions.json with an id, package, reason, owner and an
 *   expiry date no more than 90 days ahead. An expired exception fails.
 * - An exception with scope "build-only" must prove it: if any of its markers
 *   (the package name plus distinctive strings from its source) appears in the
 *   deployed build output, the exception stops applying and the job fails.
 *   That is why CI runs this after `npm run build`.
 * - Moderate and low advisories are printed as warnings. They do not block,
 *   but a moderate in code that ships can matter more than a high in tooling.
 * - Exceptions that no longer match any advisory are reported so they can be
 *   deleted.
 *
 * If npm audit cannot produce a report (for example the registry is
 * unreachable), the gate fails rather than passing silently.
 *
 * Usage: node scripts/audit-gate.mjs [--report audit.json] [--exceptions file] [--output dir]
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const BLOCKING = new Set(["high", "critical"]);
const MAX_EXCEPTION_DAYS = 90;
const REQUIRED_FIELDS = ["id", "package", "reason", "owner", "expires", "scope"];

/** Unique advisories from an `npm audit --json` (v2) report. */
export function advisoriesFrom(report) {
  if (!report || typeof report !== "object" || !report.vulnerabilities) {
    throw new Error("npm audit did not return a usable report");
  }
  const byId = new Map();
  for (const entry of Object.values(report.vulnerabilities)) {
    for (const via of entry.via ?? []) {
      if (typeof via !== "object" || !via) continue;
      const id = /GHSA-[\w-]+/.exec(via.url ?? "")?.[0] ?? `npm-${via.source}`;
      const existing = byId.get(id);
      if (existing) existing.affects.add(entry.name);
      else
        byId.set(id, {
          id,
          package: via.name,
          title: via.title,
          severity: via.severity,
          range: via.range,
          url: via.url,
          affects: new Set([entry.name]),
        });
    }
  }
  return [...byId.values()];
}

function daysBetween(from, to) {
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

/** Problems with the exceptions file itself (missing fields, bad or distant dates). */
export function validateExceptions(exceptions, today) {
  const problems = [];
  if (!Array.isArray(exceptions)) return ["exceptions file must be a JSON array"];
  for (const [index, exception] of exceptions.entries()) {
    const label = exception?.id ?? `entry ${index}`;
    for (const field of REQUIRED_FIELDS) {
      if (typeof exception?.[field] !== "string" || !exception[field].trim())
        problems.push(`${label}: missing ${field}`);
    }
    if (exception?.scope && !["build-only", "runtime"].includes(exception.scope))
      problems.push(`${label}: scope must be "build-only" or "runtime"`);
    const expires = new Date(`${exception?.expires}T23:59:59Z`);
    if (Number.isNaN(expires.getTime()))
      problems.push(`${label}: expires must be a YYYY-MM-DD date`);
    else if (daysBetween(today, expires) > MAX_EXCEPTION_DAYS)
      problems.push(
        `${label}: expires more than ${MAX_EXCEPTION_DAYS} days ahead; review it sooner`,
      );
  }
  return problems;
}

function outputFiles(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) outputFiles(path, out);
    else if (/\.(js|mjs|cjs|json|html)$/.test(name)) out.push(path);
  }
  return out;
}

/** Markers of the exception's package found in the build output (by path or content). */
export function findInOutput(dir, markers) {
  const hits = [];
  for (const file of outputFiles(dir)) {
    const text = readFileSync(file, "utf8");
    for (const marker of markers) {
      if (file.includes(marker) || text.includes(marker)) hits.push({ marker, file });
    }
  }
  return hits;
}

/**
 * Decide the gate. Returns { failures, warnings, notes } as plain strings.
 * `outputDir` is the deployed build output, or null if there is none.
 */
export function evaluate({ advisories, exceptions, today, outputDir }) {
  const failures = [...validateExceptions(exceptions, today)];
  const warnings = [];
  const notes = [];
  const used = new Set();
  const list = Array.isArray(exceptions) ? exceptions : [];

  for (const advisory of advisories) {
    const where = `${advisory.package} ${advisory.range} — ${advisory.title} (${advisory.id})`;
    if (!BLOCKING.has(advisory.severity)) {
      warnings.push(`${advisory.severity}: ${where}`);
      continue;
    }
    const exception = list.find((entry) => entry?.id === advisory.id);
    if (!exception) {
      failures.push(`${advisory.severity}: ${where}. Upgrade, or add a reviewed exception.`);
      continue;
    }
    used.add(exception.id);
    const expires = new Date(`${exception.expires}T23:59:59Z`);
    if (expires < today) {
      failures.push(
        `${advisory.id}: exception expired on ${exception.expires}. Re-review it (owner: ${exception.owner}).`,
      );
      continue;
    }
    if (exception.scope === "build-only") {
      if (!outputDir) {
        failures.push(
          `${advisory.id}: exception is build-only but there is no build output to check. Run the build first.`,
        );
        continue;
      }
      const markers = [exception.package, ...(exception.markers ?? [])];
      const hits = findInOutput(outputDir, markers);
      if (hits.length) {
        failures.push(
          `${advisory.id}: exception says build-only, but ${hits[0].marker} appears in ${hits[0].file}. The package now ships, so the exception no longer applies.`,
        );
        continue;
      }
    }
    notes.push(`excepted until ${exception.expires}: ${where}. Reason: ${exception.reason}`);
  }

  for (const exception of list) {
    if (exception?.id && !used.has(exception.id))
      warnings.push(
        `exception ${exception.id} no longer matches any advisory; delete it from the exceptions file.`,
      );
  }
  return { failures, warnings, notes };
}

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : fallback;
}

function runAudit() {
  try {
    return execFileSync("npm", ["audit", "--json"], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (error) {
    // npm audit exits non-zero when it finds anything; the report is still on stdout.
    if (error.stdout) return error.stdout;
    throw error;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const reportPath = argument("--report");
  const exceptionsPath = argument("--exceptions", "security/audit-exceptions.json");
  const outputDir = argument("--output", ".vercel/output");
  const github = Boolean(process.env.GITHUB_ACTIONS);
  try {
    const report = JSON.parse(reportPath ? readFileSync(reportPath, "utf8") : runAudit());
    const exceptions = existsSync(exceptionsPath)
      ? JSON.parse(readFileSync(exceptionsPath, "utf8"))
      : [];
    const result = evaluate({
      advisories: advisoriesFrom(report),
      exceptions,
      today: new Date(),
      outputDir: existsSync(outputDir) ? outputDir : null,
    });
    for (const note of result.notes) console.log(`[audit-gate] ${note}`);
    for (const warning of result.warnings)
      console.log(
        github
          ? `::warning title=Dependency advisory::${warning}`
          : `[audit-gate] warning: ${warning}`,
      );
    for (const failure of result.failures)
      console.error(
        github ? `::error title=Dependency advisory::${failure}` : `[audit-gate] FAIL: ${failure}`,
      );
    if (result.failures.length) process.exit(1);
    console.log(
      `[audit-gate] passed: no unexcepted high or critical advisories (${result.notes.length} excepted, ${result.warnings.length} warning(s)).`,
    );
  } catch (error) {
    console.error(`[audit-gate] FAIL: could not check advisories: ${error.message}`);
    process.exit(1);
  }
}
