import assert from "node:assert/strict";
import test from "node:test";
import { mergeBrief } from "./model.ts";
import { notificationSubject, renderNotificationEmail } from "./notification-email.ts";

const brief = mergeBrief({
  businessName: "Glen <Gardens>",
  contactName: "Sam Reid",
  email: "sam@glengardens.co.uk",
  phone: "01764 123456",
  whatYouDo: "Garden design & landscaping",
  services: [{ name: "Patios" }, { name: "Lawn care" }],
  style: "Modern",
  features: ["Contact form", "Photo gallery"],
  socialLinks: "https://instagram.com/glengardens",
  timescale: "Within a month",
  budget: "Not sure",
  anythingElse: "<script>alert(1)</script>",
});

const input = {
  brief,
  reference: "PS-7K2M9Q",
  submittedAt: new Date("2026-10-09T09:30:00Z"),
  files: [
    { kind: "logo" as const, filename: "logo.png", sizeBytes: 20_480 },
    { kind: "work" as const, filename: "patio.jpg", sizeBytes: 1_200_000 },
  ],
  studioUrl: "https://peakswift-form.vercel.app/studio?brief=0b6f7c6e-6b58-4d7e-9c1e-0a7b0c4b2f11",
};

test("subject names the business and reference on one line", () => {
  assert.equal(notificationSubject(brief, "PS-7K2M9Q"), "New Website Enquiry — Glen <Gardens> — PS-7K2M9Q");
  const injected = mergeBrief({ businessName: "Evil\r\nBcc: victim@example.com" });
  assert.doesNotMatch(notificationSubject(injected, "PS-1"), /[\r\n]/);
  assert.match(notificationSubject(mergeBrief({}), "PS-1"), /Unnamed business/);
});

test("email includes contact details, every answer, files, reference, date and Studio link", () => {
  const email = renderNotificationEmail(input);
  for (const part of [email.text, email.html]) {
    assert.match(part, /PS-7K2M9Q/);
    assert.match(part, /Sam Reid/);
    assert.match(part, /sam@glengardens\.co\.uk/);
    assert.match(part, /01764 123456/);
    assert.match(part, /Patios/);
    assert.match(part, /Lawn care/);
    assert.match(part, /Modern/);
    assert.match(part, /Contact form, Photo gallery/);
    assert.match(part, /instagram\.com\/glengardens/);
    assert.match(part, /Within a month/);
    assert.match(part, /logo\.png/);
    assert.match(part, /patio\.jpg/);
    assert.match(part, /studio\?brief=0b6f7c6e/);
    assert.match(part, /Friday,? 9 October 2026 at 10:30/);
  }
});

test("blank optional answers are listed as not supplied", () => {
  const email = renderNotificationEmail(input);
  const notSupplied = email.text.split("NOT SUPPLIED")[1] ?? "";
  assert.match(notSupplied, /Opening hours/);
  assert.match(notSupplied, /Existing website/);
  assert.doesNotMatch(notSupplied, /Budget range/);
  assert.match(email.html, /Not provided/);
});

test("no uploaded files is stated plainly", () => {
  const email = renderNotificationEmail({ ...input, files: [] });
  assert.match(email.text, /None uploaded/);
  assert.match(email.html, /None uploaded/);
});

test("client text is escaped in the HTML part", () => {
  const { html } = renderNotificationEmail(input);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Glen &lt;Gardens&gt;/);
});
