import { expect, test, type Browser, type Page } from "@playwright/test";
import { completeApplication, confirmChecks } from "./checks";
import { testGet, testRun } from "./testdb";
import fs from "node:fs";
import path from "node:path";

/**
 * UC04 and UC03: a provider works in several districts, with services per district. A new district
 * waits for Sagora's review before any request from it arrives; removing one is immediate.
 */

const OUTBOX = path.join(process.cwd(), "data", "dev-outbox.jsonl");
const run = Date.now();
const PROVIDER = { business: `Two District Farm ${String(run).slice(-5)}`, phone: "077 818 919", email: `twodist.${run}@example.com`, password: "two-districts-26" };
const STAFF = { business: "Coverage Desk", phone: "078 818 919", email: `cov.staff.${run}@example.com`, password: "coverage-desk-26" };

type Mail = { to: string; subject: string; text: string };
const mailsTo = (email: string): Mail[] =>
  fs.existsSync(OUTBOX)
    ? fs.readFileSync(OUTBOX, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Mail).filter((m) => m.to === email)
    : [];
async function latestCode(email: string, after = 0): Promise<string> {
  for (let i = 0; i < 80; i++) {
    const m = mailsTo(email).slice(after).filter((x) => /code is \d{7}/.test(x.text));
    if (m.length) return m[m.length - 1].text.match(/code is (\d{7})/)![1];
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no code for ${email}`);
}
async function enterCode(page: Page, email: string, done: (u: URL) => boolean = (u) => !u.pathname.includes("verify-email"), after = 0) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.getByLabel("Digit 1 of 7").click();
    await page.keyboard.press("Control+A");
    await page.keyboard.type(await latestCode(email, after));
    try {
      await page.waitForURL(done, { timeout: 5000 });
      return;
    } catch { await page.waitForTimeout(400); }
  }
  throw new Error(`verification never completed for ${email}`);
}
async function fresh(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  return { ctx, page: await confirmChecks(await ctx.newPage()) };
}
async function signUp(page: Page, who: typeof PROVIDER) {
  await page.goto("/provider/sign-up");
  await page.getByLabel("Business name").fill(who.business);
  await page.getByLabel("Your phone number").fill(who.phone);
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password", { exact: true }).fill(who.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await enterCode(page, who.email);
}
async function signInProvider(page: Page) {
  await page.goto("/provider/sign-in");
  await page.getByLabel("Email").fill(PROVIDER.email);
  await page.getByLabel("Password", { exact: true }).fill(PROVIDER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/sign-in/);
}
async function signInStaff(page: Page) {
  const before = mailsTo(STAFF.email).length;
  await page.goto("/staff/sign-in");
  await page.getByLabel("Email").fill(STAFF.email);
  await page.getByLabel("Password", { exact: true }).fill(STAFF.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/staff\/verify/);
  await enterCode(page, STAFF.email, (u) => !u.pathname.includes("/staff/verify"), before);
}
const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

/** A harvest request in Kenema, sent without an account. Returns its reference. */
async function kenemaHarvest(page: Page): Promise<string> {
  await page.goto("/request");
  await page.getByLabel("What work do you need?").selectOption("harvesting");
  await page.getByLabel("Land size").fill("2");
  await page.getByLabel("Crop", { exact: true }).fill("Rice");
  await page.getByLabel("Easy access").check();
  await page.getByLabel("Cleared").check();
  await page.getByRole("group", { name: "Is the crop ready to harvest?" }).getByLabel("Not sure").check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("District").selectOption("Kenema");
  await page.getByLabel("Chiefdom").selectOption({ index: 1 });
  await page.getByLabel("Village/town").fill("Blama");
  await page.getByLabel("Preferred start date").fill(inDays(15));
  await page.getByLabel("Your name").fill("Mariama Kallon");
  await page.getByLabel("Your phone number").fill(`076 ${String(run).slice(-6, -3)} ${String(run).slice(-3)}`);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Send request" }).click();
  await page.waitForURL(/\/request\/track/);
  const row = await testGet("SELECT reference FROM service_request WHERE contact_name=? ORDER BY created_at DESC", "Mariama Kallon") as { reference: string };
  return row.reference;
}

async function seesRequest(page: Page, reference: string): Promise<boolean> {
  await page.goto(`/provider/requests?open=${reference}`);
  await page.waitForLoadState("networkidle");
  return (await page.getByRole("dialog").count()) > 0 || (await page.getByRole("button", { name: `Open request ${reference}` }).count()) > 0;
}

test.beforeEach(async ({ page }) => { await confirmChecks(page); });
test.describe.configure({ mode: "serial", timeout: 150_000 });

test.beforeAll(async ({ browser }) => {
  const p = await fresh(browser);
  await signUp(p.page, PROVIDER);
  await p.page.getByLabel("District").selectOption("Bo");
  await p.page.getByLabel("Ploughing").check();
  await p.page.getByLabel("Town or village").fill("Bo town");
  await completeApplication(p.page);
  await p.page.getByRole("button", { name: "Submit for review" }).click();
  await expect.poll(async () => ((await testGet(`SELECT b.status FROM provider_business b JOIN "user" u ON u.id = b.user_id WHERE u.email=?`, PROVIDER.email)) as { status: string } | undefined)?.status,
    { timeout: 15_000 }).toBe("submitted");
  await p.ctx.close();

  const s = await fresh(browser);
  await signUp(s.page, STAFF);
  await s.ctx.close();
  await testRun(`UPDATE "user" SET role='admin' WHERE email=?`, STAFF.email);
});

test("a new district waits for review, then brings requests, and can be dropped again", async ({ page, browser }) => {
  // Approved on the review screen, so the setup district becomes where they work.
  await signInStaff(page);
  await page.goto("/staff/providers");
  const card = page.locator(".staff__item").filter({ hasText: PROVIDER.business });
  await card.getByRole("button", { name: "Approve" }).click();
  await expect.poll(async () => ((await testGet(`SELECT b.status FROM provider_business b JOIN "user" u ON u.id = b.user_id WHERE u.email=?`, PROVIDER.email)) as { status: string }).status,
    { timeout: 15_000 }).toBe("approved");
  // The status changes a moment before its coverage is written, so wait for that too.
  await expect.poll(async () => Number(((await testGet(`SELECT COUNT(*) AS n FROM provider_coverage c JOIN provider_business b ON b.id = c.business_id
       WHERE b.email=? AND c.status='active'`, PROVIDER.email)) as { n: number | string }).n), { timeout: 15_000 }).toBe(1);

  const g = await fresh(browser);
  const reference = await kenemaHarvest(g.page);
  await g.ctx.close();

  const p = await fresh(browser);
  await signInProvider(p.page);
  expect(await seesRequest(p.page, reference)).toBe(false);

  await p.page.goto("/provider/settings/business");
  const areas = p.page.locator("#areas");
  await expect(areas.getByText("Bo District")).toBeVisible();
  await areas.getByLabel("Add a district").selectOption("Kenema");
  await areas.getByLabel("Harvesting").check();
  await areas.getByRole("button", { name: "Send for review" }).click();
  await expect(p.page.getByText("Sent to Sagora for review.", { exact: false })).toBeVisible();
  await expect(areas.getByText("Kenema District")).toBeVisible();
  await expect(areas.getByText("Waiting for review")).toBeVisible();
  // Not yet: nothing from Kenema until Sagora says so.
  expect(await seesRequest(p.page, reference)).toBe(false);

  await page.goto("/staff/providers");
  const change = page.locator(".coverage-change").filter({ hasText: PROVIDER.business });
  await expect(change).toContainText("Kenema District: Harvesting");
  await change.getByRole("button", { name: "Approve" }).click();
  await expect(page.getByText(`Approved for ${PROVIDER.business}.`)).toBeVisible();
  expect(mailsTo(PROVIDER.email).some((m) => m.subject === "New districts approved on Sagora")).toBe(true);

  expect(await seesRequest(p.page, reference)).toBe(true);

  await p.page.goto("/provider/settings/business");
  await p.page.getByRole("button", { name: "Stop Harvesting in Kenema" }).click();
  await p.page.getByRole("dialog", { name: "Confirm" }).getByRole("button", { name: "Stop" }).click();
  await expect(p.page.getByText("Removed.")).toBeVisible();
  expect(await seesRequest(p.page, reference)).toBe(false);

  // The last district and service stays: without it nothing could reach them.
  await p.page.goto("/provider/settings/business");
  await p.page.getByRole("button", { name: "Stop Ploughing in Bo" }).click();
  await p.page.getByRole("dialog", { name: "Confirm" }).getByRole("button", { name: "Stop" }).click();
  await expect(p.page.getByText("Keep at least one district and service, or no requests can reach you.")).toBeVisible();
  await p.ctx.close();
});
