/**
 * Manual smoke run: drives the whole product through a real browser against a real
 * `next start` server with a fresh database. Not a test — it is the walkthrough you would
 * do by hand, so failures read as "this step did not work", with a screenshot.
 *
 * Run: node smoke.mjs   (server must already be running on 3200)
 */
import { chromium } from "playwright";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as sdb from "./scripts/smoke-db.mjs";
import { audit, summarise } from "./scripts/responsive-audit.mjs";

// From a laptop, every Postgres query crosses to the database and back.
const WAIT = process.env.DATABASE_URL ? 45_000 : 8_000;

const BASE = "http://localhost:3200";
// The system temp folder, so this works the same on Windows, macOS and Linux.
const OUT = path.join(os.tmpdir(), "sagora-smoke");
const OUTBOX = path.join(process.cwd(), "data", "dev-outbox.jsonl");
fs.mkdirSync(OUT, { recursive: true });

const run = Date.now();
const FARMER = { name: "Isatu Conteh", phone: "076 414 515", email: `smoke.farmer.${run}@example.com`, pass: "smoke-farmer-2026" };
const PROV = { business: "Smoke Tractors", phone: "077 515 616", email: `smoke.prov.${run}@example.com`, pass: "smoke-prov-2026" };
const STAFF = { business: "Smoke Coordinator", phone: "079 616 717", email: `smoke.staff.${run}@example.com`, pass: "smoke-staff-2026" };

const steps = [];
let shot = 0;
const inDays = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

function mails(email) {
  if (!fs.existsSync(OUTBOX)) return [];
  return fs.readFileSync(OUTBOX, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((m) => m.to === email);
}
async function code(email) {
  for (let i = 0; i < 80; i++) {
    const m = mails(email).filter((x) => /code is \d{7}/.test(x.text));
    if (m.length) return m[m.length - 1].text.match(/code is (\d{7})/)[1];
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no verification email arrived for ${email}`);
}

const browser = await chromium.launch(
  fs.existsSync("/opt/pw-browsers/chromium-1243/chrome-linux64/chrome")
    ? { executablePath: "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" }
    : {},
);
async function newPage() {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 950 }, baseURL: BASE });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => steps.push({ name: `JS ERROR: ${e.message}`, ok: false }));
  page.on("response", (r) => {
    if (r.status() >= 500) steps.push({ name: `HTTP ${r.status()} on ${r.url().replace(BASE, "")}`, ok: false });
  });
  return { ctx, page };
}
async function step(name, page, fn) {
  try {
    await fn();
    steps.push({ name, ok: true });
  } catch (err) {
    const file = path.join(OUT, `fail-${++shot}.png`);
    try { await page.screenshot({ path: file, fullPage: true }); } catch {}
    steps.push({ name, ok: false, error: String(err).split("\n")[0], shot: file });
  }
}
async function verify(page, email) {
  const c = await code(email);
  await page.getByLabel("Digit 1 of 7").click();
  await page.keyboard.type(c);
  await page.waitForURL((u) => !u.pathname.includes("verify-email"), { timeout: WAIT });
}

/** Staff screens need a second factor: a code emailed to the staff account itself. */
async function passStaffCheck(page, email, landing) {
  await page.goto(landing);
  if (!/\/staff\/verify$/.test(page.url())) return;
  const c = await code(email);
  await page.getByLabel("Digit 1 of 7").click();
  await page.keyboard.type(c);
  await page.waitForURL((u) => !u.pathname.includes("/staff/verify"), { timeout: WAIT });
  await page.goto(landing);
}

/* ---------------------------------------------------------------- farmer */
const f = await newPage();
await step("Farmer creates an account", f.page, async () => {
  await f.page.goto("/farmer/sign-up");
  await f.page.getByLabel("First and last name").fill(FARMER.name);
  await f.page.getByLabel("Your phone number").fill(FARMER.phone);
  await f.page.getByLabel("Email").fill(FARMER.email);
  await f.page.getByLabel("Password", { exact: true }).fill(FARMER.pass);
  await f.page.getByRole("button", { name: "Create account" }).click();
  await f.page.waitForURL(/verify-email/);
});
await step("Farmer verifies the emailed code and lands on home", f.page, async () => {
  await verify(f.page, FARMER.email);
  if (!/\/farmer\/home$/.test(f.page.url())) throw new Error(`landed on ${f.page.url()}`);
});

let reference = "";
await step("Farmer books ploughing and gets a reference", f.page, async () => {
  await f.page.goto("/farmer/book");
  await f.page.getByLabel("What work do you need?").selectOption("ploughing");
  await f.page.getByLabel("Land size").fill("4");
  await f.page.getByLabel("Easy access").check();
  await f.page.getByLabel("Cleared").check();
  await f.page.getByRole("button", { name: "Continue" }).click();
  await f.page.getByLabel("District").selectOption("Bombali");
  await f.page.getByLabel("Village/town").fill("Mabanta Village");
  await f.page.getByLabel("Preferred start date").fill(inDays(35));
  await f.page.getByLabel("Additional notes").fill("Some stumps near the road.");
  await f.page.getByRole("button", { name: "Send request" }).click();
  await f.page.waitForURL(/\/farmer\/requests\?new=/);
  reference = (await f.page.getByText(/Request SG-\d+ sent/).innerText()).match(/SG-\d+/)[0];
  await f.page.screenshot({ path: path.join(OUT, "01-farmer-requests.png"), fullPage: true });
});
await step("Farmer gets the reference by email", f.page, async () => {
  const m = mails(FARMER.email).find((x) => x.text.includes(reference));
  if (!m) throw new Error("no email with the reference");
});

/* -------------------------------------------------------------- provider */
const p = await newPage();
await step("Provider creates an account and verifies", p.page, async () => {
  await p.page.goto("/provider/sign-up");
  await p.page.getByLabel("Business name").fill(PROV.business);
  await p.page.getByLabel("Your phone number").fill(PROV.phone);
  await p.page.getByLabel("Email").fill(PROV.email);
  await p.page.getByLabel("Password", { exact: true }).fill(PROV.pass);
  await p.page.getByRole("button", { name: "Create account" }).click();
  await verify(p.page, PROV.email);
});
await step("Provider is blocked from the workspace before approval", p.page, async () => {
  await p.page.goto("/provider/requests");
  if (!/\/provider\/setup$/.test(p.page.url())) throw new Error(`reached ${p.page.url()}`);
});
await step("Provider completes setup and submits for review", p.page, async () => {
  await p.page.getByLabel("District").selectOption("Bombali");
  await p.page.getByLabel("Ploughing").check();
  await p.page.getByLabel("Town or village").fill("Makeni");
  await p.page.getByRole("button", { name: "Submit for review" }).click();
  await p.page.getByRole("heading", { name: "Waiting for Sagora to review your business" }).waitFor();
  await p.page.screenshot({ path: path.join(OUT, "02-provider-waiting.png"), fullPage: true });
});

/* ----------------------------------------------------------------- staff */
const s = await newPage();
await step("Staff account is created and promoted", s.page, async () => {
  await s.page.goto("/provider/sign-up");
  await s.page.getByLabel("Business name").fill(STAFF.business);
  await s.page.getByLabel("Your phone number").fill(STAFF.phone);
  await s.page.getByLabel("Email").fill(STAFF.email);
  await s.page.getByLabel("Password", { exact: true }).fill(STAFF.pass);
  await s.page.getByRole("button", { name: "Create account" }).click();
  await verify(s.page, STAFF.email);
  // "user" is a reserved word in Postgres; the quotes are required there and harmless on SQLite.
  await sdb.run(`UPDATE "user" SET role='staff' WHERE email=?`, STAFF.email);
});
await step("A staff password alone does not open the staff screens", s.page, async () => {
  await s.page.goto("/staff/sign-in");
  await s.page.getByLabel("Email").fill(STAFF.email);
  await s.page.getByLabel("Password", { exact: true }).fill(STAFF.pass);
  await s.page.getByRole("button", { name: "Sign in" }).click();
  await s.page.waitForURL(/\/staff\/verify$/, { timeout: WAIT });
  await s.page.goto("/staff/payments");
  if (!/\/staff\/verify$/.test(s.page.url())) throw new Error(`no second factor: landed on ${s.page.url()}`);
  await s.page.screenshot({ path: path.join(OUT, "03a-staff-verify.png"), fullPage: true });
});
await step("Staff reviews and approves the provider", s.page, async () => {
  await passStaffCheck(s.page, STAFF.email, "/staff/providers");
  await s.page.waitForLoadState("networkidle");
  const card = s.page.locator("section").filter({ hasText: PROV.email });
  await card.getByRole("button", { name: "Approve" }).click();
  await s.page.waitForTimeout(800);
  await s.page.screenshot({ path: path.join(OUT, "03-staff-review.png"), fullPage: true });
});

/* ------------------------------------------------- provider does the work */
await step("Approved provider reaches the workspace", p.page, async () => {
  await p.page.goto("/provider/sign-in");
  await p.page.getByLabel("Email").fill(PROV.email);
  await p.page.getByLabel("Password", { exact: true }).fill(PROV.pass);
  await p.page.getByRole("button", { name: "Sign in" }).click();
  await p.page.waitForURL(/\/provider\/dashboard$/);
});
await step("Provider adds a tractor to the equipment register", p.page, async () => {
  await p.page.goto("/provider/equipment");
  await p.page.getByRole("button", { name: "Add equipment" }).click();
  const d = p.page.getByRole("dialog");
  await d.getByLabel("What is it?").selectOption("tractor");
  await d.getByLabel("Name", { exact: true }).fill("Blue Massey");
  await d.getByLabel("Registration or serial number").fill("SM-001");
  await d.getByRole("button", { name: "Add machine" }).click();
  await p.page.getByRole("dialog").waitFor({ state: "detached", timeout: WAIT });
  await p.page.reload();
  await p.page.getByText("Blue Massey").waitFor();
  await p.page.screenshot({ path: path.join(OUT, "04-equipment.png"), fullPage: true });
});
await step("Provider sees the farmer's request and the filters work", p.page, async () => {
  await p.page.goto("/provider/requests");
  await p.page.getByRole("button", { name: `Open request ${reference}` }).waitFor();
  await p.page.screenshot({ path: path.join(OUT, "05-provider-requests.png"), fullPage: true });
  await p.page.goto("/provider/requests?district=Kono");
  await p.page.getByText("No requests match these filters yet.").waitFor();
});
await step("Provider sends a quote", p.page, async () => {
  await p.page.goto("/provider/requests");
  await p.page.getByRole("button", { name: `Open request ${reference}` }).click();
  const d = p.page.getByRole("dialog");
  await d.getByRole("tab", { name: "My quote" }).click();
  await d.getByLabel("Total price (Le)").fill("2,400.00");
  await d.getByLabel("What the price covers").fill("Tractor, plough and operator");
  await d.getByLabel("Can start on").fill(inDays(20));
  await d.getByLabel("Price holds until").fill(inDays(15));
  await d.getByRole("button", { name: "Send a quote" }).click();
  await d.page().getByText("Quote sent to the farmer.").waitFor();
  await p.page.screenshot({ path: path.join(OUT, "06-quote-sent.png") });
});

/* ------------------------------------------------------ farmer accepts it */
await step("Farmer sees the quote and accepts it", f.page, async () => {
  await f.page.goto("/farmer/requests");
  await f.page.getByRole("link", { name: reference }).click();
  await f.page.getByText("Le 2,400.00").waitFor();
  await f.page.getByRole("button", { name: "Accept quote" }).click();
  await f.page.getByRole("dialog", { name: "Confirm" }).getByRole("button", { name: "Accept quote" }).click();
  await f.page.getByText("The price and terms are now fixed").waitFor();
  await f.page.screenshot({ path: path.join(OUT, "07-farmer-accepted.png"), fullPage: true });
});
await step("The accepted amount is frozen in an agreement", f.page, async () => {
  const row = await sdb.get(
    "SELECT amount_minor FROM agreement WHERE request_id=(SELECT id FROM service_request WHERE reference=?)",
    reference,
  );
  if (!row || Number(row.amount_minor) !== 240000) throw new Error(`agreement says ${JSON.stringify(row)}`);
});
await step("Provider is told their quote was accepted", p.page, async () => {
  if (!mails(PROV.email).some((m) => m.subject.includes("was accepted"))) throw new Error("no acceptance email");
  await p.page.goto("/provider/quotes");
  await p.page.getByText("Le 2,400.00").waitFor();
  await p.page.screenshot({ path: path.join(OUT, "08-my-quotes.png"), fullPage: true });
});

/* ------------------------------------------------------------- the money */
await step("Provider schedules the work, committing the tractor", p.page, async () => {
  await p.page.goto("/provider/jobs");
  await p.page.getByRole("button", { name: `Open job ${reference}` }).click();
  const card = p.page.getByRole("dialog", { name: `Job ${reference}` });
  await card.getByRole("button", { name: "Schedule" }).click();
  const d = p.page.getByRole("dialog");
  await d.getByLabel("Work starts").fill(inDays(20));
  await d.getByLabel("Work ends").fill(inDays(21));
  await d.getByLabel("Blue Massey").check();
  await d.getByRole("button", { name: "Commit the machines" }).click();
  await p.page.getByRole("dialog").waitFor({ state: "detached", timeout: WAIT });
  await p.page.screenshot({ path: path.join(OUT, "09-job-scheduled.png"), fullPage: true });
});
await step("Staff records a part payment, which does not book the job", s.page, async () => {
  await passStaffCheck(s.page, STAFF.email, "/staff/payments");
  const row = s.page.getByRole("row").filter({ hasText: reference });
  await row.getByText("Record a payment", { exact: true }).click();
  await row.getByLabel("Amount received").fill("1,000.00");
  await row.getByLabel("Receipt or transaction reference").fill(`MM-SMOKE-${run}-1`);
  await row.getByRole("button", { name: "Record it" }).click();
  await s.page.getByText("the booking is not confirmed yet").waitFor();
  await s.page.screenshot({ path: path.join(OUT, "10-staff-payments.png"), fullPage: true });
});
await step("The same receipt reference is refused the second time", s.page, async () => {
  const row = s.page.getByRole("row").filter({ hasText: reference });
  await row.getByText("Record a payment", { exact: true }).click();
  await row.getByLabel("Amount received").fill("100.00");
  await row.getByLabel("Receipt or transaction reference").fill(`MM-SMOKE-${run}-1`);
  await row.getByRole("button", { name: "Record it" }).click();
  await s.page.getByText("has already been recorded").waitFor();
});
await step("Paying the balance books the job in one decision", s.page, async () => {
  const row = s.page.getByRole("row").filter({ hasText: reference });
  await row.getByText("Record a payment", { exact: true }).click();
  await row.getByLabel("Receipt or transaction reference").fill(`BK-SMOKE-${run}-2`);
  await row.getByRole("button", { name: "Record it" }).click();
  await s.page.getByText("Paid in full and booked").waitFor();
});
await step("Both sides are emailed that it is booked", s.page, async () => {
  for (let i = 0; i < 40; i++) {
    if (mails(FARMER.email).some((m) => m.subject.includes("is booked"))) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  if (!mails(FARMER.email).some((m) => m.subject.includes("is booked"))) throw new Error("farmer was not told");
  if (!mails(PROV.email).some((m) => m.subject.includes("paid and booked"))) throw new Error("provider was not told");
});
await step("The farmer sees payment and booking as two separate things", f.page, async () => {
  await f.page.goto(`/farmer/requests`);
  await f.page.getByRole("link", { name: reference }).click();
  await f.page.getByText("Payment complete").waitFor();
  await f.page.getByText("Booking confirmed").waitFor();
  await f.page.goto("/farmer/payments");
  await f.page.getByText(`MM-SMOKE-${run}-1`).waitFor();
  await f.page.screenshot({ path: path.join(OUT, "11-farmer-payments.png"), fullPage: true });
});
await step("No payout before the farmer confirms the work", s.page, async () => {
  await s.page.goto("/staff/payments?tab=releases");
  if (await s.page.getByRole("heading", { name: "Ready to pay out" }).count()) {
    throw new Error("a payout was offered before the farmer confirmed");
  }
});
await step("Provider reports the work and the farmer confirms it", p.page, async () => {
  await p.page.goto("/provider/jobs");
  await p.page.getByRole("button", { name: `Open job ${reference}` }).click();
  await p.page.getByRole("dialog", { name: `Job ${reference}` }).getByRole("button", { name: "Start work" }).click();
  await p.page.waitForTimeout(500);
  await p.page.getByRole("dialog", { name: `Job ${reference}` }).getByRole("button", { name: "Report work done" }).click();
  const d = p.page.getByRole("dialog");
  await d.getByLabel("How much was done (acres)").fill("6");
  await d.getByRole("button", { name: "Report the work" }).click();
  await p.page.getByRole("dialog").waitFor({ state: "detached", timeout: WAIT });

  await f.page.goto("/farmer/requests");
  await f.page.getByRole("link", { name: reference }).click();
  await f.page.getByRole("button", { name: "Confirm the work was done" }).click();
  await f.page.getByText("confirmed the work").waitFor();
});
await step("A payout needs a second person to approve it", s.page, async () => {
  await s.page.goto("/staff/payments?tab=releases");
  await s.page.getByRole("heading", { name: "Ready to pay out" }).waitFor();
  await s.page.getByRole("button", { name: "Prepare the payout" }).click();
  await s.page.getByText("A second person must approve it").waitFor();
  const release = s.page.locator("section.staff__item").filter({ hasText: "Payout" });
  await release.getByRole("button", { name: "Approve it" }).click();
  await s.page.getByText("cannot approve it").waitFor();
  await s.page.screenshot({ path: path.join(OUT, "12-payout-two-person.png"), fullPage: true });
});
await step("The books balance at the end of all of it", s.page, async () => {
  await s.page.goto("/staff/payments?tab=books");
  await s.page.getByText("The ledger balances").waitFor();
  await s.page.screenshot({ path: path.join(OUT, "13-reconciliation.png"), fullPage: true });
});

await step("The farmer app has its own sidebar and screens", f.page, async () => {
  for (const [url, text] of [
    ["/farmer/home", "How it works"],
    ["/farmer/bookings", "Bookings"],
    ["/farmer/payments", "Transaction ID"],
    ["/farmer/notifications", "Notifications"],
    ["/farmer/settings", "Sign out of Sagora"],
    ["/farmer/settings/account", "First and last name"],
  ]) {
    await f.page.goto(url);
    await f.page.getByText(text).first().waitFor({ timeout: WAIT });
  }
  await f.page.goto("/farmer/home");
  await f.page.waitForLoadState("networkidle");
  await f.page.screenshot({ path: path.join(OUT, "14-farmer-home.png"), fullPage: true });
});
await step("The booked job shows under the farmer's bookings", f.page, async () => {
  await f.page.goto("/farmer/bookings?tab=completed");
  await f.page.getByText(reference).first().waitFor({ timeout: WAIT });
  await f.page.screenshot({ path: path.join(OUT, "15-farmer-bookings.png"), fullPage: true });
});
await step("Both sides see the same events in their notifications", f.page, async () => {
  await f.page.goto("/farmer/notifications");
  await f.page.getByText("Booking confirmed").first().waitFor({ timeout: WAIT });
  await f.page.screenshot({ path: path.join(OUT, "16-farmer-notifications.png"), fullPage: true });

  await p.page.goto("/provider/notifications");
  await p.page.getByText("Quote accepted").first().waitFor({ timeout: WAIT });
});
await step("A verification code never appears in the notification list", f.page, async () => {
  await f.page.goto("/farmer/notifications");
  const text = await f.page.locator("main").innerText();
  if (/\bcode is \d{7}\b/.test(text)) throw new Error("a one-time code is on screen");
  if (/verification/i.test(text)) throw new Error("a verification email is in the list");
});
await step("The provider dashboard counts real work, not invented numbers", p.page, async () => {
  await p.page.goto("/provider/dashboard");
  await p.page.getByText("Business overview").waitFor({ timeout: WAIT });
  await p.page.getByText("All jobs").waitFor();
  await p.page.waitForLoadState("networkidle");
  await p.page.screenshot({ path: path.join(OUT, "17-provider-dashboard.png"), fullPage: true });
});

/* ------------------------------------------------------------- the rest */

await step("Provider settings, team, jobs and account screens open", p.page, async () => {
  for (const [url, heading] of [
    ["/provider/dashboard", null],
    ["/provider/jobs", "My Jobs"],
    ["/provider/payments", "Payments"],
    ["/provider/notifications", "Notifications"],
    ["/provider/settings", "Settings"],
    ["/provider/settings/business", "Business details"],
    ["/provider/settings/account", "Account"],
    ["/provider/settings/password", "Password and security"],
    ["/provider/team", "Team management"],
  ]) {
    await p.page.goto(url);
    // The dashboard greets the person by name and time of day rather than naming the business.
    if (heading === null) await p.page.getByText(/Good (morning|afternoon|evening),/).first().waitFor({ timeout: WAIT });
    else await p.page.getByRole("heading", { name: heading, level: 1 }).waitFor({ timeout: WAIT });
  }
});
await step("Every page fits every screen, from a small phone up", p.page, async () => {
  const report = [];
  await f.page.goto("/farmer/requests");
  const detail = await f.page.getByRole("link", { name: reference }).first().getAttribute("href");
  await audit(f.page, [
    "/farmer/home", "/farmer/book", "/farmer/book?service=ploughing", "/farmer/requests", detail, "/farmer/bookings", "/farmer/payments",
    "/farmer/notifications", "/farmer/search?q=a", "/farmer/settings", "/farmer/settings/account", "/farmer/settings/password", "/farmer/help",
  ], report);
  await audit(p.page, [
    "/provider/dashboard", "/provider/requests", "/provider/quotes", "/provider/jobs", "/provider/jobs/schedule", "/provider/jobs/new",
    "/provider/equipment", "/provider/payments", "/provider/notifications", "/provider/team", "/provider/reports", "/provider/help",
    "/provider/search?q=a", "/provider/settings", "/provider/settings/account", "/provider/settings/business", "/provider/settings/password",
  ], report);
  await audit(s.page, ["/staff/providers", "/staff/payments", "/staff/payments?tab=releases", "/staff/payments?tab=books", "/staff/outbox"], report);
  const guest = await (await browser.newContext({ baseURL: BASE })).newPage();
  await audit(guest, [
    "/provider/sign-in", "/provider/sign-up", "/provider/forgot-password", "/farmer/sign-in", "/farmer/sign-up", "/farmer/forgot-password", "/staff/sign-in",
  ], report);
  fs.writeFileSync(path.join(OUT, "responsive.json"), JSON.stringify(report, null, 1));
  // What a phone actually shows, for a person to look at: numbers cannot judge a layout.
  const shot = async (page, name, url, then) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(url);
    await page.waitForLoadState("networkidle").catch(() => {});
    if (then) await then();
    await page.screenshot({ path: path.join(OUT, `phone-${name}.png`) });
    await page.setViewportSize({ width: 1440, height: 950 });
  };
  await shot(f.page, "home", "/farmer/home");
  await shot(f.page, "menu", "/farmer/home", () => f.page.locator(".nav__burger").click());
  await shot(f.page, "book", "/farmer/book?service=ploughing");
  await shot(f.page, "request", detail);
  await shot(p.page, "requests", "/provider/requests");
  await shot(p.page, "modal", "/provider/requests", () => p.page.getByRole("button", { name: /Open request/ }).first().click());
  await shot(p.page, "payments", "/provider/payments");
  await shot(p.page, "schedule", "/provider/jobs/schedule");
  const { failing, small, zooms } = summarise(report);
  console.log(`      ${report.length} page and width checks: ${failing.length} failing, ${small} small tap targets, ${zooms} fields that zoom on iPhone`);
  if (failing.length) throw new Error(`${failing.length} checks failed: ${failing.slice(0, 5).map((r) => `${r.url}@${r.width}`).join(", ")}`);
});
await step("Unbuilt sections say so instead of breaking", p.page, async () => {
  for (const url of ["/provider/reports"]) {
    await p.page.goto(url);
    await p.page.getByText("Not built yet.").waitFor({ timeout: WAIT });
  }
});
await step("Signing out closes the workspace", p.page, async () => {
  await p.page.goto("/provider/settings");
  await p.page.getByRole("button", { name: "Logout" }).click();
  await p.page.waitForURL(/\/provider\/sign-in$/);
  await p.page.goto("/provider/requests");
  if (!/\/provider\/sign-in$/.test(p.page.url())) throw new Error(`still in at ${p.page.url()}`);
});

await browser.close();
await sdb.close();

const failed = steps.filter((s) => !s.ok);
console.log("\n================ SMOKE RUN ================");
for (const s of steps) console.log(`${s.ok ? " OK " : "FAIL"}  ${s.name}${s.error ? `\n        ${s.error}` : ""}${s.shot ? `\n        ${s.shot}` : ""}`);
console.log(`\n${steps.length - failed.length}/${steps.length} steps passed. Screenshots in ${OUT}`);
process.exit(failed.length ? 1 : 0);
