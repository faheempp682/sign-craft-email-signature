// Browser test for the new customer journey: template gallery -> questions -> preview and compare -> editor, plus the AI route.
//
//   Run the app WITHOUT Supabase variables, so it is the login-free local editor (the create flow itself needs no account):
//     NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_ANON_KEY= npx next dev -p 3250
//     E2E_BASE_URL=http://localhost:3250 node --test e2e/create-flow.e2e.mjs
//
// Against a server that has Supabase configured, /create sends you to the login page, so every test here is skipped (not failed).
// Saving and the 5-signature limit need real accounts: see e2e/signature-limit.e2e.mjs.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright-core";

const BASE = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const exe = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe"].filter(Boolean).find((p) => fs.existsSync(p));

let browser;
let skip = false;
before(async () => {
  browser = await chromium.launch({ executablePath: exe, headless: true });
  const res = await fetch(`${BASE}/create`, { redirect: "manual" }).catch(() => null);
  if (!res) throw new Error(`Nothing is listening on ${BASE}. Start the app first (see the top of this file).`);
  if (res.status !== 200) skip = `${BASE}/create answered ${res.status}: this server requires sign-in. Run it without Supabase variables.`;
});
after(async () => browser?.close());

/** A fresh browser profile per test, with every page error and console error collected. */
async function fresh(viewport = { width: 1440, height: 900 }) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const problems = [];
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && problems.push(`console: ${m.text()}`));
  return { ctx, page, problems };
}

const MINIMAL = { name: "Zed Quill" };
const FULL = { name: "Zed Quill", title: "Chief Quillmaker", company: "Quill & Co", phone: "+44 20 7946 0000", email: "zed@quill.example", website: "quill.example", address: "9 Ink Lane, Leeds", linkedin: "zedquill", twitter: "@zedquill", instagram: "zedquill" };
/** What the "Classic" and a few other templates ship with. None of it may reach a customer's signature. */
const SAMPLES = ["Jane Doe", "Senior Designer", "Acme Inc.", "+1 555 010 2030", "jane@acme.com", "acme.com", "janedoe", "confidential and intended solely", "placehold.co/400x100", "Hana Dulseta", "hanadulseta@email.com", "yourname@email.com", "yourmail@domain.com", "www.yourwebsite.com", "Open house this Saturday", "tandembridge"];

const choose = async (page, index = 0) => {
  await page.goto(`${BASE}/create`, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "Choose", exact: true }).nth(index).click();
  await page.waitForURL(/\/create\/details\?t=/);
};
const fill = async (page, values) => {
  for (const [k, v] of Object.entries(values)) await page.fill(`#f-${k}`, v);
};
const toPreview = async (page, values) => {
  await fill(page, values);
  await page.getByRole("button", { name: "See my signature" }).click();
  await page.waitForURL(/\/create\/preview\?t=/);
  await page.locator(PICKS + " iframe").first().waitFor();
  await page.waitForFunction((sel) => document.querySelector(sel + " iframe")?.contentDocument?.getElementById("w"), PICKS);
};
const PICKS = 'section[aria-label="Your picks"]';
const pickedNames = (page) => page.locator(`${PICKS} li h2`).allInnerTexts();
/** The n-th picked signature's preview frame. */
const pickFrame = (page, n = 0) => page.locator(`${PICKS} li iframe`).nth(n);
const bigHtml = (page, n = 0) => pickFrame(page, n).getAttribute("srcdoc");
const bigText = async (page, n = 0) => (await (await pickFrame(page, n).elementHandle()).contentFrame()).evaluate(() => document.body.innerText);
const tick = (page, name) => page.getByRole("checkbox", { name: `Compare ${name}` });
const nthTemplateName = async (page, n) => (await page.locator("aside[aria-label=Templates] li").nth(n).locator("span.truncate").first().innerText()).trim();
const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

test("step 1: the first screen is the template gallery, with the AI route as a button", { skip }, async () => {
  const { ctx, page, problems } = await fresh();
  await page.goto(`${BASE}/create`, { waitUntil: "networkidle" });
  assert.equal(await page.locator("h1").innerText(), "Choose a template.");
  assert.ok(await page.getByText("Step 1 of 3").isVisible());
  assert.ok(await page.getByRole("link", { name: "Customize template" }).isVisible());
  assert.equal(await page.locator("#idea").count(), 0, "the AI prompt box must not be on the first screen");
  assert.ok((await page.getByRole("link", { name: "Choose", exact: true }).count()) >= 12);
  // The button sits at the top right, above the list.
  const btn = await page.getByRole("link", { name: "Customize template" }).boundingBox();
  assert.ok(btn.x > 900 && btn.y < 200, `button at ${btn.x},${btn.y}`);
  assert.deepEqual(problems, []);
  await ctx.close();
});

test("the Customize button opens the AI screen, and back returns to the templates", { skip }, async () => {
  const { ctx, page, problems } = await fresh();
  await page.goto(`${BASE}/create`, { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "Customize template" }).click();
  await page.waitForURL(/\/create\/customize$/);
  assert.ok(await page.locator("#idea").isVisible());
  assert.ok(await page.getByRole("button", { name: "Create signature" }).isVisible());
  await page.getByText("Back to templates").click();
  await page.waitForURL(/\/create$/);
  assert.equal(await page.locator("h1").innerText(), "Choose a template.");
  assert.deepEqual(problems, []);
  await ctx.close();
});

test("step 2: only the name is required, and bad email, website or social entries are explained", { skip }, async () => {
  const { ctx, page } = await fresh();
  await choose(page);
  assert.ok(await page.getByText("Step 2 of 3").isVisible());
  await page.getByRole("button", { name: "See my signature" }).click();
  assert.equal(await page.locator("#e-name").innerText(), "Enter your name.");
  assert.equal(await page.locator("#f-name").getAttribute("aria-invalid"), "true");
  assert.match(page.url(), /\/create\/details/, "stays on the form");
  assert.equal(await page.evaluate(() => document.activeElement?.id), "f-name", "focus goes to the first problem");

  await fill(page, { name: "Zed", email: "not-an-email", website: "nope", linkedin: "!!!" });
  await page.getByRole("button", { name: "See my signature" }).click();
  assert.match(await page.locator("#e-email").innerText(), /does not look right/);
  assert.match(await page.locator("#e-website").innerText(), /web address/);
  assert.match(await page.locator("#e-linkedin").innerText(), /link or a username/);
  assert.match(page.url(), /\/create\/details/);

  await fill(page, { email: "", website: "", linkedin: "" });
  await page.getByRole("button", { name: "See my signature" }).click();
  await page.waitForURL(/\/create\/preview/);
  await ctx.close();
});

test("an unknown template sends you back to the list, from the questions and from the preview", { skip }, async () => {
  const { ctx, page } = await fresh();
  for (const path of ["/create/details?t=nope", "/create/details", "/create/preview?t=nope", "/create/preview"]) {
    await page.goto(`${BASE}${path}`, { waitUntil: "networkidle" });
    assert.equal(new URL(page.url()).pathname, "/create", path);
  }
  await ctx.close();
});

test("step 3, name only: empty phone, email, website and socials leave nothing behind, and no sample data shows", { skip }, async () => {
  const { ctx, page, problems } = await fresh();
  await choose(page, 0); // Classic
  await toPreview(page, MINIMAL);
  const html = await bigHtml(page);
  const text = await bigText(page);
  assert.match(text, /Zed Quill/);
  assert.doesNotMatch(text, /[@+]|LinkedIn|GitHub|X\b|Instagram/, `unexpected contact or social text: ${JSON.stringify(text)}`);
  assert.doesNotMatch(html, /mailto:|tel:|linkedin\.com|github\.com|x\.com|instagram\.com|facebook\.com/);
  for (const s of SAMPLES) assert.ok(!html.includes(s), `sample leaked into the big preview: ${s}`);
  // The same holds for every thumbnail in the compare list, which are other templates filled the same way.
  const thumbs = await page.locator("aside iframe").evaluateAll((fs) => fs.map((f) => f.getAttribute("srcdoc")));
  assert.ok(thumbs.length >= 12);
  thumbs.forEach((h, i) => {
    assert.match(h, /Zed|ZED/i, `thumbnail ${i} lacks the name`);
    for (const s of SAMPLES) assert.ok(!h.includes(s), `sample leaked into thumbnail ${i}: ${s}`);
  });
  assert.deepEqual(problems, []);
  await ctx.close();
});

test("step 3, only an email: it appears, the rest stay empty", { skip }, async () => {
  const { ctx, page } = await fresh();
  await choose(page, 0);
  await toPreview(page, { name: "Zed Quill", email: "zed@quill.example" });
  const text = await bigText(page);
  assert.match(text, /zed@quill\.example/);
  assert.doesNotMatch(text, /\+\d|LinkedIn|GitHub/);
  const html = await bigHtml(page);
  assert.match(html, /mailto:zed@quill\.example/);
  assert.doesNotMatch(html, /tel:/);
  for (const s of SAMPLES) assert.ok(!html.includes(s), `sample leaked: ${s}`);
  await ctx.close();
});

test("step 3, everything filled: every value shows and the social links are built from handles", { skip }, async () => {
  const { ctx, page, problems } = await fresh();
  await choose(page, 0);
  await toPreview(page, FULL);
  const text = await bigText(page);
  for (const v of ["Zed Quill", "Chief Quillmaker", "Quill & Co", "+44 20 7946 0000", "zed@quill.example", "quill.example", "9 Ink Lane, Leeds"]) assert.ok(text.includes(v), `missing ${v} in ${JSON.stringify(text)}`);
  const hrefs = await (await (await pickFrame(page).elementHandle()).contentFrame()).evaluate(() => [...document.querySelectorAll("a")].map((a) => a.href));
  assert.ok(hrefs.includes("https://www.linkedin.com/in/zedquill"), hrefs.join(" "));
  assert.ok(hrefs.includes("https://x.com/zedquill"), hrefs.join(" "));
  assert.ok(hrefs.includes("https://www.instagram.com/zedquill"), hrefs.join(" "));
  for (const s of SAMPLES) assert.ok(!(await bigHtml(page)).includes(s), `sample leaked: ${s}`);
  assert.deepEqual(problems, []);
  await ctx.close();
});

test("step 3: tick several templates and they are listed one by one on the right, with your details; untick removes", { skip }, async () => {
  const { ctx, page, problems } = await fresh();
  await choose(page, 0);
  await toPreview(page, FULL);
  assert.deepEqual(await pickedNames(page), ["Classic"], "the template chosen in step 1 starts ticked");
  assert.ok(await tick(page, "Classic").isChecked());

  const names = [await nthTemplateName(page, 3), await nthTemplateName(page, 5), await nthTemplateName(page, 8)];
  for (const [i, name] of names.entries()) {
    await tick(page, name).check();
    await page.waitForFunction((n) => document.querySelectorAll('section[aria-label="Your picks"] li[data-picked]').length === n, i + 2);
    assert.deepEqual(await pickedNames(page), ["Classic", ...names.slice(0, i + 1)], "listed in the order ticked, newest last");
  }
  assert.equal(await page.locator(`${PICKS} li[data-picked]`).count(), 4);
  const frames = new Set();
  for (let n = 0; n < 4; n++) {
    await page.waitForFunction(([sel, k]) => document.querySelectorAll(sel + " li iframe")[k]?.contentDocument?.getElementById("w"), [PICKS, n]);
    const text = await bigText(page, n);
    assert.match(text, /Zed|ZED/i, `picked ${n} shows the name`);
    assert.ok(text.includes("zed@quill.example"), `picked ${n} shows the email`);
    frames.add(await bigHtml(page, n));
  }
  assert.equal(frames.size, 4, "each template renders differently");

  await tick(page, names[0]).uncheck();
  assert.deepEqual(await pickedNames(page), ["Classic", names[1], names[2]]);
  await page.getByRole("button", { name: `Remove ${names[1]}` }).click(); // the card's own Remove
  assert.deepEqual(await pickedNames(page), ["Classic", names[2]]);
  assert.equal(await tick(page, names[1]).isChecked(), false, "the left list follows");
  await tick(page, "Classic").uncheck();
  await tick(page, names[2]).uncheck();
  assert.ok(await page.getByText(/Tick a template on the left/).isVisible());
  assert.deepEqual(problems, []);
  await ctx.close();
});

test("step 3: at most 8 can be compared at once, with a clear message", { skip }, async () => {
  const { ctx, page } = await fresh();
  await choose(page, 0);
  await toPreview(page, MINIMAL);
  for (let n = 1; n <= 7; n++) await tick(page, await nthTemplateName(page, n)).check();
  assert.equal(await page.locator(`${PICKS} li[data-picked]`).count(), 8);
  await page.locator("aside[aria-label=Templates] li").nth(9).getByRole("checkbox").click();
  assert.match(await page.getByRole("alert").first().innerText(), /up to 8/);
  assert.equal(await page.locator(`${PICKS} li[data-picked]`).count(), 8);
  await ctx.close();
});

test("Preview: a mock email with skeleton lines and the signature at the bottom, in the client of your choice", { skip }, async () => {
  const { ctx, page, problems } = await fresh();
  await choose(page, 0);
  await toPreview(page, FULL);
  const name = await nthTemplateName(page, 2);
  assert.equal(await page.locator("aside[aria-label=Templates] button", { hasText: "Preview" }).count(), 0, "no Preview buttons in the left list");
  await tick(page, name).check();
  await page.getByRole("button", { name: `Preview ${name} in an email` }).click(); // from the picked card on the right
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  assert.ok(await dialog.getByRole("heading", { name }).isVisible());
  const frame = dialog.locator("iframe");
  await frame.waitFor();
  const doc1 = await frame.getAttribute("srcdoc");
  assert.match(doc1, /data-mock="email"/);
  const sigAt = doc1.indexOf('data-mock="signature"');
  assert.ok(sigAt > 0 && doc1.indexOf("border-radius") < sigAt, "skeleton lines come before the signature");
  assert.ok(doc1.slice(sigAt).includes("zed@quill.example"), "the customer's own details sit at the bottom");
  assert.equal(await frame.getAttribute("sandbox"), "", "no scripts in the frame");
  for (const s of SAMPLES) assert.ok(!doc1.includes(s), `sample leaked into the mock email: ${s}`);

  // All the editor's email clients are offered, Gmail first and selected.
  const clients = await dialog.getByRole("group", { name: "Email client" }).getByRole("button").allInnerTexts();
  assert.deepEqual(clients, ["Gmail (sim.)", "Outlook web", "Outlook Win (sim.)", "Apple Mail", "Thunderbird", "Mobile"]);
  assert.equal(await dialog.getByRole("button", { name: "Gmail (sim.)" }).getAttribute("aria-pressed"), "true");
  const seen = new Set([doc1]);
  for (const c of clients.slice(1)) {
    await dialog.getByRole("button", { name: c, exact: true }).click();
    assert.equal(await dialog.getByRole("button", { name: c, exact: true }).getAttribute("aria-pressed"), "true");
    assert.ok((await frame.getAttribute("title")).includes(c), `frame titled for ${c}`);
    seen.add(await frame.getAttribute("srcdoc"));
    assert.match(await dialog.innerText(), /Simulation|Approximation/);
  }
  assert.ok(seen.size >= 4, "clients draw differently");
  const mobile = await frame.evaluate((f) => f.getBoundingClientRect().width);
  assert.ok(mobile <= 380, `mobile frame is phone width, got ${mobile}`);

  await dialog.getByLabel("Dark mode").check();
  assert.match(await frame.getAttribute("srcdoc"), /rgba\(255,255,255,\.16\)/);

  await dialog.getByRole("button", { name: "Keep comparing" }).click();
  await page.getByRole("button", { name: `Preview ${name} in an email` }).click();
  await dialog.waitFor();
  await dialog.getByRole("button", { name: "Close", exact: true }).click(); // the corner X too
  await dialog.waitFor({ state: "hidden" });
  assert.deepEqual(problems, []);
  await ctx.close();
});

test("Preview from a picked card, then 'Choose this signature' opens the editor with that template", { skip }, async () => {
  const { ctx, page, problems } = await fresh();
  await choose(page, 0);
  await toPreview(page, FULL);
  const name = await nthTemplateName(page, 4);
  await tick(page, name).check();
  await page.getByRole("button", { name: `Preview ${name} in an email` }).click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  assert.ok(await dialog.getByRole("heading", { name }).isVisible());
  await dialog.getByRole("button", { name: "Choose this signature" }).click();
  await page.waitForURL(/\/editor\?from=create/);
  await page.waitForSelector('[data-testid="design-canvas"]', { timeout: 30000 });
  const draft = JSON.parse(await page.evaluate(() => localStorage.getItem("signcraft:draft:v1")));
  assert.match(JSON.stringify(draft.doc.blocks), /"name":"Zed Quill"/);
  const frame = await (await page.$("iframe")).contentFrame();
  await frame.waitForSelector("[data-block]");
  assert.ok((await frame.evaluate(() => document.body.innerText)).includes("zed@quill.example"));
  assert.deepEqual(problems, []);
  await ctx.close();
});

test("step 3: 'Show more' lists further templates, and 'Customize with AI' is offered at the bottom", { skip }, async () => {
  const { ctx, page } = await fresh();
  await choose(page, 0);
  await toPreview(page, MINIMAL);
  const before = await page.locator("aside li").count();
  await page.getByRole("button", { name: /Show more/ }).click();
  assert.ok((await page.locator("aside li").count()) > before);
  await page.getByRole("link", { name: "Customize with AI" }).click();
  await page.waitForURL(/\/create\/customize$/);
  assert.ok(await page.locator("#idea").isVisible());
  await ctx.close();
});

test("'Edit my details' returns to the questions with everything still filled in", { skip }, async () => {
  const { ctx, page } = await fresh();
  await choose(page, 0);
  await toPreview(page, FULL);
  await page.getByRole("link", { name: "Edit my details" }).click();
  await page.waitForURL(/\/create\/details/);
  await page.waitForFunction(() => document.getElementById("f-name")?.value);
  for (const [k, v] of Object.entries(FULL)) assert.equal(await page.inputValue(`#f-${k}`), v, k);
  await ctx.close();
});

test("the preview survives a refresh; a brand-new browser profile is asked for its details again", { skip }, async () => {
  const { ctx, page } = await fresh();
  await choose(page, 0);
  await toPreview(page, FULL);
  const url = page.url();
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(page.url(), url);
  assert.match(await bigText(page), /Zed Quill/);
  const other = await fresh();
  await other.page.goto(url, { waitUntil: "networkidle" });
  await other.page.waitForURL(/\/create\/details\?t=/);
  assert.equal(await other.page.inputValue("#f-name"), "");
  await other.ctx.close();
  await ctx.close();
});

test("'Choose' on a picked card opens the editor with the customer's details and nothing from the sample; the next signature starts blank", { skip }, async () => {
  const { ctx, page, problems } = await fresh();
  await choose(page, 0);
  await toPreview(page, FULL);
  const name = await nthTemplateName(page, 2);
  await tick(page, name).check();
  await page.getByRole("button", { name: `Choose ${name}`, exact: true }).click();
  await page.waitForURL(/\/editor\?from=create/);
  await page.waitForSelector('[data-testid="design-canvas"]', { timeout: 30000 });
  await page.waitForFunction(() => document.querySelector("iframe")?.contentDocument?.querySelector("[data-block]"), null, { timeout: 15000 });

  const draft = JSON.parse(await page.evaluate(() => localStorage.getItem("signcraft:draft:v1")));
  const identity = JSON.stringify(draft.doc.blocks).match(/"type":"identity","name":"([^"]+)"/);
  assert.equal(identity?.[1], "Zed Quill", "the draft holds the customer's name");

  const frame = await (await page.$("iframe")).contentFrame();
  const text = await frame.evaluate(() => document.body.innerText);
  const html = await frame.evaluate(() => document.body.innerHTML);
  for (const v of ["Chief Quillmaker", "+44 20 7946 0000", "zed@quill.example", "9 Ink Lane, Leeds"]) assert.ok(text.includes(v), `editor canvas lacks ${v}`);
  for (const s of SAMPLES) assert.ok(!html.includes(s), `sample leaked into the editor: ${s}`);
  assert.equal(await page.locator('[data-layer]:has-text("European languages")').count(), 0, "no sample disclaimer text in the layers");

  // A second signature (perhaps for someone else) starts with an empty form, not the first person's details.
  await choose(page, 1);
  for (const k of Object.keys(FULL)) assert.equal(await page.inputValue(`#f-${k}`), "", `${k} should start blank`);
  assert.deepEqual(problems, []);
  await ctx.close();
});

test("every step fits a phone screen without sideways scrolling, and the actions stay reachable", { skip }, async () => {
  const { ctx, page } = await fresh({ width: 390, height: 800 });
  await page.goto(`${BASE}/create`, { waitUntil: "networkidle" });
  assert.ok(await noOverflow(page), "gallery overflows");
  assert.ok(await page.getByRole("link", { name: "Customize template" }).isVisible());
  await page.getByRole("link", { name: "Choose", exact: true }).first().click();
  await page.waitForURL(/\/create\/details/);
  assert.ok(await noOverflow(page), "questions overflow");
  await toPreview(page, FULL);
  assert.ok(await noOverflow(page), "preview overflows");
  // On a phone the big preview comes first, then the list.
  const big = await page.locator(PICKS).boundingBox();
  const list = await page.locator('aside[aria-label="Templates"]').boundingBox();
  assert.ok(big.y < list.y, "preview above the list on narrow screens");
  assert.ok(await page.getByRole("button", { name: /^Choose / }).first().isVisible());
  await page.getByRole("button", { name: "Preview Classic in an email" }).click();
  assert.ok(await noOverflow(page), "preview dialog overflows");
  const box = await page.getByRole("dialog").boundingBox();
  assert.ok(box.x >= 0 && box.x + box.width <= 391, `dialog fits the phone: ${JSON.stringify(box)}`);
  assert.ok(await page.getByRole("button", { name: "Choose this signature" }).isVisible());
  await ctx.close();
});

for (const height of [700, 900, 1200]) test(`step 3: the template list stays in view while the picks on the right scroll (${height}px tall screen)`, { skip }, async () => {
  const { ctx, page } = await fresh({ width: 1440, height });
  await choose(page, 0);
  await toPreview(page, FULL);
  for (let n = 1; n <= 4; n++) await tick(page, await nthTemplateName(page, n)).check(); // five tall cards on the right
  const aside = page.locator("aside[aria-label=Templates]");
  const picks = page.locator(PICKS);
  const header = await page.locator("header.sticky").first().boundingBox();
  const vh = page.viewportSize().height;
  const fits = (box, when) => {
    assert.ok(box.y >= header.y + header.height - 1, `${when}: list starts at y=${box.y}, under the header (ends ${header.y + header.height})`);
    assert.ok(box.y + box.height <= vh, `${when}: list ends at y=${box.y + box.height}, past the screen (${vh})`);
  };
  // Whatever element scrolls (the app frame on desktop, the window otherwise), move it in steps down to the very end.
  const scrollTo = (frac) =>
    picks.evaluate((el, frac) => {
      let n = el.parentElement;
      while (n && n.scrollHeight <= n.clientHeight + 1) n = n.parentElement;
      const scroller = n ?? document.scrollingElement;
      scroller.scrollTop = (scroller.scrollHeight - scroller.clientHeight) * frac;
      return scroller.scrollTop;
    }, frac);
  fits(await aside.boundingBox(), "at the top");
  let previous = -1;
  for (const frac of [0.25, 0.5, 0.75, 1]) {
    const scrolled = await scrollTo(frac);
    assert.ok(scrolled > previous, `the page really scrolled to ${scrolled}px`);
    previous = scrolled;
    await page.waitForTimeout(150);
    fits(await aside.boundingBox(), `scrolled to ${Math.round(frac * 100)}%`);
  }
  assert.ok(previous > 400, `there was a lot to scroll (${previous}px)`);
  const after = await aside.boundingBox();
  // And it has its own scroll, so its last templates are reachable.
  assert.ok(await aside.evaluate((el) => el.scrollHeight > el.clientHeight), "list scrolls inside itself");
  await ctx.close();
});
