/**
 * The free website homepage example request — pure, shared by the form, the
 * API, Studio, the notification email and the delivery to PeakSwift Leads.
 *
 * Deliberately short: five required answers a business owner knows without
 * looking anything up, and a handful of optional ones. Everything is trimmed
 * and length-limited; unknown keys are dropped.
 *
 * The offer is a free EXAMPLE of a possible homepage — never a free, working
 * website — and every piece of copy here says so.
 */
import type { SummaryRow, SummarySection } from "./model.ts";

export const FORM_KIND = "free_example" as const;

export type ExampleRequest = {
  businessName: string;
  contactName: string;
  email: string;
  trade: string;
  area: string;
  existingWebsite: string;
  social: string;
  description: string;
  services: string;
  instructions: string;
};

export const EXAMPLE_LIMITS: Record<keyof ExampleRequest, number> = {
  businessName: 200,
  contactName: 200,
  email: 200,
  trade: 160,
  area: 200,
  existingWebsite: 300,
  social: 600,
  description: 1200,
  services: 1200,
  instructions: 2000,
};

export const EXAMPLE_STEPS = [
  { id: "business", title: "Your business", lede: "The basics, so the example is about your business. Five quick answers." },
  { id: "details", title: "What to show", lede: "All optional. A line or two helps the example feel like yours." },
  { id: "images", title: "Logo & photos", lede: "Optional. Real photos of your work make the biggest difference." },
  { id: "review", title: "Check & send", lede: "Make sure everything looks right, then send it over." },
] as const;

export const EXAMPLE_REVIEW_STEP = EXAMPLE_STEPS.length - 1;

const STEP_KEYS: (keyof ExampleRequest)[][] = [
  ["businessName", "contactName", "email", "trade", "area"],
  ["existingWebsite", "social", "description", "services", "instructions"],
  [],
  [],
];

/** Shown on the form and stored with every request, so we know which wording was agreed to. */
export const PRIVACY_NOTICE_VERSION = "free-example-2026-11";

export const PRIVACY_NOTICE = [
  "PeakSwift Studio (Charlie Brock, Perthshire) uses the details and images you send only to prepare your free homepage example, send it to you and talk to you about it.",
  "We rely on your request to do that. We won’t add you to a mailing list or send you unrelated marketing because you asked for an example.",
  "Your answers and files are stored privately and are never published. We keep them for up to 12 months unless you become a client, then delete them. Ask us to delete them sooner, or to see what we hold, at peakswiftstudio@gmail.com.",
  "You can complain to the Information Commissioner’s Office (ico.org.uk) if you’re unhappy with how we handle your data.",
];

export const OFFER_SUMMARY =
  "A free example of how your website homepage could look — a design preview to help you decide, not a complete working website. There’s no obligation and no cost.";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const CAMPAIGN_REF = /^[A-Za-z0-9_-]{4,64}$/;

export function emptyExampleRequest(): ExampleRequest {
  return {
    businessName: "",
    contactName: "",
    email: "",
    trade: "",
    area: "",
    existingWebsite: "",
    social: "",
    description: "",
    services: "",
    instructions: "",
  };
}

const MULTILINE: (keyof ExampleRequest)[] = ["social", "description", "services", "instructions"];

function clean(value: unknown, max: number, multiline: boolean): string {
  if (typeof value !== "string") return "";
  let text = value.split("\u0000").join("").replace(/\r\n?/g, "\n");
  if (!multiline) text = text.replace(/\s+/g, " ");
  return text.trim().slice(0, max).trim();
}

/** Untrusted input (draft, API body, stored payload) → a clean request. */
export function mergeExampleRequest(input: unknown): ExampleRequest {
  const base = emptyExampleRequest();
  if (!input || typeof input !== "object") return base;
  const raw = input as Record<string, unknown>;
  for (const key of Object.keys(EXAMPLE_LIMITS) as (keyof ExampleRequest)[]) {
    base[key] = clean(raw[key], EXAMPLE_LIMITS[key], MULTILINE.includes(key));
  }
  base.email = base.email.toLowerCase();
  return base;
}

/** A campaign reference from the email link, or "" when absent or malformed. Never a person. */
export function cleanCampaignRef(value: unknown): string {
  const text = typeof value === "string" ? value.trim() : "";
  return CAMPAIGN_REF.test(text) ? text : "";
}

function websiteProblem(value: string): string | null {
  if (!value) return null;
  const candidate = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  try {
    const url = new URL(candidate);
    if (!url.hostname.includes(".")) return "Check the website address — for example yourbusiness.co.uk.";
    return null;
  } catch {
    return "Check the website address — for example yourbusiness.co.uk.";
  }
}

export function exampleErrors(request: ExampleRequest): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!request.businessName) errors.businessName = "Add your business name.";
  if (!request.contactName) errors.contactName = "Add your name.";
  if (!request.email) errors.email = "Add an email address so we can send the example.";
  else if (!EMAIL.test(request.email)) errors.email = "Check the email address — it should look like name@example.com.";
  if (!request.trade) errors.trade = "Tell us your trade or type of business.";
  if (!request.area) errors.area = "Add your town or the area you cover.";
  const site = websiteProblem(request.existingWebsite);
  if (site) errors.existingWebsite = site;
  return errors;
}

export function exampleErrorsForStep(step: number, request: ExampleRequest): Record<string, string> {
  const keys = STEP_KEYS[step] ?? [];
  return Object.fromEntries(Object.entries(exampleErrors(request)).filter(([key]) => keys.includes(key as keyof ExampleRequest)));
}

export function firstExampleStepForErrors(errors: Record<string, string>): number {
  const keys = Object.keys(errors);
  const index = STEP_KEYS.findIndex((group) => group.some((key) => keys.includes(key)));
  return index < 0 ? 0 : index;
}

export function validateExampleRequest(input: unknown): { ok: true; request: ExampleRequest } | { ok: false; errors: Record<string, string> } {
  const request = mergeExampleRequest(input);
  const errors = exampleErrors(request);
  return Object.keys(errors).length ? { ok: false, errors } : { ok: true, request };
}

/** One description of the answers for review, Studio, copy text and email. */
export function exampleSections(request: ExampleRequest): SummarySection[] {
  return [
    {
      step: 0,
      title: "Business & contact",
      rows: [
        { label: "Business name", value: request.businessName },
        { label: "Contact name", value: request.contactName },
        { label: "Email", value: request.email },
        { label: "Trade or business type", value: request.trade },
        { label: "Town / service area", value: request.area },
      ],
    },
    {
      step: 1,
      title: "What to show",
      rows: [
        { label: "Existing website", value: request.existingWebsite },
        { label: "Facebook or Instagram", value: request.social },
        { label: "About the business", value: request.description },
        { label: "Services to showcase", value: request.services },
        { label: "Anything else", value: request.instructions },
      ],
    },
  ];
}

export function exampleRows(request: ExampleRequest): SummaryRow[] {
  return exampleSections(request).flatMap((section) => section.rows);
}

export function exampleToText(request: ExampleRequest, extras?: { reference?: string; files?: string[] }): string {
  const lines: string[] = ["FREE WEBSITE HOMEPAGE EXAMPLE REQUEST"];
  if (extras?.reference) lines.push(`Reference: ${extras.reference}`);
  lines.push("");
  for (const section of exampleSections(request)) {
    lines.push(section.title.toUpperCase());
    for (const row of section.rows) lines.push(`${row.label}: ${row.value.trim() || "—"}`);
    lines.push("");
  }
  if (extras?.files) lines.push("FILES", ...(extras.files.length ? extras.files : ["—"]));
  return lines.join("\n").trim();
}
