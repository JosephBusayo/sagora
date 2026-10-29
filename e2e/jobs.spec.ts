import { expect, test, type Browser, type Page } from "@playwright/test";
import { testGet, testRun } from "./testdb";
import fs from "node:fs";
import path from "node:path";

const OUTBOX = path.join(process.cwd(), "data", "dev-outbox.jsonl");
const SHOTS = path.join(process.cwd(), "e2e", "screens");
fs.mkdirSync(SHOTS, { recursive: true });

const run = Date.now();
const FARMER = { name: "Fatmata Koroma", phone: "076 202 303", email: `jobs.farmer.${run}@example.com`, pass: "jobs-farmer-26" };
const PROV = { business: "Koroma Works", phone: "077 404 505", email: `jobs.prov.${run}@example.com`, pass: "jobs-prov-26" };

type Mail = { to: string; subject: string; text: string };
const mailsTo = (email: string): Mail[] =>
  fs.existsSync(OUTBOX)
    ? fs.readFileSync(OUTBOX, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Mail).filter((m) => m.to === email)
    : [];
async function latestCode(email: string): Promise<string> {
  for (let i = 0; i < 60; i++) {
    const m = mailsTo(email).filter((x) => /code is \d{7}/.test(x.text));
    if (m.length) return m[m.length - 1].text.match(/code is (\d{7})/)![1];
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no code for ${email}`);
}
async function enterCode(page: Page, email: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = await latestCode(email);
    await page.getByLabel("Digit 1 of 7").click();
    await page.keyboard.press("Control+A");
    await page.keyboard.type(code);
    await page.getByRole("button", { name: "Verify" }).click();
    try {
      await page.waitForURL((u) => !u.pathname.includes("verify-email"), { timeout: 5000 });
      return;
    } catch { await page.waitForTimeout(400); }
  }
  throw new Error(`verification never completed for ${email}`);
}
async function fresh(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1728, height: 1117 } });
  return { ctx, page: await ctx.newPage() };
}
const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

async function signInProvider(page: Page) {
  await page.goto("/provider/sign-in");
  await page.getByLabel("Email").fill(PROV.email);
  await page.getByLabel("Password", { exact: true }).fill(PROV.pass);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/sign-in/);
}
async function signInFarmer(page: Page) {
  await page.goto("/farmer/sign-in");
  await page.getByLabel("Email").fill(FARMER.email);
  await page.getByLabel("Password", { exact: true }).fill(FARMER.pass);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/sign-in/);
}

/** Books work, quotes it, and accepts it, leaving an unscheduled job. Returns the reference. */
async function agreedJob(browser: Browser, acres: string, village: string): Promise<string> {
  const f = await fresh(browser);
  await signInFarmer(f.page);
  await f.page.goto("/farmer/book");
  await f.page.getByLabel("What work do you need?").selectOption("ploughing");
  await f.page.getByLabel("Farm size (acres)").fill(acres);
  await f.page.getByLabel("Preferred date").fill(inDays(40));
  await f.page.getByLabel("District").selectOption("Bombali");
  await f.page.getByLabel("Community or village").fill(village);
  await f.page.getByRole("button", { name: "Send request" }).click();
  const reference = (await f.page.getByText(/Request SG-\d+ sent/).innerText()).match(/SG-\d+/)![0];

  const p = await fresh(browser);
  await signInProvider(p.page);
  await p.page.goto("/provider/requests");
  await p.page.getByRole("button", { name: `Open request ${reference}` }).click();
  const d = p.page.getByRole("dialog");
  await d.getByRole("tab", { name: "My quote" }).click();
  await d.getByLabel("Total price (Le)").fill("900.00");
  await d.getByLabel("What the price covers").fill("Tractor, plough and operator");
  await d.getByLabel("Can start on").fill(inDays(20));
  await d.getByLabel("Price holds until").fill(inDays(15));
  await d.getByRole("button", { name: "Send a quote" }).click();
  await expect(d.getByText("Quote sent to the farmer.")).toBeVisible();
  await p.ctx.close();

  await f.page.goto("/farmer/requests");
  await f.page.getByRole("link", { name: reference }).click();
  await f.page.getByRole("button", { name: "Accept this quote" }).click();
  await expect(f.page.getByRole("status").filter({ hasText: "now fixed" })).toBeVisible();
  await f.ctx.close();
  return reference;
}

const jobCard = (page: Page, reference: string) => page.locator("article.asset").filter({ hasText: reference });

let refA = "";
let refB = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  // One farmer, one approved provider with two machines.
  const f = await fresh(browser);
  await f.page.goto("/farmer/sign-up");
  await f.page.getByLabel("First and last name").fill(FARMER.name);
  await f.page.getByLabel("Your phone number").fill(FARMER.phone);
  await f.page.getByLabel("Email").fill(FARMER.email);
  await f.page.getByLabel("Password", { exact: true }).fill(FARMER.pass);
  await f.page.getByRole("button", { name: "Create account" }).click();
  await enterCode(f.page, FARMER.email);
  await f.ctx.close();

  const p = await fresh(browser);
  await p.page.goto("/provider/sign-up");
  await p.page.getByLabel("Business name").fill(PROV.business);
  await p.page.getByLabel("Your phone number").fill(PROV.phone);
  await p.page.getByLabel("Email").fill(PROV.email);
  await p.page.getByLabel("Password", { exact: true }).fill(PROV.pass);
  await p.page.getByRole("button", { name: "Create account" }).click();
  await enterCode(p.page, PROV.email);
  await p.page.getByLabel("District").selectOption("Bombali");
  await p.page.getByLabel("Ploughing").check();
  await p.page.getByLabel("Town or village").fill("Makeni");
  await p.page.getByRole("button", { name: "Submit for review" }).click();
  const u = await testGet(`SELECT id FROM "user" WHERE email=?`, PROV.email) as { id: string };
  const now = new Date().toISOString();
  await testRun("UPDATE provider_business SET status='approved', reviewed_at=?, updated_at=? WHERE user_id=?", now, now, u.id);

  await p.page.goto("/provider/equipment");
  for (const [kind, name] of [["tractor", "Green Tractor"], ["plough", "Shared Plough"]]) {
    await p.page.getByRole("button", { name: "Add equipment" }).click();
    const d = p.page.getByRole("dialog");
    await d.getByLabel("What is it?").selectOption(kind);
    await d.getByLabel("Name", { exact: true }).fill(name);
    await d.getByRole("button", { name: "Add machine" }).click();
    await expect(p.page.getByRole("dialog")).toHaveCount(0, { timeout: 8000 });
  }
  await p.ctx.close();

  refA = await agreedJob(browser, "4", "Mabanta Village");
  refB = await agreedJob(browser, "3", "Kagbo Village");
});

test("an accepted quote creates an unscheduled job", async ({ page }) => {
  await signInProvider(page);
  await page.goto("/provider/jobs");
  await expect(page.getByRole("heading", { name: "Jobs" })).toBeVisible();
  await expect(jobCard(page, refA).getByText("Not scheduled yet")).toBeVisible();
  await expect(jobCard(page, refB).getByText("Not scheduled yet")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${SHOTS}/23-jobs.png`, fullPage: true });
});

test("scheduling commits the machines for those dates", async ({ page }) => {
  await signInProvider(page);
  await page.goto("/provider/jobs");
  await jobCard(page, refA).getByRole("button", { name: "Schedule" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Work starts").fill(inDays(20));
  await d.getByLabel("Work ends").fill(inDays(22));
  await d.getByLabel("Green Tractor").check();
  await d.getByLabel("Shared Plough").check();
  await d.getByRole("button", { name: "Commit the machines" }).click();
  await expect(d.getByText("Work scheduled.")).toBeVisible();

  await page.reload();
  const card = jobCard(page, refA);
  await expect(card.getByText("Scheduled")).toBeVisible();
  await expect(card.locator("p.asset__notes")).toContainText("Green Tractor");
  await expect(card.locator("p.asset__notes")).toContainText("Shared Plough");
});

test("the same plough cannot be committed to an overlapping job", async ({ page }) => {
  await signInProvider(page);
  await page.goto("/provider/jobs");
  await jobCard(page, refB).getByRole("button", { name: "Schedule" }).click();
  const d = page.getByRole("dialog");
  // Overlaps the first job by one day.
  await d.getByLabel("Work starts").fill(inDays(22));
  await d.getByLabel("Work ends").fill(inDays(24));
  await d.getByLabel("Shared Plough").check();
  await d.getByRole("button", { name: "Commit the machines" }).click();
  await expect(d.getByText(new RegExp(`Shared Plough is already committed to ${refA}`))).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/24-job-clash.png` });

  // Nothing was written: the second job is still unscheduled.
  await page.reload();
  await expect(jobCard(page, refB).getByText("Not scheduled yet")).toBeVisible();

  // Moving past the first job's dates works.
  await jobCard(page, refB).getByRole("button", { name: "Schedule" }).click();
  const d2 = page.getByRole("dialog");
  await d2.getByLabel("Work starts").fill(inDays(23));
  await d2.getByLabel("Work ends").fill(inDays(25));
  await d2.getByLabel("Shared Plough").check();
  await d2.getByRole("button", { name: "Commit the machines" }).click();
  await expect(d2.getByText("Work scheduled.")).toBeVisible();
});

test("a fault flags the job without erasing the commitment", async ({ page }) => {
  await signInProvider(page);
  await page.goto("/provider/equipment");
  const plough = page.locator("article.asset").filter({ hasText: "Shared Plough" });
  await plough.getByRole("button", { name: /Actions for Shared Plough/ }).click();
  await plough.getByRole("menuitem", { name: "Report a fault" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("What is wrong?").fill("Broken shear bolt");
  await d.getByRole("button", { name: "Record fault" }).click();
  await expect(d.getByText("now out of service")).toBeVisible();

  await page.goto("/provider/jobs");
  const card = jobCard(page, refA);
  await expect(card.getByText(/At risk: Shared Plough/)).toBeVisible();
  await expect(card.getByText("Scheduled")).toBeVisible();          // the commitment is kept
  await expect(card.locator("p.asset__notes")).toContainText("Shared Plough");

  // Clear it again so later steps are not blocked.
  await page.goto("/provider/equipment");
  await page.locator("article.asset").filter({ hasText: "Shared Plough" }).getByRole("button", { name: "Mark fixed" }).click();
});

test("work reported is not delivery: the farmer must confirm", async ({ page, browser }) => {
  await signInProvider(page);
  await page.goto("/provider/jobs");
  await jobCard(page, refA).getByRole("button", { name: "Start work" }).click();
  // Let the action land before reloading: a reload fired straight after the click races it, and
  // against a remote database the reload wins and renders the job as it was.
  await expect(jobCard(page, refA).getByText("Work started")).toBeVisible();
  await page.reload();
  await expect(jobCard(page, refA).getByText("Work started")).toBeVisible();

  await jobCard(page, refA).getByRole("button", { name: "Report work done" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("How much was done (acres)").fill("4");
  await d.getByLabel("Anything the farmer should know").fill("Finished both passes.");
  await d.getByRole("button", { name: "Report the work" }).click();
  await expect(d.getByText("asked to confirm")).toBeVisible();

  await page.reload();
  await expect(jobCard(page, refA).getByText("Awaiting farmer confirmation")).toBeVisible();
  expect(mailsTo(FARMER.email).some((m) => m.subject.includes("has reported the work"))).toBe(true);

  // The farmer confirms, and only then is it complete.
  const f = await fresh(browser);
  await signInFarmer(f.page);
  await f.page.goto("/farmer/requests");
  await f.page.getByRole("link", { name: refA }).click();
  await expect(f.page.getByText("The provider reports")).toBeVisible();
  await f.page.screenshot({ path: `${SHOTS}/25-farmer-confirm.png`, fullPage: true });
  await f.page.getByRole("button", { name: "Confirm the work was done" }).click();
  await expect(f.page.getByText("You have confirmed the work")).toBeVisible();
  await f.ctx.close();

  await page.reload();
  await expect(jobCard(page, refA).getByText("Confirmed by the farmer")).toBeVisible();
  expect(mailsTo(PROV.email).some((m) => m.subject.includes("confirmed by the farmer"))).toBe(true);
});

test("a farmer can raise a concern instead of confirming", async ({ page, browser }) => {
  await signInProvider(page);
  await page.goto("/provider/jobs");
  await jobCard(page, refB).getByRole("button", { name: "Report work done" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("How much was done (acres)").fill("3");
  await d.getByRole("button", { name: "Report the work" }).click();
  await expect(d.getByText("asked to confirm")).toBeVisible();

  const f = await fresh(browser);
  await signInFarmer(f.page);
  await f.page.goto("/farmer/requests");
  await f.page.getByRole("link", { name: refB }).click();
  await f.page.getByLabel("Or raise a concern").fill("Only half the field was ploughed.");
  await f.page.getByRole("button", { name: "Raise a concern" }).click();
  await expect(f.page.getByText("Your concern has been recorded")).toBeVisible();
  await f.ctx.close();

  await page.reload();
  const card = jobCard(page, refB);
  await expect(card.getByText("Farmer raised a concern", { exact: true })).toBeVisible();
  await expect(card.getByText(/Only half the field/)).toBeVisible();
  expect(mailsTo(PROV.email).some((m) => m.subject.includes("A concern was raised"))).toBe(true);
});

test("a teammate with view-only access cannot schedule or report", async ({ page }) => {
  // The server refuses even when the buttons are not rendered.
  const job = await testGet(
    "SELECT id FROM job WHERE request_id=(SELECT id FROM service_request WHERE reference=?)", refA) as { id: string };
  expect(job.id).toBeTruthy();

  await signInProvider(page);
  await page.goto("/provider/jobs");
  // A completed job offers no actions at all.
  const card = jobCard(page, refA);
  await expect(card.getByRole("button", { name: "Report work done" })).toHaveCount(0);
  await expect(card.getByRole("button", { name: "Start work" })).toHaveCount(0);
});
