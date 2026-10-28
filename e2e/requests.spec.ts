import { expect, test, type Browser, type Page } from "@playwright/test";
import { openTestDb } from "./testdb";
import fs from "node:fs";
import path from "node:path";

const OUTBOX = path.join(process.cwd(), "data", "dev-outbox.jsonl");
const DB = path.join(process.cwd(), "data", "test.db");
const SHOTS = path.join(process.cwd(), "e2e", "screens");
fs.mkdirSync(SHOTS, { recursive: true });

const run = Date.now();
const FARMER = { name: "Mariama Bangura", phone: "076 707 808", email: `mariama.${run}@example.com`, password: "rice-season-26" };
const PROVIDER = { business: "Bombali Tractors", phone: "077 303 404", email: `bombali.${run}@example.com`, password: "ploughing-26" };

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
    } catch {
      await page.waitForTimeout(400);
    }
  }
  throw new Error(`verification never completed for ${email}`);
}
async function fresh(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1728, height: 1117 } });
  return { ctx, page: await ctx.newPage() };
}
const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

async function book(page: Page, opts: { service: string; acres: string; district: string; village: string; days: number; notes?: string }) {
  await page.goto("/farmer/book");
  await page.getByLabel("What work do you need?").selectOption(opts.service);
  await page.getByLabel("Farm size (acres)").fill(opts.acres);
  await page.getByLabel("Preferred date").fill(inDays(opts.days));
  await page.getByLabel("District").selectOption(opts.district);
  await page.getByLabel("Community or village").fill(opts.village);
  if (opts.notes) await page.getByLabel("Anything the provider should know").fill(opts.notes);
  await page.getByRole("button", { name: "Send request" }).click();
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  // One farmer and one approved provider for the whole file.
  const f = await fresh(browser);
  await f.page.goto("/farmer/sign-up");
  await f.page.getByLabel("First and last name").fill(FARMER.name);
  await f.page.getByLabel("Your phone number").fill(FARMER.phone);
  await f.page.getByLabel("Email").fill(FARMER.email);
  await f.page.getByLabel("Password", { exact: true }).fill(FARMER.password);
  await f.page.getByRole("button", { name: "Create account" }).click();
  await enterCode(f.page, FARMER.email);
  await f.ctx.close();

  const p = await fresh(browser);
  await p.page.goto("/provider/sign-up");
  await p.page.getByLabel("Business name").fill(PROVIDER.business);
  await p.page.getByLabel("Your phone number").fill(PROVIDER.phone);
  await p.page.getByLabel("Email").fill(PROVIDER.email);
  await p.page.getByLabel("Password", { exact: true }).fill(PROVIDER.password);
  await p.page.getByRole("button", { name: "Create account" }).click();
  await enterCode(p.page, PROVIDER.email);
  await p.page.getByLabel("District").selectOption("Bombali");
  await p.page.getByLabel("Ploughing").check();
  await p.page.getByLabel("Town or village").fill("Makeni");
  await p.page.getByRole("button", { name: "Submit for review" }).click();
  const db = openTestDb();
  const u = db.prepare("SELECT id FROM user WHERE email=?").get(PROVIDER.email) as { id: string };
  const now = new Date().toISOString();
  db.prepare("UPDATE provider_business SET status='approved', reviewed_at=?, updated_at=? WHERE user_id=?").run(now, now, u.id);
  db.close();
  await p.ctx.close();
});

async function signInFarmer(page: Page) {
  await page.goto("/farmer/sign-in");
  await page.getByLabel("Email").fill(FARMER.email);
  await page.getByLabel("Password", { exact: true }).fill(FARMER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/sign-in/);
}
async function signInProvider(page: Page) {
  await page.goto("/provider/sign-in");
  await page.getByLabel("Email").fill(PROVIDER.email);
  await page.getByLabel("Password", { exact: true }).fill(PROVIDER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/sign-in/);
}

test("the booking form refuses incomplete and impossible requests", async ({ page }) => {
  await signInFarmer(page);
  await page.goto("/farmer/book");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${SHOTS}/15-farmer-book.png`, fullPage: true });

  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByText("Choose the work you need")).toBeVisible();
  await expect(page.getByText("Choose your district")).toBeVisible();

  // A date in the past is refused.
  await page.getByLabel("What work do you need?").selectOption("ploughing");
  await page.getByLabel("Farm size (acres)").fill("5");
  await page.getByLabel("Preferred date").fill(inDays(-5));
  await page.getByLabel("District").selectOption("Bombali");
  await page.getByLabel("Community or village").fill("Mabanta Village");
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByText("Choose a date in the future")).toBeVisible();

  // An alternate date before the preferred date is refused.
  await page.getByLabel("Preferred date").fill(inDays(20));
  await page.getByLabel("Alternate date").fill(inDays(10));
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByText("must be on or after the preferred date")).toBeVisible();
});

test("a farmer books work, gets a reference, and it is emailed", async ({ page }) => {
  await signInFarmer(page);
  await book(page, { service: "ploughing", acres: "5", district: "Bombali", village: "Mabanta Village", days: 21, notes: "First season. Need deep ploughing." });

  await expect(page).toHaveURL(/\/farmer\/requests\?new=SG-\d+$/);
  const banner = page.getByText(/Request SG-\d+ sent/);
  await expect(banner).toBeVisible();
  const reference = (await banner.innerText()).match(/SG-\d+/)![0];
  await expect(page.getByRole("cell", { name: reference, exact: true })).toBeVisible();
  await expect(page.getByText("Awaiting quotes")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${SHOTS}/16-farmer-requests.png`, fullPage: true });

  // The reference reaches the farmer by email, with the "not a booking" rule stated.
  const mail = mailsTo(FARMER.email).find((m) => m.text.includes(reference))!;
  expect(mail).toBeTruthy();
  expect(mail.text).toContain("A request is not a booking");
});

test("the provider sees the request, filters it, and opens the details", async ({ page }) => {
  await signInProvider(page);
  await page.goto("/provider/requests");
  await expect(page.getByRole("heading", { name: "Requests" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Mabanta Village", exact: false })).toHaveCount(0); // village is not in the list
  const row = page.getByRole("row").filter({ hasText: "Bombali" }).first();
  await expect(row).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${SHOTS}/17-provider-requests.png` });

  // Filtering by the other service empties the list.
  await page.goto("/provider/requests?service=harvesting");
  await expect(page.getByText("No requests match these filters yet.")).toBeVisible();

  // Filtering by a different district empties it too.
  await page.goto("/provider/requests?district=Kono");
  await expect(page.getByText("No requests match these filters yet.")).toBeVisible();

  // Open the detail modal: it carries the full request, including the village and notes.
  await page.goto("/provider/requests?district=Bombali");
  await page.getByRole("button", { name: /Open request SG-/ }).first().click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Mabanta Village")).toBeVisible();
  await expect(dialog.getByText("First season. Need deep ploughing.")).toBeVisible();
  await expect(dialog.getByText("5 acres")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/18-request-detail.png` });

  // Quoting is the next stage, so it is visibly unavailable rather than broken.
  await expect(dialog.getByRole("button", { name: "Send a quote" })).toBeDisabled();
  await dialog.getByRole("button", { name: "Close" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("the farmer's contact details are never sent to the browse list", async ({ page }) => {
  await signInProvider(page);
  await page.goto("/provider/requests");
  const html = await page.content();
  expect(html).not.toContain(FARMER.email);
  expect(html).not.toContain("76 707 808");
  expect(html).not.toContain(FARMER.name);
});

test("a farmer can withdraw a request, and it leaves the provider list", async ({ page, browser }) => {
  await signInFarmer(page);
  await book(page, { service: "harvesting", acres: "3", district: "Kono", village: "Yengema", days: 30 });
  const reference = (await page.getByText(/Request SG-\d+ sent/).innerText()).match(/SG-\d+/)![0];

  const p = await fresh(browser);
  await signInProvider(p.page);
  await p.page.goto("/provider/requests?district=Kono");
  await expect(p.page.getByRole("cell", { name: reference, exact: true })).toBeVisible();

  await page.goto("/farmer/requests");
  await page.getByRole("row").filter({ hasText: reference }).getByRole("button", { name: "Withdraw" }).click();
  await expect(page.getByRole("row").filter({ hasText: reference }).getByText("Cancelled")).toBeVisible();

  await p.page.reload();
  await expect(p.page.getByRole("cell", { name: reference, exact: true })).toHaveCount(0);
  await p.ctx.close();
});

test("a farmer cannot withdraw someone else's request, and the book page is closed to providers", async ({ page, browser }) => {
  const { ctx, page: p } = await fresh(browser);
  await signInProvider(p);
  await p.goto("/farmer/book");
  await expect(p).toHaveURL(/\/provider\/setup$|\/provider\/dashboard$/);
  await p.goto("/farmer/requests");
  await expect(p).toHaveURL(/\/provider\/setup$|\/provider\/dashboard$/);
  await ctx.close();

  // A second farmer sees none of the first farmer's requests.
  const other = await fresh(browser);
  const email = `other.${run}@example.com`;
  await other.page.goto("/farmer/sign-up");
  await other.page.getByLabel("First and last name").fill("Ibrahim Koroma");
  await other.page.getByLabel("Your phone number").fill("076 111 222");
  await other.page.getByLabel("Email").fill(email);
  await other.page.getByLabel("Password", { exact: true }).fill("second-farmer-1");
  await other.page.getByRole("button", { name: "Create account" }).click();
  await enterCode(other.page, email);
  await other.page.goto("/farmer/requests");
  await expect(other.page.getByText("You have not asked for any work yet.")).toBeVisible();
  await other.ctx.close();
  await page.goto("/farmer/sign-in"); // keep the fixture page on a known screen
});
