#!/usr/bin/env node
/**
 * Browser tests for the client form and Studio, driven by Playwright.
 *
 *   npm run dev            # in another terminal (local, in-memory database)
 *   npm run test:ui        # BASE_URL defaults to http://127.0.0.1:8080
 *
 * Point BASE_URL only at a local server or a preview deployment that has no
 * email provider configured — these tests submit real briefs to whatever
 * server they hit. Set SHOTS=<dir> to save a screenshot of every screen.
 */
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { after, before, describe, test } from "node:test";
import { chromium, devices } from "playwright";

const BASE = process.env.BASE_URL ?? "http://127.0.0.1:8080";
const SHOTS = process.env.SHOTS ?? "";
const ACCESS_CODE = process.env.STUDIO_TEST_CODE ?? "e2e-access-code";
const RUN = Date.now().toString(36).toUpperCase();

if (SHOTS) mkdirSync(SHOTS, { recursive: true });

let browser;
before(async () => {
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
});

const VIEWPORTS = {
  mobile: { ...devices["iPhone 13"] },
  android: { ...devices["Pixel 7"] },
  tablet: { viewport: { width: 820, height: 1180 }, hasTouch: true },
  desktop: { viewport: { width: 1440, height: 900 } },
};

async function shot(page, name) {
  if (!SHOTS) return;
  await page.evaluate(() => window.scrollTo(0, 0)); // sticky header/action bar render in place
  await page.waitForTimeout(450); // let step transitions settle
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: true });
}

async function noOverflow(page, where) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `${where}: page scrolls sideways by ${overflow}px`);
}

/** Makes a real image in the browser so uploads go through the same preparation as a phone photo. */
async function makeImage(page, { width, height, colour, type = "image/png", label }) {
  const base64 = await page.evaluate(
    async ({ width, height, colour, type, label }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      context.fillStyle = colour;
      context.fillRect(0, 0, width, height);
      context.fillStyle = "#ffffff";
      context.font = `${Math.round(height / 6)}px sans-serif`;
      context.fillText(label, width / 10, height / 2);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, type, 0.9));
      const bytes = new Uint8Array(await blob.arrayBuffer());
      let binary = "";
      for (const byte of bytes) binary += String.fromCharCode(byte);
      return btoa(binary);
    },
    { width, height, colour, type, label },
  );
  return Buffer.from(base64, "base64");
}

function watchApi(page) {
  const calls = { brief: 0, file: 0, finalise: 0 };
  page.on("request", (request) => {
    if (request.method() !== "POST") return;
    const path = new URL(request.url()).pathname;
    if (path === "/api/brief") calls.brief += 1;
    if (path === "/api/brief-file") calls.file += 1;
    if (path === "/api/brief-finalise") calls.finalise += 1;
  });
  return calls;
}

function watchErrors(page) {
  const errors = [];
  page.on("pageerror", (error) => errors.push(String(error)));
  page.on("console", (message) => {
    // Google Fonts may be unreachable from sandboxed test machines; that is not an app error.
    if (message.type() === "error" && !/fonts\.g|ERR_TUNNEL|ERR_PROXY|net::ERR_FAILED/.test(message.text() + (message.location()?.url ?? ""))) {
      errors.push(message.text());
    }
  });
  return errors;
}

async function heading(page) {
  return (await page.locator("main h1").first().textContent())?.trim();
}

for (const [name, options] of Object.entries(VIEWPORTS)) {
  describe(`client form on ${name}`, () => {
    test("every step, uploads, resume after reload, review, retry without duplicates, success", async () => {
      const context = await browser.newContext(options);
      const page = await context.newPage();
      const errors = watchErrors(page);
      const calls = watchApi(page);
      const business = `UI Test ${name} ${RUN}`;

      await page.goto(BASE + "/", { waitUntil: "networkidle" });
      await page.evaluate(() => {
        localStorage.clear();
        indexedDB.deleteDatabase("peakswift-brief-files");
      });
      await page.reload({ waitUntil: "networkidle" });

      // Introduction
      assert.match(await heading(page), /new website started/);
      await noOverflow(page, "intro");
      await shot(page, `${name}-00-intro`);
      await page.getByRole("button", { name: "Get started" }).click();

      // Step 1 — required-field validation
      assert.equal(await heading(page), "Your business");
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByText("Add your business name.").waitFor();
      assert.equal(await page.locator("[aria-invalid='true']").count(), 3);
      assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("aria-invalid")), "true", "focus moves to the first problem");
      await shot(page, `${name}-01-validation`);
      await page.getByLabel("Business name").fill(business);
      await page.getByLabel("Town or area you serve").fill("Perth & Kinross");
      await page.getByLabel("Your name").fill("Alex Tester");
      await page.getByLabel("Email address").fill("not-an-email");
      await page.getByLabel("Phone number").fill("01764 123456");
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByText(/Check the email address/).waitFor();
      await page.getByLabel("Email address").fill("alex@example.com");
      await noOverflow(page, "step 1");
      await shot(page, `${name}-01-business`);
      await page.getByRole("button", { name: "Continue" }).click();

      // Step 2
      assert.equal(await heading(page), "Your services");
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByText("Tell us briefly what the business does.").waitFor();
      await page.getByLabel(/What does the business do/).fill("Family-run landscaping across Perthshire.");
      await page.getByLabel("Service 1", { exact: true }).fill("Garden design");
      await page.getByLabel("Service 2", { exact: true }).fill("Lawn care");
      await page.getByLabel("Service 3", { exact: true }).fill("Delete me");
      await page.getByRole("button", { name: "Add another service" }).click();
      assert.ok(await page.getByLabel("Service 4", { exact: true }).evaluate((el) => el === document.activeElement), "new service row is focused");
      await page.getByLabel("Service 4", { exact: true }).fill("Fencing");
      await page.getByRole("button", { name: "Remove service 3 (Delete me)" }).click();
      await page.getByLabel(/What makes you different/).fill("20 years’ experience.");
      await page.getByLabel("Opening hours").fill("Mon–Fri 8am–5pm");
      await noOverflow(page, "step 2");
      await shot(page, `${name}-02-services`);
      await page.getByRole("button", { name: "Continue" }).click();

      // Step 3
      assert.equal(await heading(page), "Your website");
      await page.getByText("Modern", { exact: true }).click();
      await page.getByLabel("Colours you like").fill("Forest green and white");
      await page.getByLabel("Website you like", { exact: true }).fill("www.example.co.uk");
      await page.getByText("Photo gallery", { exact: true }).click();
      await page.getByText("Customer reviews", { exact: true }).click();
      await page.getByLabel("Anything else it should do?").fill("Quote request form");
      await noOverflow(page, "step 3");
      await shot(page, `${name}-03-website`);
      await page.getByRole("button", { name: "Continue" }).click();

      // Step 4 — uploads
      assert.equal(await heading(page), "Branding & images");
      const logo = await makeImage(page, { width: 600, height: 300, colour: "#14532d", label: "LOGO" });
      const newLogo = await makeImage(page, { width: 600, height: 300, colour: "#3142c9", label: "NEW LOGO" });
      const photoA = await makeImage(page, { width: 1600, height: 1200, colour: "#a16207", label: "Photo A", type: "image/jpeg" });
      const photoB = await makeImage(page, { width: 1200, height: 1600, colour: "#0e7490", label: "Photo B", type: "image/jpeg" });
      const inputs = page.locator("input[type=file][multiple]");
      await inputs.nth(0).setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: logo });
      await inputs.nth(1).setInputFiles([
        { name: "photo-a.jpg", mimeType: "image/jpeg", buffer: photoA },
        { name: "photo-b.jpg", mimeType: "image/jpeg", buffer: photoB },
        { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("not an image") },
      ]);
      await page.getByText(/notes\.txt needs to be a JPG, PNG, WEBP or SVG/).waitFor();
      await page.getByRole("button", { name: "Remove photo-b.jpg" }).waitFor();
      assert.equal(await page.locator("ul[aria-label^='Added'] img").count(), 3);
      // previews really render
      assert.ok(await page.locator("ul[aria-label^='Added'] img").first().evaluate((img) => img.complete && img.naturalWidth > 0));
      await page.getByRole("button", { name: "Remove photo-b.jpg" }).click();
      const chooser = page.waitForEvent("filechooser");
      await page.getByRole("button", { name: "Replace logo.png" }).click();
      await (await chooser).setFiles({ name: "logo-v2.png", mimeType: "image/png", buffer: newLogo });
      await page.getByRole("button", { name: "Remove logo-v2.png" }).waitFor();
      await page.getByLabel("Current website").fill("www.old-site.co.uk");
      await page.getByLabel("Social media links").fill("facebook.com/uitest");
      await noOverflow(page, "step 4");
      await shot(page, `${name}-04-branding`);

      // Save and resume: reload mid-form, answers and photos come back
      await page.waitForTimeout(400);
      await page.reload({ waitUntil: "networkidle" });
      await page.getByRole("button", { name: "Continue where you left off" }).click();
      assert.equal(await heading(page), "Branding & images");
      await page.getByRole("button", { name: "Remove logo-v2.png" }).waitFor();
      assert.equal(await page.locator("ul[aria-label^='Added'] img").count(), 2, "photos survive a reload");
      assert.equal(await page.getByLabel("Current website").inputValue(), "www.old-site.co.uk");
      await page.getByRole("button", { name: "Continue" }).click();

      // Step 5
      assert.equal(await heading(page), "Final details");
      await page.getByText("Within a month", { exact: true }).click();
      await page.getByText("£1,000–£2,500", { exact: true }).click();
      await page.getByLabel(/Anything else we should know/).fill("Launch before spring, please.");
      await noOverflow(page, "step 5");
      await shot(page, `${name}-05-final`);
      await page.getByRole("button", { name: "Review answers" }).click();

      // Review
      assert.equal(await heading(page), "Review & submit");
      const review = await page.locator("main form").textContent();
      for (const expected of [business, "alex@example.com", "Garden design", "Fencing", "Modern", "Photo gallery, Customer reviews, Quote request form", "Within a month", "£1,000–£2,500"]) {
        assert.ok(review.includes(expected), `review shows ${expected}`);
      }
      assert.ok(!review.includes("Delete me"), "removed service is gone");
      await noOverflow(page, "review");
      await shot(page, `${name}-06-review`);
      await page.getByRole("button", { name: "Submit brief" }).click();
      await page.getByText("Please tick the box to confirm before sending.").waitFor();
      await page.getByLabel(/I confirm these details are correct/).check();

      // First finalise fails as if the connection dropped; the retry must not create a second brief.
      let failNext = true;
      await page.route("**/api/brief-finalise", async (route) => {
        if (failNext) {
          failNext = false;
          await route.fulfill({ status: 502, contentType: "text/html", body: "<h1>Bad gateway</h1>" });
        } else {
          await route.continue();
        }
      });
      await page.getByRole("button", { name: "Submit brief" }).click();
      await page.getByText(/didn’t respond properly/).waitFor();
      assert.match(await page.getByRole("button", { name: "Submit brief" }).textContent(), /Submit brief/);
      await shot(page, `${name}-07-submit-error`);
      await page.getByRole("button", { name: "Submit brief" }).click();

      // Success
      await page.getByRole("heading", { name: /We’ve received your brief/ }).waitFor({ timeout: 30_000 });
      const reference = (await page.locator("p.font-mono").textContent()).trim();
      assert.match(reference, /^PS-[A-Z0-9]{6}$/);
      assert.equal(calls.brief, 1, "one brief created even though Submit was pressed twice");
      assert.equal(calls.file, 2, "each file uploaded exactly once");
      assert.equal(calls.finalise, 2);
      const success = await page.locator("main").textContent();
      assert.ok(success.includes("What happens next"));
      assert.ok(success.includes("alex@example.com"));
      assert.ok(!/email (has been|was) (sent|delivered)/i.test(success), "never claims an email was delivered");
      await noOverflow(page, "success");
      await shot(page, `${name}-08-success`);

      // Draft cleared after sending
      assert.equal(await page.evaluate(() => localStorage.getItem("peakswift-brief-v1")), null);
      // The only console error allowed is the 502 this test injected on purpose.
      assert.deepEqual(errors.filter((text) => !/status of 502/.test(text)), []);
      await context.close();
    });
  });
}

describe("duplicate protection", () => {
  test("a double-tap on Submit sends one brief", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await context.newPage();
    const calls = watchApi(page);
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Get started" }).click();
    await page.getByLabel("Business name").fill(`Double Tap ${RUN}`);
    await page.getByLabel("Your name").fill("Dee");
    await page.getByLabel("Email address").fill("dee@example.com");
    // Enter in a field moves on, like a phone keyboard's Go key.
    await page.getByLabel("Email address").press("Enter");
    await page.getByLabel(/What does the business do/).fill("Plumbing");
    for (const label of ["Continue", "Continue", "Continue", "Continue", "Review answers"]) {
      const button = page.getByRole("button", { name: label });
      if (await button.count()) await button.click();
    }
    assert.equal(await heading(page), "Review & submit");
    await page.getByLabel(/I confirm these details are correct/).check();
    await page.getByRole("button", { name: "Submit brief" }).dblclick();
    await page.getByRole("heading", { name: /We’ve received your brief/ }).waitFor({ timeout: 30_000 });
    assert.equal(calls.brief, 1);
    assert.equal(calls.finalise, 1);
    await context.close();
  });
});

describe("keyboard", () => {
  test("the whole first step can be completed with the keyboard alone", async () => {
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await context.newPage();
    await page.goto(BASE + "/", { waitUntil: "networkidle" });
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Get started" }).focus();
    await page.keyboard.press("Enter");
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => document.activeElement?.tagName), "H1", "focus lands on the step heading");
    const order = [];
    for (let i = 0; i < 5; i += 1) {
      await page.keyboard.press("Tab");
      order.push(await page.evaluate(() => document.activeElement?.getAttribute("name")));
    }
    assert.deepEqual(order, ["organization", "area", "name", "email", "tel"]);
    // Every field has a programmatic label
    const unlabeled = await page.evaluate(() =>
      [...document.querySelectorAll("input:not([type=hidden]):not([aria-hidden=true]), textarea, select")].filter(
        (el) => !el.labels?.length && !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby"),
      ).length,
    );
    assert.equal(unlabeled, 0);
    await context.close();
  });
});

describe("studio", () => {
  for (const [name, options] of [
    ["desktop", VIEWPORTS.desktop],
    ["mobile", VIEWPORTS.mobile],
  ]) {
    test(`sign in, find the brief, see its images, mark it reviewed (${name})`, async () => {
      const context = await browser.newContext(options);
      const page = await context.newPage();
      const errors = watchErrors(page);
      await page.goto(BASE + "/studio", { waitUntil: "networkidle" });
      await page.locator("form").first().waitFor();
      await shot(page, `${name}-studio-00-signin`);
      if (await page.getByLabel("Setup key").count()) {
        await page.getByLabel("Setup key").fill(process.env.STUDIO_SETUP_KEY ?? "PEAKSWIFT");
        await page.getByLabel("Access code", { exact: true }).fill(ACCESS_CODE);
        await page.getByLabel("Confirm access code").fill(ACCESS_CODE);
        await page.getByRole("button", { name: "Save and open inbox" }).click();
      } else {
        if (await page.getByLabel("Username").count()) await page.getByLabel("Username").fill(process.env.STUDIO_USERNAME ?? "charliebrock");
        await page.getByLabel(/Access code|Password/).fill(ACCESS_CODE);
        await page.getByRole("button", { name: "Sign in" }).click();
      }
      await page.getByRole("heading", { name: "Inbox" }).waitFor();
      await page.getByPlaceholder("Search name, email or reference").fill(`UI Test ${name === "desktop" ? "desktop" : "mobile"} ${RUN}`);
      await page.getByRole("button", { name: new RegExp(`UI Test ${name} ${RUN}`) }).click();
      await page.getByRole("heading", { name: `UI Test ${name} ${RUN}` }).waitFor();
      await page.waitForFunction(() => [...document.querySelectorAll("article img")].length === 2 && [...document.querySelectorAll("article img")].every((img) => img.complete && img.naturalWidth > 0));
      const article = await page.locator("article").textContent();
      for (const expected of ["Garden design", "alex@example.com", "Launch before spring"]) assert.ok(article.includes(expected), `detail shows ${expected}`);
      await noOverflow(page, "studio detail");
      await shot(page, `${name}-studio-01-detail`);
      await page.getByRole("button", { name: "Mark as reviewed" }).click();
      await page.getByRole("button", { name: "Mark as new" }).waitFor();
      if (name === "mobile") await page.getByRole("button", { name: "Inbox" }).click();
      await page.getByPlaceholder("Search name, email or reference").fill("");
      await page.getByRole("tab", { name: /Reviewed/ }).click();
      await page.getByRole("button", { name: new RegExp(`UI Test ${name} ${RUN}`) }).waitFor();
      await shot(page, `${name}-studio-02-inbox`);
      assert.deepEqual(errors, []);
      await context.close();
    });
  }
});
