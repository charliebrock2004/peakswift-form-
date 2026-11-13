import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanCampaignRef,
  exampleErrors,
  exampleErrorsForStep,
  exampleToText,
  firstExampleStepForErrors,
  mergeExampleRequest,
  OFFER_SUMMARY,
  PRIVACY_NOTICE,
  validateExampleRequest,
} from "./example-model.ts";

const complete = {
  businessName: "  Glen Joinery ",
  contactName: "Sam Reid",
  email: "Sam@GlenJoinery.co.uk",
  trade: "Joiner",
  area: "Crieff",
};

test("the five required answers, and nothing else, are required", () => {
  const errors = exampleErrors(mergeExampleRequest({}));
  assert.deepEqual(Object.keys(errors).sort(), ["area", "businessName", "contactName", "email", "trade"]);
  assert.equal(validateExampleRequest(complete).ok, true);
});

test("input is trimmed, bounded, lower-cases the email and drops unknown keys", () => {
  const merged = mergeExampleRequest({ ...complete, isAdmin: true, description: "x".repeat(5000), services: "Kitchens\r\nStairs" });
  assert.equal(merged.businessName, "Glen Joinery");
  assert.equal(merged.email, "sam@glenjoinery.co.uk");
  assert.equal(merged.description.length, 1200);
  assert.equal(merged.services, "Kitchens\nStairs");
  assert.equal("isAdmin" in merged, false);
});

test("a bad email or website is caught inline, on the right step", () => {
  const request = mergeExampleRequest({ ...complete, email: "sam@", existingWebsite: "not a site" });
  const errors = exampleErrors(request);
  assert.ok(errors.email);
  assert.ok(errors.existingWebsite);
  assert.deepEqual(Object.keys(exampleErrorsForStep(0, request)), ["email"]);
  assert.deepEqual(Object.keys(exampleErrorsForStep(1, request)), ["existingWebsite"]);
  assert.equal(firstExampleStepForErrors({ existingWebsite: "x" }), 1);
  assert.equal(validateExampleRequest({ ...complete, existingWebsite: "glenjoinery.co.uk" }).ok, true);
});

test("the campaign reference is a short token or nothing — never free text or an address", () => {
  assert.equal(cleanCampaignRef("fwe_8c2kq9x1"), "fwe_8c2kq9x1");
  assert.equal(cleanCampaignRef("sam@glenjoinery.co.uk"), "");
  assert.equal(cleanCampaignRef("<script>"), "");
  assert.equal(cleanCampaignRef("ab"), "");
  assert.equal(cleanCampaignRef(undefined), "");
});

test("the offer is described as an example, never a free working website", () => {
  assert.match(OFFER_SUMMARY, /example/i);
  assert.match(OFFER_SUMMARY, /not a complete working website/i);
  assert.match(OFFER_SUMMARY, /no obligation/i);
});

test("the privacy notice says requesting an example is not consent to marketing", () => {
  const text = PRIVACY_NOTICE.join(" ");
  assert.match(text, /won’t add you to a mailing list/);
  assert.match(text, /ico\.org\.uk/);
  assert.match(text, /delete/);
});

test("copy text lists every answer with a dash for blanks", () => {
  const text = exampleToText(mergeExampleRequest(complete), { reference: "PS-ABC123", files: [] });
  assert.match(text, /Reference: PS-ABC123/);
  assert.match(text, /Trade or business type: Joiner/);
  assert.match(text, /Existing website: —/);
});
