export const STYLE_OPTIONS = [
  "Modern",
  "Professional",
  "Minimal",
  "Luxury",
  "Traditional",
  "Bold",
  "Friendly",
  "Other",
] as const;

export const CONTACT_OPTIONS = [
  { id: "phone", label: "Phone" },
  { id: "email", label: "Email" },
  { id: "form", label: "Website contact form" },
  { id: "messenger", label: "Facebook Messenger" },
  { id: "whatsapp", label: "WhatsApp" },
] as const;

export const FILE_KINDS = ["logo", "work", "team", "other", "review"] as const;

export type StyleChoice = (typeof STYLE_OPTIONS)[number];
export type ContactMethod = (typeof CONTACT_OPTIONS)[number]["id"];
export type FileKind = (typeof FILE_KINDS)[number];
export type YesNo = "" | "yes" | "no" | "unsure";

export type Service = {
  id: string;
  name: string;
  description: string;
};

export type Brief = {
  businessName: string;
  yourName: string;
  phone: string;
  email: string;
  address: string;
  openingHours: string;
  areasCovered: string;
  whatYouDo: string;
  howLongTrading: string;
  whatMakesDifferent: string;
  customerShouldKnow: string;
  qualifications: string;
  services: Service[];
  reviewsText: string;
  facebook: string;
  instagram: string;
  tiktok: string;
  otherSocial: string;
  contactMethods: ContactMethod[];
  preferredEmail: string;
  preferredPhone: string;
  whatsappNumber: string;
  styles: StyleChoice[];
  styleOther: string;
  preferredColours: string;
  dislikedColours: string;
  example1: string;
  example2: string;
  example3: string;
  exampleNotes: string;
  domainStatus: YesNo;
  domainName: string;
  gbpStatus: YesNo;
  gbpUrl: string;
  anythingElse: string;
};

export const STEPS = [
  {
    id: "business",
    title: "Business details",
    lede: "So we know who the website is for.",
  },
  {
    id: "about",
    title: "About your business",
    lede: "In your own words. Short notes are fine.",
  },
  {
    id: "services",
    title: "Services",
    lede: "The services you want listed on the site.",
  },
  {
    id: "photos",
    title: "Photos & branding",
    lede: "Optional. Clear photos help, and you can always send more later.",
  },
  {
    id: "reviews",
    title: "Customer reviews",
    lede: "Paste the words, add screenshots, or skip this for now.",
  },
  {
    id: "social",
    title: "Social media",
    lede: "Only the accounts you actually use.",
  },
  {
    id: "contact",
    title: "Contact preferences",
    lede: "How you’d like new customers to reach you.",
  },
  {
    id: "design",
    title: "Website design",
    lede: "A direction is enough. We’ll refine it with you.",
  },
  {
    id: "domain",
    title: "Domain",
    lede: "The web address people type to find you.",
  },
  {
    id: "google",
    title: "Google Business Profile",
    lede: "The listing that shows up on Google Maps.",
  },
  {
    id: "else",
    title: "Anything else",
    lede: "Pages, offers, or details we haven’t asked about.",
  },
  {
    id: "review",
    title: "Review",
    lede: "Check everything before you send it.",
  },
] as const;

const STEP_KEYS: string[][] = [
  ["businessName", "yourName", "phone", "email", "address", "openingHours", "areasCovered"],
  ["whatYouDo", "howLongTrading", "whatMakesDifferent", "customerShouldKnow", "qualifications"],
  ["services"],
  [],
  ["reviewsText"],
  ["facebook", "instagram", "tiktok", "otherSocial"],
  ["contactMethods", "preferredEmail", "preferredPhone", "whatsappNumber"],
  ["styles", "styleOther", "preferredColours", "dislikedColours", "example1", "example2", "example3", "exampleNotes"],
  ["domainStatus", "domainName"],
  ["gbpStatus", "gbpUrl"],
  ["anythingElse"],
  [],
];

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LIMITS: Record<string, number> = {
  businessName: 200,
  yourName: 200,
  phone: 40,
  email: 200,
  address: 300,
  openingHours: 500,
  areasCovered: 500,
  whatYouDo: 4000,
  howLongTrading: 200,
  whatMakesDifferent: 4000,
  customerShouldKnow: 4000,
  qualifications: 4000,
  reviewsText: 8000,
  facebook: 300,
  instagram: 300,
  tiktok: 300,
  otherSocial: 500,
  preferredEmail: 200,
  preferredPhone: 40,
  whatsappNumber: 40,
  styleOther: 200,
  preferredColours: 300,
  dislikedColours: 300,
  example1: 300,
  example2: 300,
  example3: 300,
  exampleNotes: 4000,
  domainName: 200,
  gbpUrl: 400,
  anythingElse: 8000,
};

export function emptyBrief(): Brief {
  return {
    businessName: "",
    yourName: "",
    phone: "",
    email: "",
    address: "",
    openingHours: "",
    areasCovered: "",
    whatYouDo: "",
    howLongTrading: "",
    whatMakesDifferent: "",
    customerShouldKnow: "",
    qualifications: "",
    services: [1, 2, 3].map((n) => ({ id: `service-${n}`, name: "", description: "" })),
    reviewsText: "",
    facebook: "",
    instagram: "",
    tiktok: "",
    otherSocial: "",
    contactMethods: [],
    preferredEmail: "",
    preferredPhone: "",
    whatsappNumber: "",
    styles: [],
    styleOther: "",
    preferredColours: "",
    dislikedColours: "",
    example1: "",
    example2: "",
    example3: "",
    exampleNotes: "",
    domainStatus: "",
    domainName: "",
    gbpStatus: "",
    gbpUrl: "",
    anythingElse: "",
  };
}

function clip(value: unknown, max: number): string {
  if (typeof value !== "string") return "";
  return value.split("\u0000").join("").slice(0, max);
}

function asYesNo(value: unknown): YesNo {
  return value === "yes" || value === "no" || value === "unsure" ? value : "";
}

export function mergeBrief(input: unknown): Brief {
  const base = emptyBrief();
  if (!input || typeof input !== "object") return base;
  const raw = input as Record<string, unknown>;
  (Object.keys(LIMITS) as Array<keyof typeof LIMITS>).forEach((key) => {
    (base as unknown as Record<string, string>)[key] = clip(raw[key], LIMITS[key]).trim();
  });
  base.domainStatus = asYesNo(raw.domainStatus);
  base.gbpStatus = asYesNo(raw.gbpStatus);
  if (Array.isArray(raw.contactMethods)) {
    const allowed = new Set(CONTACT_OPTIONS.map((item) => item.id));
    base.contactMethods = raw.contactMethods.filter(
      (item): item is ContactMethod => typeof item === "string" && allowed.has(item as ContactMethod),
    );
  }
  if (Array.isArray(raw.styles)) {
    const allowed = new Set<string>(STYLE_OPTIONS);
    base.styles = raw.styles.filter((item): item is StyleChoice => typeof item === "string" && allowed.has(item));
  }
  if (Array.isArray(raw.services)) {
    const services = raw.services.slice(0, 40).map((item, index) => {
      const row = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
      const id = clip(row.id, 80).trim() || `service-${index + 1}`;
      return {
        id,
        name: clip(row.name, 160).trim(),
        description: clip(row.description, 1000).trim(),
      };
    });
    if (services.length > 0) base.services = services;
  }
  return base;
}

function phoneProblem(value: string, label: string): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15) return `Check the ${label} — it should be a real phone number.`;
  return null;
}

function emailProblem(value: string, label: string): string | null {
  if (!value) return null;
  if (!EMAIL.test(value)) return `Check the ${label} — it should look like name@email.com.`;
  return null;
}

export function briefErrors(brief: Brief): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!brief.businessName) errors.businessName = "Add the business name so we know whose website this is.";
  const phoneError = phoneProblem(brief.phone, "phone number");
  if (phoneError) errors.phone = phoneError;
  const emailError = emailProblem(brief.email, "email address");
  if (emailError) errors.email = emailError;
  if (!brief.email && !brief.phone) {
    errors.email = "Add an email or a phone number so we can reach you.";
  }
  const preferredEmail = emailProblem(brief.preferredEmail, "preferred email");
  if (preferredEmail) errors.preferredEmail = preferredEmail;
  const preferredPhone = phoneProblem(brief.preferredPhone, "preferred phone number");
  if (preferredPhone) errors.preferredPhone = preferredPhone;
  const whatsapp = phoneProblem(brief.whatsappNumber, "WhatsApp number");
  if (whatsapp) errors.whatsappNumber = whatsapp;
  brief.services.forEach((service, index) => {
    if (!service.name && service.description) {
      errors[`services.${index}.name`] = "Add a name for this service, or clear the description.";
    }
  });
  if (brief.domainStatus === "yes" && !brief.domainName) {
    errors.domainName = "Add the domain name, or choose Not sure.";
  }
  if (brief.styles.includes("Other") && !brief.styleOther) {
    errors.styleOther = "Tell us what you have in mind, or unselect Other.";
  }
  return errors;
}

export function errorsForStep(step: number, brief: Brief): Record<string, string> {
  const all = briefErrors(brief);
  const keys = STEP_KEYS[step] ?? [];
  const out: Record<string, string> = {};
  for (const [key, message] of Object.entries(all)) {
    if (keys.some((prefix) => key === prefix || key.startsWith(`${prefix}.`))) out[key] = message;
  }
  return out;
}

export function firstStepForErrors(errors: Record<string, string>): number {
  const keys = Object.keys(errors);
  for (let index = 0; index < STEP_KEYS.length; index += 1) {
    if (keys.some((key) => STEP_KEYS[index].some((prefix) => key === prefix || key.startsWith(`${prefix}.`)))) {
      return index;
    }
  }
  return 0;
}

export function normalizeBrief(brief: Brief): Brief {
  return {
    ...brief,
    services: brief.services.filter((service) => service.name || service.description),
    contactMethods: [...new Set(brief.contactMethods)],
    styles: [...new Set(brief.styles)],
  };
}

export function validateBrief(input: unknown): { ok: true; brief: Brief } | { ok: false; errors: Record<string, string> } {
  const brief = mergeBrief(input);
  const errors = briefErrors(brief);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, brief: normalizeBrief(brief) };
}

const CONTACT_LABEL = Object.fromEntries(CONTACT_OPTIONS.map((item) => [item.id, item.label])) as Record<
  ContactMethod,
  string
>;

function line(label: string, value: string): string {
  return `${label}: ${value.trim() || "—"}`;
}

export function briefToText(brief: Brief, extras?: { reference?: string; files?: string[] }): string {
  const services =
    brief.services.filter((service) => service.name || service.description).length === 0
      ? "—"
      : brief.services
          .filter((service) => service.name || service.description)
          .map((service, index) => `${index + 1}. ${service.name || "Untitled"}${service.description ? ` — ${service.description}` : ""}`)
          .join("\n");
  const blocks = [
    extras?.reference ? `Reference: ${extras.reference}` : "",
    "BUSINESS DETAILS",
    line("Business name", brief.businessName),
    line("Your name", brief.yourName),
    line("Phone", brief.phone),
    line("Email", brief.email),
    line("Address / location", brief.address),
    line("Opening hours", brief.openingHours),
    line("Areas covered", brief.areasCovered),
    "",
    "ABOUT",
    line("What the business does", brief.whatYouDo),
    line("How long trading", brief.howLongTrading),
    line("What makes it different", brief.whatMakesDifferent),
    line("What customers should know", brief.customerShouldKnow),
    line("Qualifications", brief.qualifications),
    "",
    "SERVICES",
    services,
    "",
    "REVIEWS",
    brief.reviewsText.trim() || "—",
    "",
    "SOCIAL",
    line("Facebook", brief.facebook),
    line("Instagram", brief.instagram),
    line("TikTok", brief.tiktok),
    line("Other", brief.otherSocial),
    "",
    "CONTACT PREFERENCES",
    line("Methods", brief.contactMethods.map((id) => CONTACT_LABEL[id]).join(", ")),
    line("Preferred email", brief.preferredEmail),
    line("Preferred phone", brief.preferredPhone),
    line("WhatsApp", brief.whatsappNumber),
    "",
    "DESIGN",
    line("Style", [...brief.styles, brief.styleOther].filter(Boolean).join(", ")),
    line("Preferred colours", brief.preferredColours),
    line("Colours to avoid", brief.dislikedColours),
    line("Example 1", brief.example1),
    line("Example 2", brief.example2),
    line("Example 3", brief.example3),
    line("What they like", brief.exampleNotes),
    "",
    "DOMAIN",
    line("Owns a domain", brief.domainStatus || "—"),
    line("Domain", brief.domainName),
    "",
    "GOOGLE BUSINESS PROFILE",
    line("Has a profile", brief.gbpStatus || "—"),
    line("URL", brief.gbpUrl),
    "",
    "ANYTHING ELSE",
    brief.anythingElse.trim() || "—",
  ];
  if (extras?.files) {
    blocks.push("", "FILES", extras.files.length ? extras.files.join("\n") : "—");
  }
  return blocks.filter((item, index, all) => item !== "" || all[index - 1] !== "").join("\n");
}

export function display(value: string): string {
  return value.trim() ? value.trim() : "Not provided";
}

export function contactLabel(id: ContactMethod): string {
  return CONTACT_LABEL[id];
}
