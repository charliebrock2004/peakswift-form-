import assert from "node:assert/strict";
import test from "node:test";
import {
  briefErrors,
  briefSections,
  briefToText,
  emptyBrief,
  errorsForStep,
  firstStepForErrors,
  legacyAnswers,
  mergeBrief,
  missingAnswers,
  REVIEW_STEP,
  STEPS,
  validateBrief,
} from "./model.ts";

const minimal = {
  businessName: "Peak Swift",
  contactName: "Sam",
  email: "hello@peakswift.co.uk",
  whatYouDo: "Websites for local trades",
};

test("the questionnaire is five short sections plus a review", () => {
  assert.equal(STEPS.length, 6);
  assert.equal(REVIEW_STEP, 5);
  assert.deepEqual(
    STEPS.map((step) => step.id),
    ["contact", "about", "design", "materials", "final", "review"],
  );
});

test("a new brief starts with three empty service rows", () => {
  const brief = emptyBrief();
  assert.deepEqual(
    brief.services.map((service) => service.name),
    ["", "", ""],
  );
});

test("only business name, contact name, email and what the business does are required", () => {
  const missing = briefErrors(emptyBrief());
  assert.deepEqual(Object.keys(missing).sort(), ["businessName", "contactName", "email", "whatYouDo"]);
  const result = validateBrief(minimal);
  assert.equal(result.ok, true);
});

test("phone alone is no longer enough — email is required for the reply", () => {
  const result = validateBrief({ ...minimal, email: "", phone: "01764 123456" });
  assert.equal(result.ok, false);
  if (result.ok) return;
  assert.match(result.errors.email ?? "", /email/i);
});

test("every optional answer can stay blank", () => {
  const result = validateBrief(minimal);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.brief.phone, "");
  assert.equal(result.brief.style, "");
  assert.equal(result.brief.budget, "");
  assert.deepEqual(result.brief.features, []);
  assert.equal(result.brief.services.length, 0, "blank service rows are dropped");
});

test("bad email and phone are caught; a blank optional phone is fine", () => {
  const errors = briefErrors({ ...mergeBrief(minimal), email: "not-an-email", phone: "12" });
  assert.match(errors.email ?? "", /email/i);
  assert.match(errors.phone ?? "", /phone/i);
  assert.equal(briefErrors(mergeBrief(minimal)).phone, undefined);
});

test("step validation only reports that step's fields and points back to the first bad step", () => {
  const brief = mergeBrief({ businessName: "Peak Swift", contactName: "Sam", email: "hello@peakswift.co.uk" });
  assert.deepEqual(errorsForStep(0, brief), {});
  assert.deepEqual(Object.keys(errorsForStep(1, brief)), ["whatYouDo"]);
  for (const step of [2, 3, 4, 5]) assert.deepEqual(errorsForStep(step, brief), {});
  assert.equal(firstStepForErrors({ whatYouDo: "x" }), 1);
  assert.equal(firstStepForErrors({ businessName: "x", whatYouDo: "x" }), 0);
});

test("choice fields only accept listed options", () => {
  const brief = mergeBrief({
    ...minimal,
    style: "Luxury",
    budget: "a million pounds",
    timescale: "Within a month",
    features: ["Online shop", "Online shop", "Rocket launcher"],
  });
  assert.equal(brief.style, "Luxury");
  assert.equal(brief.budget, "");
  assert.equal(brief.timescale, "Within a month");
  assert.deepEqual(brief.features, ["Online shop"]);
});

test("merge keeps added services, trims and bounds text, and drops unknown fields", () => {
  const brief = mergeBrief({
    ...minimal,
    businessName: `  ${"x".repeat(500)}  `,
    services: [{ id: "a", name: " Sites " }, { name: "Care" }, { name: "Ads" }, { name: "Extra" }],
    secret: "nope",
  });
  assert.equal(brief.businessName.length, 200);
  assert.equal(brief.services.length, 4);
  assert.equal(brief.services[0]?.name, "Sites");
  assert.equal(brief.services[2]?.id, "service-3");
  assert.equal("secret" in brief, false);
});

test("drafts and briefs from the earlier long form map onto the new questions", () => {
  const old = {
    businessName: "Old Co",
    yourName: "Alex",
    email: "a@old.co",
    areasCovered: "Perth",
    styles: ["Bold", "Friendly"],
    facebook: "https://facebook.com/oldco",
    instagram: "https://instagram.com/oldco",
    domainName: "oldco.co.uk",
    qualifications: "City & Guilds",
    services: [{ id: "s1", name: "Roofing", description: "Slate and tile" }],
  };
  const brief = mergeBrief(old);
  assert.equal(brief.contactName, "Alex");
  assert.equal(brief.area, "Perth");
  assert.equal(brief.style, "Bold");
  assert.equal(brief.socialLinks, "https://facebook.com/oldco\nhttps://instagram.com/oldco");
  assert.equal(brief.domainGbp, "oldco.co.uk");
  const legacy = legacyAnswers(old);
  assert.ok(legacy.some((row) => row.label === "Qualifications" && row.value === "City & Guilds"));
  assert.ok(legacy.some((row) => row.value.includes("Roofing — Slate and tile")));
  assert.deepEqual(legacyAnswers(minimal), []);
});

test("summary sections cover every answer and list what was left blank", () => {
  const brief = mergeBrief({ ...minimal, phone: "01764 123456", services: [{ name: "Design" }], budget: "Not sure" });
  const labels = briefSections(brief).flatMap((section) => section.rows.map((row) => row.label));
  assert.ok(labels.includes("Budget range"));
  assert.ok(labels.includes("Social media links"));
  const missing = missingAnswers(brief);
  assert.ok(missing.includes("Opening hours"));
  assert.ok(missing.includes("Preferred timescale"));
  assert.ok(!missing.includes("Budget range"));
  assert.ok(!missing.includes("Main services"));
  const text = briefToText(brief, { reference: "PS-ABC123", files: ["Logo: logo.png"] });
  assert.match(text, /Reference: PS-ABC123/);
  assert.match(text, /1\. Design/);
  assert.match(text, /Logo: logo\.png/);
});
