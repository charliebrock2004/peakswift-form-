export const STYLE_OPTIONS = ["Modern", "Professional", "Minimal", "Bold", "Traditional", "Luxury", "Not sure"] as const;

export const FEATURE_OPTIONS = [
  "Contact form",
  "Photo gallery",
  "Booking system",
  "Online shop",
  "Customer reviews",
  "Blog or news",
  "Map and directions",
] as const;

export const TIMESCALE_OPTIONS = ["As soon as possible", "Within a month", "1–3 months", "No rush", "Not sure"] as const;

export const BUDGET_OPTIONS = ["Under £500", "£500–£1,000", "£1,000–£2,500", "Over £2,500", "Not sure"] as const;

/** Stored kinds. The current form only collects logo and work; the rest remain for older briefs. */
export const FILE_KINDS = ["logo", "work", "team", "other", "review"] as const;

export type StyleChoice = (typeof STYLE_OPTIONS)[number];
export type FeatureChoice = (typeof FEATURE_OPTIONS)[number];
export type Timescale = (typeof TIMESCALE_OPTIONS)[number];
export type Budget = (typeof BUDGET_OPTIONS)[number];
export type FileKind = (typeof FILE_KINDS)[number];

export type Service = {
  id: string;
  name: string;
};

export type Brief = {
  // 1. Business and contact details
  businessName: string;
  contactName: string;
  email: string;
  phone: string;
  area: string;
  // 2. About the business
  whatYouDo: string;
  services: Service[];
  whatMakesDifferent: string;
  openingHours: string;
  // 3. Website design
  style: StyleChoice | "";
  preferredColours: string;
  example1: string;
  example2: string;
  features: FeatureChoice[];
  featuresOther: string;
  // 4. Existing materials (files are uploaded separately)
  existingWebsite: string;
  socialLinks: string;
  domainGbp: string;
  // 5. Final details
  anythingElse: string;
  timescale: Timescale | "";
  budget: Budget | "";
};

export const STEPS = [
  { id: "contact", title: "Business & contact", lede: "Who the website is for and how to reach you." },
  { id: "about", title: "About the business", lede: "A sentence or two is plenty." },
  { id: "design", title: "Website design", lede: "A rough direction is enough. We’ll refine it together." },
  { id: "materials", title: "Existing materials", lede: "Optional. Skip this if you don’t have them to hand — you can send them later." },
  { id: "final", title: "Final details", lede: "Nearly done." },
  { id: "review", title: "Review & submit", lede: "Check your answers, then send." },
] as const;

export const REVIEW_STEP = STEPS.length - 1;

const STEP_KEYS: string[][] = [
  ["businessName", "contactName", "email", "phone", "area"],
  ["whatYouDo", "services", "whatMakesDifferent", "openingHours"],
  ["style", "preferredColours", "example1", "example2", "features", "featuresOther"],
  ["existingWebsite", "socialLinks", "domainGbp"],
  ["anythingElse", "timescale", "budget"],
  [],
];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const LIMITS = {
  businessName: 200,
  contactName: 200,
  email: 200,
  phone: 40,
  area: 300,
  whatYouDo: 1500,
  whatMakesDifferent: 2000,
  openingHours: 500,
  preferredColours: 300,
  example1: 300,
  example2: 300,
  featuresOther: 500,
  existingWebsite: 300,
  socialLinks: 1000,
  domainGbp: 500,
  anythingElse: 4000,
} as const;

type TextKey = keyof typeof LIMITS;

export function emptyBrief(): Brief {
  return {
    businessName: "",
    contactName: "",
    email: "",
    phone: "",
    area: "",
    whatYouDo: "",
    services: [1, 2, 3].map((n) => ({ id: `service-${n}`, name: "" })),
    whatMakesDifferent: "",
    openingHours: "",
    style: "",
    preferredColours: "",
    example1: "",
    example2: "",
    features: [],
    featuresOther: "",
    existingWebsite: "",
    socialLinks: "",
    domainGbp: "",
    anythingElse: "",
    timescale: "",
    budget: "",
  };
}

function clip(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.split("\u0000").join("").trim().slice(0, max).trim();
}

function oneOf<T extends string>(options: readonly T[], value: unknown): T | "" {
  return typeof value === "string" && (options as readonly string[]).includes(value) ? (value as T) : "";
}

function joinLines(values: unknown[]): string {
  return values
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter(Boolean)
    .join("\n");
}

/**
 * Turns untrusted input (a saved draft, an API body or a stored payload) into a
 * clean Brief. Unknown keys are dropped. Answers from the earlier, longer form
 * are carried into their new equivalents so old drafts and briefs still read.
 */
export function mergeBrief(input: unknown): Brief {
  const base = emptyBrief();
  if (!input || typeof input !== "object") return base;
  const raw = input as Record<string, unknown>;
  const legacy: Partial<Record<TextKey, unknown>> = {
    contactName: raw.yourName,
    area: [raw.areasCovered, raw.address].find((value) => typeof value === "string" && value.trim()),
    socialLinks: joinLines([raw.facebook, raw.instagram, raw.tiktok, raw.otherSocial]) || undefined,
    domainGbp: joinLines([raw.domainName, raw.gbpUrl]) || undefined,
  };
  (Object.keys(LIMITS) as TextKey[]).forEach((key) => {
    const value = typeof raw[key] === "string" && (raw[key] as string).trim() ? raw[key] : legacy[key];
    base[key] = clip(value, LIMITS[key]);
  });
  base.style = oneOf(STYLE_OPTIONS, raw.style) || (Array.isArray(raw.styles) ? oneOf(STYLE_OPTIONS, raw.styles[0]) : "");
  base.timescale = oneOf(TIMESCALE_OPTIONS, raw.timescale);
  base.budget = oneOf(BUDGET_OPTIONS, raw.budget);
  if (Array.isArray(raw.features)) {
    const picked = raw.features.map((item) => oneOf(FEATURE_OPTIONS, item)).filter((item): item is FeatureChoice => item !== "");
    base.features = [...new Set(picked)];
  }
  if (Array.isArray(raw.services)) {
    const services = raw.services.slice(0, 40).map((item, index) => {
      const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      return {
        id: clip(row.id, 80) || `service-${index + 1}`,
        name: clip(row.name, 160),
      };
    });
    if (services.length > 0) base.services = services;
  }
  return base;
}

function phoneProblem(value: string): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return "Check the phone number — it looks too short or too long.";
  return null;
}

export function briefErrors(brief: Brief): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!brief.businessName) errors.businessName = "Add your business name.";
  if (!brief.contactName) errors.contactName = "Add your name.";
  if (!brief.email) errors.email = "Add an email address so we can reply.";
  else if (!EMAIL.test(brief.email)) errors.email = "Check the email address — it should look like name@example.com.";
  const phone = phoneProblem(brief.phone);
  if (phone) errors.phone = phone;
  if (!brief.whatYouDo) errors.whatYouDo = "Tell us briefly what the business does.";
  return errors;
}

function keyInStep(key: string, step: number): boolean {
  return (STEP_KEYS[step] ?? []).some((prefix) => key === prefix || key.startsWith(`${prefix}.`));
}

export function errorsForStep(step: number, brief: Brief): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, message] of Object.entries(briefErrors(brief))) {
    if (keyInStep(key, step)) out[key] = message;
  }
  return out;
}

export function firstStepForErrors(errors: Record<string, string>): number {
  const keys = Object.keys(errors);
  for (let index = 0; index < STEP_KEYS.length; index += 1) {
    if (keys.some((key) => keyInStep(key, index))) return index;
  }
  return 0;
}

export function normalizeBrief(brief: Brief): Brief {
  return {
    ...brief,
    services: brief.services.filter((service) => service.name),
    features: [...new Set(brief.features)],
  };
}

export function validateBrief(input: unknown): { ok: true; brief: Brief } | { ok: false; errors: Record<string, string> } {
  const brief = mergeBrief(input);
  const errors = briefErrors(brief);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, brief: normalizeBrief(brief) };
}

export const NOT_PROVIDED = "Not provided";

export function display(value: string): string {
  return value.trim() ? value.trim() : NOT_PROVIDED;
}

export type SummaryRow = { label: string; value: string };
export type SummarySection = { step: number; title: string; rows: SummaryRow[]; list?: { label: string; items: string[] } };

/**
 * One description of the answers, shared by the review screen, Studio, the
 * copy-to-clipboard text and the notification email so they never drift.
 */
export function briefSections(brief: Brief): SummarySection[] {
  const services = brief.services.map((service) => service.name.trim()).filter(Boolean);
  const features = [...brief.features, ...(brief.featuresOther ? [brief.featuresOther] : [])];
  return [
    {
      step: 0,
      title: "Business & contact",
      rows: [
        { label: "Business name", value: brief.businessName },
        { label: "Contact name", value: brief.contactName },
        { label: "Email", value: brief.email },
        { label: "Phone", value: brief.phone },
        { label: "Town or area served", value: brief.area },
      ],
    },
    {
      step: 1,
      title: "About the business",
      rows: [
        { label: "What the business does", value: brief.whatYouDo },
        { label: "What makes it different", value: brief.whatMakesDifferent },
        { label: "Opening hours", value: brief.openingHours },
      ],
      list: { label: "Main services", items: services },
    },
    {
      step: 2,
      title: "Website design",
      rows: [
        { label: "Style", value: brief.style },
        { label: "Preferred colours", value: brief.preferredColours },
        { label: "Example website 1", value: brief.example1 },
        { label: "Example website 2", value: brief.example2 },
        { label: "Features needed", value: features.join(", ") },
      ],
    },
    {
      step: 3,
      title: "Existing materials",
      rows: [
        { label: "Existing website", value: brief.existingWebsite },
        { label: "Social media links", value: brief.socialLinks },
        { label: "Domain / Google Business Profile", value: brief.domainGbp },
      ],
    },
    {
      step: 4,
      title: "Final details",
      rows: [
        { label: "Preferred timescale", value: brief.timescale },
        { label: "Budget range", value: brief.budget },
        { label: "Anything else", value: brief.anythingElse },
      ],
    },
  ];
}

/** Optional answers left blank, by label. Used to make gaps obvious in the email. */
export function missingAnswers(brief: Brief): string[] {
  const out: string[] = [];
  for (const section of briefSections(brief)) {
    for (const row of section.rows) if (!row.value.trim()) out.push(row.label);
    if (section.list && section.list.items.length === 0) out.push(section.list.label);
  }
  return out;
}

export function briefToText(brief: Brief, extras?: { reference?: string; files?: string[] }): string {
  const lines: string[] = [];
  if (extras?.reference) lines.push(`Reference: ${extras.reference}`, "");
  for (const section of briefSections(brief)) {
    lines.push(section.title.toUpperCase());
    for (const row of section.rows) lines.push(`${row.label}: ${row.value.trim() || "—"}`);
    if (section.list) {
      lines.push(`${section.list.label}:`);
      lines.push(...(section.list.items.length ? section.list.items.map((item, index) => `  ${index + 1}. ${item}`) : ["  —"]));
    }
    lines.push("");
  }
  if (extras?.files) lines.push("FILES", ...(extras.files.length ? extras.files : ["—"]));
  return lines.join("\n").trimEnd();
}

/**
 * Answers from the earlier 12-section form that have no place in the current
 * model. Studio shows them so nothing a past client wrote is hidden.
 */
const LEGACY_LABELS: Record<string, string> = {
  howLongTrading: "How long trading",
  customerShouldKnow: "What customers should know",
  qualifications: "Qualifications",
  reviewsText: "Customer reviews",
  preferredEmail: "Preferred contact email",
  preferredPhone: "Preferred contact phone",
  whatsappNumber: "WhatsApp",
  styleOther: "Other style",
  dislikedColours: "Colours to avoid",
  example3: "Example website 3",
  exampleNotes: "What they like about the examples",
  domainStatus: "Owns a domain",
  gbpStatus: "Has a Google Business Profile",
};

export function legacyAnswers(raw: unknown): SummaryRow[] {
  if (!raw || typeof raw !== "object") return [];
  const data = raw as Record<string, unknown>;
  const rows: SummaryRow[] = [];
  for (const [key, label] of Object.entries(LEGACY_LABELS)) {
    const value = data[key];
    if (typeof value === "string" && value.trim()) rows.push({ label, value: value.trim() });
  }
  if (Array.isArray(data.styles) && data.styles.length > 1) rows.push({ label: "Styles", value: data.styles.join(", ") });
  if (Array.isArray(data.contactMethods) && data.contactMethods.length) {
    rows.push({ label: "Contact methods", value: data.contactMethods.join(", ") });
  }
  if (Array.isArray(data.services)) {
    const described = data.services
      .map((item) => (item && typeof item === "object" ? (item as Record<string, unknown>) : {}))
      .filter((item) => typeof item.description === "string" && item.description.trim())
      .map((item) => `${typeof item.name === "string" && item.name ? item.name : "Untitled"} — ${String(item.description).trim()}`);
    if (described.length) rows.push({ label: "Service descriptions", value: described.join("\n") });
  }
  return rows;
}
