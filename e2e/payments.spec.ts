import { expect, test, type Browser, type Page } from "@playwright/test";
import { confirmChecks, completeApplication } from "./checks";
import { testGet, testRun } from "./testdb";
import { STUB_PORT, startMonimeStub } from "./monime-stub";
import fs from "node:fs";
import path from "node:path";

const OUTBOX = path.join(process.cwd(), "data", "dev-outbox.jsonl");
const SHOTS = path.join(process.cwd(), "e2e", "screens");
fs.mkdirSync(SHOTS, { recursive: true });

const run = Date.now();
const FARMER = { name: "Aminata Sesay", phone: "076 303 404", email: `pay.farmer.${run}@example.com`, pass: "pay-farmer-26" };
const PROV = { business: "Sesay Tractors", phone: "077 505 606", email: `pay.prov.${run}@example.com`, pass: "pay-prov-26" };
const CLERK = { business: "Finance Clerk", phone: "078 606 707", email: `pay.clerk.${run}@example.com`, pass: "pay-clerk-26" };
const BOSS = { business: "Finance Approver", phone: "079 707 808", email: `pay.boss.${run}@example.com`, pass: "pay-boss-26" };

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
    try {
      await page.waitForURL((u) => !u.pathname.includes("verify-email"), { timeout: 5000 });
      return;
    } catch { await page.waitForTimeout(400); }
  }
  throw new Error(`verification never completed for ${email}`);
}
async function fresh(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1728, height: 1117 } });
  return { ctx, page: await confirmChecks(await ctx.newPage()) };
}
const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

async function signIn(page: Page, who: { email: string; pass: string }, area: "provider" | "farmer" | "staff") {
  await page.goto(`/${area}/sign-in`);
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password", { exact: true }).fill(who.pass);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/sign-in/);
}

async function makeStaff(who: { business: string; phone: string; email: string; pass: string }, browser: Browser) {
  const s = await fresh(browser);
  await s.page.goto("/provider/sign-up");
  await s.page.getByLabel("Business name").fill(who.business);
  await s.page.getByLabel("Your phone number").fill(who.phone);
  await s.page.getByLabel("Email").fill(who.email);
  await s.page.getByLabel("Password", { exact: true }).fill(who.pass);
  await s.page.getByRole("button", { name: "Create account" }).click();
  await enterCode(s.page, who.email);
  await s.ctx.close();
  await testRun(`UPDATE "user" SET role='staff' WHERE email=?`, who.email);
}

/** A job the farmer has agreed to and the provider has scheduled a machine for. */
async function scheduledJob(browser: Browser, acres: string, village: string, price: string, day: number): Promise<string> {
  const f = await fresh(browser);
  await signIn(f.page, FARMER, "farmer");
  await f.page.goto("/farmer/book");
  await f.page.getByLabel("What work do you need?").selectOption("ploughing");
  await f.page.getByLabel("Land size").fill(acres);
  await f.page.getByLabel("Easy access").check();
  await f.page.getByLabel("Cleared").check();
  await f.page.getByRole("button", { name: "Continue" }).click();
  await f.page.getByLabel("District").selectOption("Bombali");
  await f.page.getByLabel("Chiefdom").selectOption({ index: 1 });
  await f.page.getByLabel("Village/town").fill(village);
  await f.page.getByLabel("Preferred start date").fill(inDays(day + 30));
  await f.page.getByRole("button", { name: "Continue" }).click();
  await f.page.getByRole("button", { name: "Send request" }).click();
  const reference = (await f.page.getByText(/Request SG-\d+ sent/).innerText()).match(/SG-\d+/)![0];

  const p = await fresh(browser);
  await signIn(p.page, PROV, "provider");
  // Straight to this request: with the whole suite's requests in the list it may not be on page one.
  await p.page.goto(`/provider/requests?open=${reference}`);
  const d = p.page.getByRole("dialog");
  if (!(await d.isVisible())) await p.page.getByRole("button", { name: `Open request ${reference}` }).click();
  await d.getByRole("tab", { name: "My quote" }).click();
  await d.getByLabel("Total price (Le)").fill(price);
  await d.getByLabel("What the price covers").fill("Tractor, plough and operator");
  await d.getByLabel("Can start on").fill(inDays(day));
  await d.getByLabel("Price holds until").fill(inDays(20));
  await d.getByRole("button", { name: "Send a quote" }).click();
  await expect(d.page().getByText("Quote sent to the farmer.")).toBeVisible();

  await f.page.goto("/farmer/requests");
  await f.page.getByRole("link", { name: reference }).click();
  await f.page.getByRole("button", { name: "Accept quote" }).click();
  await f.page.getByRole("dialog", { name: "Confirm" }).getByRole("button", { name: "Accept quote" }).click();
  await expect(f.page.getByRole("status").filter({ hasText: "now fixed" })).toBeVisible();
  await f.ctx.close();

  await p.page.goto("/provider/jobs");
  await p.page.getByRole("button", { name: `Open job ${reference}` }).click();
  const card = p.page.getByRole("dialog", { name: `Job ${reference}` });
  await card.getByRole("button", { name: "Schedule" }).click();
  const s = p.page.getByRole("dialog");
  await s.getByLabel("Work starts").fill(inDays(day));
  await s.getByLabel("Work ends").fill(inDays(day + 1));
  await s.getByLabel("Green Tractor").check();
  await s.getByRole("button", { name: "Commit the equipment" }).click();
  await expect(p.page.getByRole("dialog")).toHaveCount(0, { timeout: 8000 });
  await p.ctx.close();
  return reference;
}

/** Staff screens need a second factor: a code emailed to the staff account itself. */
async function passStaffCheck(page: Page, email: string, landing = "/staff/payments") {
  await page.goto(landing);
  if (!/\/staff\/verify$/.test(page.url())) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    const c = await latestCode(email);
    await page.getByLabel("Digit 1 of 7").click();
    await page.keyboard.press("Control+A");
    await page.keyboard.type(c);
    try {
      await page.waitForURL((u) => !u.pathname.includes("/staff/verify"), { timeout: 5000 });
      await page.goto(landing);
      return;
    } catch { await page.waitForTimeout(400); }
  }
  throw new Error(`staff verification never completed for ${email}`);
}

const collectRow = (page: Page, reference: string) => page.getByRole("row").filter({ hasText: reference });

let refA = "";
let refB = "";
let refC = "";

test.beforeEach(async ({ page }) => { await confirmChecks(page); });

test.describe.configure({ mode: "serial" });

// The fixture signs four people up and walks two jobs to a scheduled state, so it needs room.
test.setTimeout(120_000);

test.beforeAll(async ({ browser }) => {
  test.setTimeout(180_000);
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
  await completeApplication(p.page);
  await p.page.getByRole("button", { name: "Submit for review" }).click();
  await expect(p.page.getByText("Waiting for Sagora to review your business")).toBeVisible();
  const u = await testGet(`SELECT id FROM "user" WHERE email=?`, PROV.email) as { id: string };
  const now = new Date().toISOString();
  await testRun("UPDATE provider_business SET status='approved', reviewed_at=?, updated_at=? WHERE user_id=?", now, now, u.id);

  await p.page.goto("/provider/equipment");
  await p.page.getByRole("button", { name: "Add equipment" }).click();
  const d = p.page.getByRole("dialog");
  await d.getByLabel("Equipment type").selectOption("tractor");
  await d.getByLabel("Brand").fill("Green Tractor".split(" ")[0]);
  await d.getByLabel("Model").fill("Green Tractor".split(" ").slice(1).join(" "));
  await d.getByRole("button", { name: "Continue" }).click();
  await d.getByLabel("Ploughing").check();
  await d.getByRole("button", { name: "Continue" }).click();
  await d.getByRole("button", { name: "Add equipment" }).click();
  await expect(p.page.getByRole("dialog")).toHaveCount(0, { timeout: 8000 });
  await p.ctx.close();

  // Two people at the finance desk, because one person may not approve their own work.
  await makeStaff(CLERK, browser);
  await makeStaff(BOSS, browser);

  // Three jobs on different dates, because one machine cannot be on two at once.
  refA = await scheduledJob(browser, "4", "Mabanta Village", "900.00", 30);
  refB = await scheduledJob(browser, "2", "Kagbo Village", "500.00", 40);
  refC = await scheduledJob(browser, "3", "Masoila Village", "600.00", 50);
});

test("a part payment does not book the job", async ({ page }) => {
  await signIn(page, CLERK, "staff");
  await passStaffCheck(page, CLERK.email);
  await page.goto("/staff/payments");
  await expect(page.getByRole("heading", { name: "Payments" })).toBeVisible();
  await expect(page.getByText("manual, not verified by a payment provider")).toBeVisible();

  const row = collectRow(page, refA);
  await expect(row.getByRole("cell", { name: "Le 900.00", exact: true })).toBeVisible();
  await row.getByText("Record a payment", { exact: true }).click();
  await row.getByLabel("Amount received").fill("400.00");
  await row.getByLabel("Receipt or transaction reference").fill(`MM-${run}-A1`);
  await row.getByRole("button", { name: "Record it" }).click();

  await expect(page.getByText("not confirmed yet").first()).toBeVisible();
  await expect(collectRow(page, refA).getByText("Le 500.00 to go")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${SHOTS}/27-staff-payments.png`, fullPage: true });
});

test("the same receipt reference cannot be recorded twice", async ({ page }) => {
  await signIn(page, CLERK, "staff");
  await passStaffCheck(page, CLERK.email);
  await page.goto("/staff/payments");
  const row = collectRow(page, refA);
  await row.getByText("Record a payment", { exact: true }).click();
  await row.getByLabel("Amount received").fill("100.00");
  await row.getByLabel("Receipt or transaction reference").fill(`MM-${run}-A1`);
  await row.getByRole("button", { name: "Record it" }).click();

  await expect(page.getByText("has already been recorded").first()).toBeVisible();
  // The money did not move: still 500 to go on a 900 job.
  await expect(collectRow(page, refA).getByText("Le 500.00 to go")).toBeVisible();
});

test("paying the balance books the job and tells both sides", async ({ page }) => {
  await signIn(page, CLERK, "staff");
  await passStaffCheck(page, CLERK.email);
  await page.goto("/staff/payments");
  const row = collectRow(page, refA);
  await row.getByText("Record a payment", { exact: true }).click();
  await row.getByLabel("Receipt or transaction reference").fill(`BK-${run}-A2`);
  await row.getByRole("button", { name: "Record it" }).click();

  await expect(page.getByText("Paid in full and booked").first()).toBeVisible();
  await expect(collectRow(page, refA).getByText("Booked", { exact: true })).toBeVisible();

  await expect
    .poll(() => mailsTo(FARMER.email).filter((m) => m.subject.includes("is booked")).length, { timeout: 8000 })
    .toBeGreaterThan(0);
  // The two emails are sent one after the other, so the provider's can lag the farmer's.
  await expect
    .poll(() => mailsTo(PROV.email).filter((m) => m.subject.includes("paid and booked")).length, { timeout: 10_000 })
    .toBeGreaterThan(0);
});

test("the farmer sees payment and booking as two separate things", async ({ page }) => {
  await signIn(page, FARMER, "farmer");
  await page.goto("/farmer/requests");
  await page.getByRole("link", { name: refA }).click();
  const card = page.locator("section.quote-card").filter({ hasText: "Payment" });
  await expect(card.getByText("Payment complete")).toBeVisible();
  await expect(card.getByText("Booking confirmed")).toBeVisible();
  await expect(card.getByText(`MM-${run}-A1`)).toBeVisible();

  await page.goto("/farmer/payments");
  await expect(page.getByRole("cell", { name: `MM-${run}-A1` })).toBeVisible();
  // Named from the farmer's side: the first part payment is the deposit, the last one the balance.
  await expect(page.getByRole("row").filter({ hasText: `MM-${run}-A1` })).toContainText("Deposit");
  await expect(page.getByRole("row").filter({ hasText: `BK-${run}-A2` })).toContainText("Balance");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${SHOTS}/28-farmer-payments.png`, fullPage: true });
});

test("money arriving after the machine is taken opens a case instead of overbooking", async ({ page }) => {
  // The machine is moved onto the other job for the same dates, behind the scenes, the way a
  // breakdown or a hand-edited plan would do it.
  const a = await testGet("SELECT id FROM service_request WHERE reference=?", refA) as { id: string };
  const b = await testGet("SELECT id FROM service_request WHERE reference=?", refB) as { id: string };
  const jobA = await testGet("SELECT id, start_date, end_date FROM job WHERE request_id=?", a.id) as {
    id: string; start_date: string; end_date: string;
  };
  const jobB = await testGet("SELECT id FROM job WHERE request_id=?", b.id) as { id: string };
  const asset = await testGet("SELECT equipment_id FROM job_asset WHERE job_id=?", jobA.id) as { equipment_id: string };
  await testRun("UPDATE job SET status='scheduled', start_date=?, end_date=? WHERE id=?", jobA.start_date, jobA.end_date, jobB.id);
  await testRun("INSERT INTO job_asset (job_id, equipment_id) VALUES (?,?) ON CONFLICT DO NOTHING", jobB.id, asset.equipment_id);

  await signIn(page, CLERK, "staff");
  await passStaffCheck(page, CLERK.email);
  await page.goto("/staff/payments");
  const row = collectRow(page, refB);
  await row.getByText("Record a payment", { exact: true }).click();
  await row.getByLabel("Receipt or transaction reference").fill(`MM-${run}-B1`);
  await row.getByRole("button", { name: "Record it" }).click();

  await expect(page.getByText("nothing was overbooked").first()).toBeVisible();
  await page.goto("/staff/payments?tab=cases");
  await expect(page.getByText(refB)).toBeVisible();
  await expect(page.getByText(/some of the equipment is now committed to/)).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${SHOTS}/29-payment-case.png`, fullPage: true });
});

test("a refund needs a second person, and the preparer cannot be it", async ({ page, browser }) => {
  await signIn(page, CLERK, "staff");
  await passStaffCheck(page, CLERK.email);
  await page.goto("/staff/payments?tab=cases");
  await page.getByText("Refund the farmer", { exact: true }).click();
  await page.getByLabel("Amount to refund").fill("500.00");
  await page.getByRole("button", { name: "Prepare the refund" }).click();
  await expect(page.getByText("A second person must approve it").first()).toBeVisible();

  // The clerk who prepared it may not approve it.
  const release = page.locator("section.staff__item").filter({ hasText: "Refund" });
  await expect(release.getByText("Waiting for a second approver")).toBeVisible();
  await release.getByRole("button", { name: "Approve it" }).click();
  await expect(page.getByText(/cannot approve it/)).toBeVisible();

  // The other person can.
  const b = await fresh(browser);
  await signIn(b.page, BOSS, "staff");
  await passStaffCheck(b.page, BOSS.email);
  await b.page.goto("/staff/payments?tab=releases");
  await b.page.locator("section.staff__item").filter({ hasText: "Refund" }).getByRole("button", { name: "Approve it" }).click();
  await expect(b.page.getByText("Approved").first()).toBeVisible();

  // Changing the amount withdraws that approval.
  const approved = b.page.locator("section.staff__item").filter({ hasText: "Refund" });
  await approved.getByText("Change the amount", { exact: true }).click();
  await approved.getByLabel("New amount").fill("400.00");
  await approved.getByRole("button", { name: "Change it" }).click();
  await expect(b.page.getByText("needs approving again").first()).toBeVisible();
  await expect(
    b.page.locator("section.staff__item").filter({ hasText: "Refund" }).getByText("Waiting for a second approver"),
  ).toBeVisible();
  await b.ctx.close();
});

test("a payout waits for the farmer's confirmation, not the provider's word", async ({ page, browser }) => {
  // The provider reports the work on the booked job.
  const p = await fresh(browser);
  await signIn(p.page, PROV, "provider");
  await p.page.goto("/provider/jobs");
  await p.page.getByRole("button", { name: `Open job ${refA}` }).click();
  const card = p.page.getByRole("dialog", { name: `Job ${refA}` });
  await card.getByRole("button", { name: "Report work done" }).click();
  const d = p.page.getByRole("dialog");
  await d.getByLabel("How much was done (acres)").fill("4");
  await d.getByRole("button", { name: "Report the work" }).click();
  await expect(p.page.getByRole("dialog")).toHaveCount(0, { timeout: 8000 });

  // Reported is not confirmed, so there is nothing to pay out.
  await signIn(page, CLERK, "staff");
  await passStaffCheck(page, CLERK.email);
  await page.goto("/staff/payments?tab=releases");
  await expect(page.getByRole("heading", { name: "Ready to pay out" })).toHaveCount(0);

  // The farmer confirms.
  const f = await fresh(browser);
  await signIn(f.page, FARMER, "farmer");
  await f.page.goto("/farmer/requests");
  await f.page.getByRole("link", { name: refA }).click();
  await f.page.getByRole("button", { name: "Confirm the work was done" }).click();
  await expect(f.page.getByRole("status").filter({ hasText: "confirmed the work" })).toBeVisible();
  await f.ctx.close();

  await page.goto("/staff/payments?tab=releases");
  await expect(page.getByRole("heading", { name: "Ready to pay out" })).toBeVisible();
  await page.getByRole("button", { name: "Prepare the payout" }).click();
  await expect(page.getByText("A second person must approve it").first()).toBeVisible();

  const b = await fresh(browser);
  await signIn(b.page, BOSS, "staff");
  await passStaffCheck(b.page, BOSS.email);
  await b.page.goto("/staff/payments?tab=releases");
  const payout = b.page.locator("section.staff__item").filter({ hasText: "Payout" });
  await payout.getByRole("button", { name: "Approve it" }).click();
  await expect(b.page.getByText("Approved").first()).toBeVisible();

  const ready = b.page.locator("section.staff__item").filter({ hasText: "Payout" });
  await ready.getByText("Record it as sent", { exact: true }).click();
  await ready.getByLabel("Transfer reference").fill(`OUT-${run}-1`);
  await ready.getByRole("button", { name: "It has been sent" }).click();
  await expect(b.page.getByText("Recorded as sent").first()).toBeVisible();
  await b.ctx.close();

  // The provider sees it on their own payments screen.
  await p.page.goto("/provider/payments");
  await expect(p.page.getByRole("row").filter({ hasText: refA }).getByText(`OUT-${run}-1`)).toBeVisible();
  await p.page.waitForLoadState("networkidle");
  await p.page.screenshot({ path: `${SHOTS}/30-provider-payments.png`, fullPage: true });
  await p.ctx.close();
});

test("changing where money goes withdraws an approval that has not been sent", async ({ page, browser }) => {
  // A third job, paid and booked, then confirmed, so there is a payout to interfere with.
  await signIn(page, CLERK, "staff");
  await passStaffCheck(page, CLERK.email);
  await page.goto("/staff/payments");
  const row = collectRow(page, refC);
  await row.getByText("Record a payment", { exact: true }).click();
  await row.getByLabel("Receipt or transaction reference").fill(`MM-${run}-C1`);
  await row.getByRole("button", { name: "Record it" }).click();
  await expect(page.getByText("Paid in full and booked").first()).toBeVisible();
  const c = await testGet("SELECT id FROM service_request WHERE reference=?", refC) as { id: string };
  await testRun("UPDATE job SET status='completed', reported_acres=3, confirmed_at=? WHERE request_id=?", new Date().toISOString(), c.id);

  await page.goto("/staff/payments?tab=releases");
  const ready = page.locator("section.staff__item").filter({ hasText: "Ready to pay out" });
  await ready.getByRole("button", { name: "Prepare the payout" }).click();
  await expect(page.getByText("A second person must approve it").first()).toBeVisible();

  const boss = await fresh(browser);
  await signIn(boss.page, BOSS, "staff");
  await passStaffCheck(boss.page, BOSS.email);
  await boss.page.goto("/staff/payments?tab=releases");
  const payout = boss.page.locator("section.staff__item").filter({ hasText: `Payout · ${refC}` });
  await payout.getByRole("button", { name: "Approve it" }).click();
  await expect(boss.page.getByText("Approved").first()).toBeVisible();

  // The provider now changes their payout number.
  const p = await fresh(browser);
  await signIn(p.page, PROV, "provider");
  await p.page.goto("/provider/payments?payout=change");
  await p.page.getByText("Monime", { exact: true }).click();
  await p.page.getByRole("button", { name: "Continue" }).click();
  await p.page.getByLabel("Monime phone number").fill("76 111 222");
  await p.page.getByLabel("Account name").fill("Sesay Tractors Ltd");
  await p.page.getByRole("button", { name: "Save payout account" }).click();
  await expect(p.page.getByText("gone back for approval").first()).toBeVisible();
  // Payout details now shows that account, the way the design names it.
  await p.page.goto("/provider/payments?payout=1");
  const details = p.page.getByRole("dialog", { name: "Payout details" });
  await expect(details.getByText("Monime", { exact: true })).toBeVisible();
  await expect(details.getByText("+232 76 111 222")).toBeVisible();
  await expect(details.getByRole("link", { name: "Change payout account" })).toHaveAttribute("href", "/provider/payments?payout=change");
  await p.ctx.close();

  await boss.page.goto("/staff/payments?tab=releases");
  await expect(
    boss.page.locator("section.staff__item").filter({ hasText: `Payout · ${refC}` }).getByText("Waiting for a second approver"),
  ).toBeVisible();
  await boss.ctx.close();
});

/* ------------------------------------------------------------- Monime */

const monime = startMonimeStub();

async function openRequest(page: Page, reference: string) {
  await page.goto("/farmer/requests");
  await page.getByRole("link", { name: reference }).click();
  await expect(page.getByRole("heading", { name: "Payment" })).toBeVisible();
}

test.describe("paying online through Monime", () => {
  // Each test walks a new job to scheduled before paying, which is slow on a busy machine.
  test.describe.configure({ timeout: 240_000 });
  test.beforeAll(async () => { await monime.start(); });
  test.afterAll(async () => { await monime.stop(); });

  test("a farmer pays online, Sagora checks it with Monime, and the job is booked", async ({ page, browser }) => {
    const ref = await scheduledJob(browser, "2", "Online Village", "750.00", 60);
    await signIn(page, FARMER, "farmer");
    await openRequest(page, ref);

    // Changing their mind on Monime's page brings them back with nothing paid.
    await page.getByRole("button", { name: "Pay Le 750.00 now" }).click();
    await expect(page).toHaveURL(new RegExp(`localhost:${STUB_PORT}/pay/`));
    await page.getByRole("link", { name: "Cancel" }).click();
    await expect(page.getByText("The payment was not completed. You can try again.")).toBeVisible();

    await page.getByRole("button", { name: "Pay Le 750.00 now" }).click();
    await expect(page.getByRole("heading", { name: "Pay SLE 750" })).toBeVisible();
    await page.getByRole("link", { name: "Pay with mobile money" }).click();
    await expect(page.getByText("Thank you. Your payment was received.")).toBeVisible();
    await expect(page.getByText("Booking confirmed", { exact: true })).toBeVisible();
    await expect(page.getByText("Le 750.00 by Monime (test)")).toBeVisible();
    await expect(page.getByRole("button", { name: /Pay .* now/ })).toHaveCount(0);
    await page.screenshot({ path: `${SHOTS}/34-paid-online.png`, fullPage: true });

    // What Monime was asked: the amount owed, in cents, with the space and a retry key.
    const created = monime.seen.filter((x) => x.method === "POST" && x.path === "/v1/checkout-sessions");
    expect(created).toHaveLength(2);
    expect((created[1].body as { lineItems: { price: { value: number } }[] }).lineItems[0].price.value).toBe(75000);
    expect(created[1].headers["monime-space-id"]).toBe("spc-test");
    expect(created[1].headers["idempotency-key"]).toBeTruthy();

    const row = await testGet(`SELECT p.source, p.psp_verified, p.method FROM payment p JOIN service_request r ON r.id = p.request_id WHERE r.reference=?`, ref) as
      { source: string; psp_verified: number; method: string };
    expect(row).toMatchObject({ source: "monime", method: "monime_test" });
    expect(Number(row.psp_verified)).toBe(1);
    expect(mailsTo(FARMER.email).some((m) => m.subject === `${ref} is booked` && m.text.includes("through Monime"))).toBe(true);
  });

  test("Monime's notice records a payment the farmer never came back from, once, and only with the secret", async ({ page, browser, request }) => {
    const ref = await scheduledJob(browser, "2", "Notice Village", "420.00", 70);
    await signIn(page, FARMER, "farmer");
    await openRequest(page, ref);
    await page.getByRole("button", { name: "Pay Le 420.00 now" }).click();
    await expect(page).toHaveURL(new RegExp(`localhost:${STUB_PORT}/pay/`));
    const sessionId = new URL(page.url()).pathname.split("/").pop()!;
    const notice = { event: { id: "evt-1", name: "checkout_session.completed" }, object: { id: sessionId, type: "checkout_session" }, data: {} };
    const paidCount = async () => Number((await testGet(
      `SELECT COUNT(*) AS n FROM payment p JOIN service_request r ON r.id = p.request_id WHERE r.reference=?`, ref) as { n: number | string }).n);

    // Without the secret: refused.
    expect((await request.post("/api/monime/webhook", { data: notice })).status()).toBe(401);
    // With it, but Monime says the checkout is still open: a notice alone moves no money.
    const early = await request.post("/api/monime/webhook", { data: notice, headers: { "x-sagora-webhook-secret": "test-webhook-secret" } });
    expect(await early.json()).toEqual({ result: "pending" });
    expect(await paidCount()).toBe(0);

    // Paid on Monime's side, and the farmer closed the browser.
    await fetch(`http://localhost:${STUB_PORT}/pay/${sessionId}/mark-paid`);
    for (let i = 0; i < 2; i++) {
      const res = await request.post("/api/monime/webhook", { data: notice, headers: { "x-sagora-webhook-secret": "test-webhook-secret" } });
      expect(await res.json()).toEqual({ result: "paid" });
    }
    expect(await paidCount()).toBe(1);
    await openRequest(page, ref);
    await expect(page.getByText("Booking confirmed", { exact: true })).toBeVisible();
  });
});

test("the books balance after all of that", async ({ page }) => {
  await signIn(page, CLERK, "staff");
  await passStaffCheck(page, CLERK.email);
  await page.goto("/staff/payments?tab=books");
  await expect(page.getByRole("status").filter({ hasText: "The ledger balances" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Accounts in the negative" })).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${SHOTS}/31-reconciliation.png`, fullPage: true });
});

test("a farmer cannot reach the finance desk", async ({ page }) => {
  await signIn(page, FARMER, "farmer");
  await page.goto("/staff/payments");
  await expect(page).toHaveURL(/\/provider\/sign-in$/);
});
