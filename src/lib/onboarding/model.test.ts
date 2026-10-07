import assert from "node:assert/strict";
import test from "node:test";
import { briefErrors, emptyBrief, mergeBrief, validateBrief } from "./model.ts";

test("a new brief starts with three service rows", () => {
  const brief = emptyBrief();
  assert.equal(brief.services.length, 3);
  assert.deepEqual(
    brief.services.map((service) => service.name),
    ["", "", ""],
  );
});

test("business name and one contact method are required", () => {
  const missing = briefErrors(emptyBrief());
  assert.match(missing.businessName ?? "", /business name/i);
  assert.match(missing.email ?? "", /email or a phone/i);

  const phoneOnly = validateBrief({ ...emptyBrief(), businessName: "Peak Swift", phone: "01764 123456" });
  assert.equal(phoneOnly.ok, true);
  const emailOnly = validateBrief({ ...emptyBrief(), businessName: "Peak Swift", email: "hello@peakswift.co.uk" });
  assert.equal(emailOnly.ok, true);
});

test("optional answers can stay blank", () => {
  const result = validateBrief({ businessName: "Peak Swift", email: "hello@peakswift.co.uk" });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.brief.whatYouDo, "");
  assert.equal(result.brief.services.length, 0);
});

test("a service description without a name is rejected", () => {
  const brief = emptyBrief();
  brief.businessName = "Peak Swift";
  brief.email = "hello@peakswift.co.uk";
  brief.services[0] = { id: "service-1", name: "", description: "Websites" };
  const errors = briefErrors(brief);
  assert.match(errors["services.0.name"] ?? "", /name/i);
});

test("bad contact details are caught without blocking a blank optional phone", () => {
  const brief = emptyBrief();
  brief.businessName = "Peak Swift";
  brief.email = "not-an-email";
  brief.phone = "12";
  const errors = briefErrors(brief);
  assert.match(errors.email ?? "", /email/i);
  assert.match(errors.phone ?? "", /phone/i);
});

test("merge keeps added services and drops unknown fields", () => {
  const brief = mergeBrief({
    businessName: "Peak Swift",
    services: [
      { id: "a", name: "Sites", description: "Brochure sites" },
      { id: "b", name: "Care", description: "" },
      { name: "Ads", description: "Local" },
      { name: "Extra", description: "Four" },
    ],
    secret: "nope",
  });
  assert.equal(brief.services.length, 4);
  assert.equal(brief.services[2]?.name, "Ads");
  assert.equal("secret" in brief, false);
});
