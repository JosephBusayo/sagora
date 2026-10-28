/**
 * Manual smoke run: drives the whole product through a real browser against a real
 * `next start` server with a fresh database. Not a test — it is the walkthrough you would
 * do by hand, so failures read as "this step did not work", with a screenshot.
 *
 * Run: node smoke.mjs   (server must already be running on 3200)
 */
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const BASE = "http://localhost:3200";
const OUT = "/tmp/smoke";
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
    const file = `${OUT}/fail-${++shot}.png`;
    try { await page.screenshot({ path: file, fullPage: true }); } catch {}
    steps.push({ name, ok: false, error: String(err).split("\n")[0], shot: file });
  }
}
async function verify(page, email) {
  const c = await code(email);
  await page.getByLabel("Digit 1 of 7").click();
  await page.keyboard.type(c);
  await page.getByRole("button", { name: "Verify" }).click();
  await page.waitForURL((u) => !u.pathname.includes("verify-email"), { timeout: 8000 });
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
  await f.page.getByLabel("Farm size (acres)").fill("4");
  await f.page.getByLabel("Preferred date").fill(inDays(35));
  await f.page.getByLabel("District").selectOption("Bombali");
  await f.page.getByLabel("Community or village").fill("Mabanta Village");
  await f.page.getByLabel("Anything the provider should know").fill("Some stumps near the road.");
  await f.page.getByRole("button", { name: "Send request" }).click();
  await f.page.waitForURL(/\/farmer\/requests\?new=/);
  reference = (await f.page.getByText(/Request SG-\d+ sent/).innerText()).match(/SG-\d+/)[0];
  await f.page.screenshot({ path: `${OUT}/01-farmer-requests.png`, fullPage: true });
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
  await p.page.screenshot({ path: `${OUT}/02-provider-waiting.png`, fullPage: true });
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
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync("data/smoke.db");
  db.exec("PRAGMA busy_timeout = 5000");
  db.prepare("UPDATE user SET role='staff' WHERE email=?").run(STAFF.email);
  db.close();
});
await step("Staff reviews and approves the provider", s.page, async () => {
  await s.page.goto("/provider/sign-in");
  await s.page.getByLabel("Email").fill(STAFF.email);
  await s.page.getByLabel("Password", { exact: true }).fill(STAFF.pass);
  await s.page.getByRole("button", { name: "Sign in" }).click();
  await s.page.goto("/staff/providers");
  await s.page.waitForLoadState("networkidle");
  const card = s.page.locator("section").filter({ hasText: PROV.email });
  await card.getByRole("button", { name: "Approve" }).click();
  await s.page.waitForTimeout(800);
  await s.page.screenshot({ path: `${OUT}/03-staff-review.png`, fullPage: true });
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
  await p.page.getByRole("dialog").waitFor({ state: "detached", timeout: 8000 });
  await p.page.reload();
  await p.page.getByText("Blue Massey").waitFor();
  await p.page.screenshot({ path: `${OUT}/04-equipment.png`, fullPage: true });
});
await step("Provider sees the farmer's request and the filters work", p.page, async () => {
  await p.page.goto("/provider/requests");
  await p.page.getByRole("button", { name: `Open request ${reference}` }).waitFor();
  await p.page.screenshot({ path: `${OUT}/05-provider-requests.png`, fullPage: true });
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
  await d.getByText("Quote sent to the farmer.").waitFor();
  await p.page.screenshot({ path: `${OUT}/06-quote-sent.png` });
});

/* ------------------------------------------------------ farmer accepts it */
await step("Farmer sees the quote and accepts it", f.page, async () => {
  await f.page.goto("/farmer/requests");
  await f.page.getByRole("link", { name: reference }).click();
  await f.page.getByText("Le 2,400.00").waitFor();
  await f.page.getByRole("button", { name: "Accept this quote" }).click();
  await f.page.getByText("The price and terms are now fixed").waitFor();
  await f.page.screenshot({ path: `${OUT}/07-farmer-accepted.png`, fullPage: true });
});
await step("The accepted amount is frozen in an agreement", f.page, async () => {
  const { DatabaseSync } = await import("node:sqlite");
  const db = new DatabaseSync("data/smoke.db");
  db.exec("PRAGMA busy_timeout = 5000");
  const row = db.prepare(
    "SELECT amount_minor FROM agreement WHERE request_id=(SELECT id FROM service_request WHERE reference=?)",
  ).get(reference);
  db.close();
  if (!row || Number(row.amount_minor) !== 240000) throw new Error(`agreement says ${JSON.stringify(row)}`);
});
await step("Provider is told their quote was accepted", p.page, async () => {
  if (!mails(PROV.email).some((m) => m.subject.includes("was accepted"))) throw new Error("no acceptance email");
  await p.page.goto("/provider/quotes");
  await p.page.getByText("Le 2,400.00").waitFor();
  await p.page.screenshot({ path: `${OUT}/08-my-quotes.png`, fullPage: true });
});

/* ------------------------------------------------------------- the rest */
await step("Provider settings, team and account screens open", p.page, async () => {
  for (const [url, heading] of [
    ["/provider/settings", "Settings"],
    ["/provider/settings/business", "Business details"],
    ["/provider/settings/account", "Account"],
    ["/provider/settings/password", "Password and security"],
    ["/provider/team", "Team management"],
  ]) {
    await p.page.goto(url);
    await p.page.getByRole("heading", { name: heading, level: 1 }).waitFor({ timeout: 8000 });
  }
});
await step("Unbuilt sections say so instead of breaking", p.page, async () => {
  for (const url of ["/provider/dashboard", "/provider/jobs", "/provider/payments", "/provider/notifications", "/provider/reports", "/provider/help"]) {
    await p.page.goto(url);
    await p.page.getByText("Not built yet.").waitFor({ timeout: 8000 });
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

const failed = steps.filter((s) => !s.ok);
console.log("\n================ SMOKE RUN ================");
for (const s of steps) console.log(`${s.ok ? " OK " : "FAIL"}  ${s.name}${s.error ? `\n        ${s.error}` : ""}${s.shot ? `\n        ${s.shot}` : ""}`);
console.log(`\n${steps.length - failed.length}/${steps.length} steps passed. Screenshots in ${OUT}`);
process.exit(failed.length ? 1 : 0);
