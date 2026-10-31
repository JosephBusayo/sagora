import { expect, test, type Browser, type Page } from "@playwright/test";
import { testRun } from "./testdb";
import fs from "node:fs";
import path from "node:path";

const OUTBOX = path.join(process.cwd(), "data", "dev-outbox.jsonl");
const SHOTS = path.join(process.cwd(), "e2e", "screens");
fs.mkdirSync(SHOTS, { recursive: true });

const run = Date.now();
const STAFF = { business: "MFA Coordinator", phone: "076 808 909", email: `mfa.staff.${run}@example.com`, pass: "mfa-staff-26" };

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
async function typeCode(page: Page, code: string) {
  await page.getByLabel("Digit 1 of 7").click();
  await page.keyboard.press("Control+A");
  await page.keyboard.type(code);
}
async function enterCode(page: Page, email: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await typeCode(page, await latestCode(email));
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
async function signIn(page: Page) {
  await page.goto("/staff/sign-in");
  await page.getByLabel("Email").fill(STAFF.email);
  await page.getByLabel("Password", { exact: true }).fill(STAFF.pass);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/sign-in/);
}

const wrong = (right: string) => (right[0] === "0" ? "1" : "0") + right.slice(1);

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  const s = await fresh(browser);
  await s.page.goto("/provider/sign-up");
  await s.page.getByLabel("Business name").fill(STAFF.business);
  await s.page.getByLabel("Your phone number").fill(STAFF.phone);
  await s.page.getByLabel("Email").fill(STAFF.email);
  await s.page.getByLabel("Password", { exact: true }).fill(STAFF.pass);
  await s.page.getByRole("button", { name: "Create account" }).click();
  await enterCode(s.page, STAFF.email);
  await s.ctx.close();
  await testRun(`UPDATE "user" SET role='staff' WHERE email=?`, STAFF.email);
});

test("a password alone does not open the staff screens", async ({ page }) => {
  await signIn(page);
  await page.goto("/staff/payments");
  await expect(page).toHaveURL(/\/staff\/verify$/);
  await expect(page.getByRole("heading", { name: "Staff verification" })).toBeVisible();

  // The email it was sent to is only hinted at, never spelled out.
  await expect(page.getByText(STAFF.email, { exact: true })).toHaveCount(0);
  await expect(page.getByText(/These screens move money/)).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${SHOTS}/32-staff-verify.png`, fullPage: true });
});

test("every staff screen is behind it, not just the one asked for", async ({ page }) => {
  await signIn(page);
  for (const url of ["/staff/providers", "/staff/outbox", "/staff/payments?tab=books"]) {
    await page.goto(url);
    await expect(page).toHaveURL(/\/staff\/verify$/);
  }
});

test("a wrong code is refused and the right one still works", async ({ page }) => {
  await signIn(page);
  await page.goto("/staff/payments");
  const code = await latestCode(STAFF.email);

  await typeCode(page, wrong(code));
  await expect(page.getByText("That code is not right.")).toBeVisible();
  await expect(page).toHaveURL(/\/staff\/verify$/);

  await typeCode(page, code);
  await expect(page).toHaveURL(/\/staff\/providers$/);
  await expect(page.getByRole("heading", { name: "Providers waiting for review" })).toBeVisible();
});

test("a used code cannot be replayed, and one browser's check does not cover another", async ({ page, browser }) => {
  // Browser A signs in and verifies properly.
  await signIn(page);
  await page.goto("/staff/payments");
  const used = await latestCode(STAFF.email);
  await typeCode(page, used);
  await expect(page).toHaveURL(/\/staff\/providers$/);

  // Browser B has the same password and has seen that code. Neither gets it in.
  const b = await fresh(browser);
  await signIn(b.page);
  await b.page.goto("/staff/payments");
  await expect(b.page).toHaveURL(/\/staff\/verify$/);
  await typeCode(b.page, used);
  await expect(b.page.getByText("That code is not right.")).toBeVisible();
  await b.ctx.close();

  // Browser A is untouched by any of that.
  await page.goto("/staff/payments?tab=books");
  await expect(page).toHaveURL(/tab=books$/);
});

test("five wrong codes burn the code, not the account", async ({ page, browser }) => {
  const b = await fresh(browser);
  await signIn(b.page);
  await b.page.goto("/staff/payments");
  const code = await latestCode(STAFF.email);

  for (let i = 0; i < 4; i++) await typeCode(b.page, wrong(code));
  await expect(b.page.getByText("That code is not right.")).toBeVisible();
  await typeCode(b.page, wrong(code));
  await expect(b.page.getByText("Too many wrong codes. Ask for a new one.")).toBeVisible();

  // Even the right code is dead now.
  await typeCode(b.page, code);
  await expect(b.page.getByText("Too many wrong codes. Ask for a new one.")).toBeVisible();

  // A new code is a fresh start, which is the point: the account is not locked out.
  test.setTimeout(90_000);
  await expect(b.page.getByRole("button", { name: /Resend in 00:/ })).toBeDisabled();
  await expect(b.page.getByRole("button", { name: "Resend code" })).toBeEnabled({ timeout: 35_000 });
  await b.page.getByRole("button", { name: "Resend code" }).click();
  await expect(b.page.getByRole("status")).toContainText("We sent a new code");
  await b.page.waitForTimeout(100);
  await typeCode(b.page, await latestCode(STAFF.email));
  await expect(b.page).toHaveURL(/\/staff\/providers$/);
  await b.ctx.close();
  expect(page.url()).toBeTruthy();
});

test("signing out ends it: coming back needs a new code", async ({ page }) => {
  await signIn(page);
  await page.goto("/staff/payments");
  await typeCode(page, await latestCode(STAFF.email));
  await expect(page).toHaveURL(/\/staff\/providers$/);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/provider\/sign-in$/);
  await page.goto("/staff/payments");
  await expect(page).toHaveURL(/\/provider\/sign-in$/);

  // The password alone does not pick up where that session left off.
  await signIn(page);
  await page.goto("/staff/payments");
  await expect(page).toHaveURL(/\/staff\/verify$/);
});

test("the code is useless without the password", async ({ page, browser }) => {
  // Someone reads the code over a shoulder but is not signed in: the screen is not even there.
  const b = await fresh(browser);
  await b.page.goto("/staff/verify");
  await expect(b.page).toHaveURL(/\/provider\/sign-in$/);
  await b.ctx.close();
  expect(page.url()).toBeTruthy();
});

test("staff have their own door, and an admin adds and removes staff", async ({ page, browser }) => {
  // The public screens treat a staff account as if it did not exist.
  const outsider = await fresh(browser);
  await outsider.page.goto("/provider/sign-in");
  await outsider.page.getByLabel("Email").fill(STAFF.email);
  await outsider.page.getByLabel("Password", { exact: true }).fill(STAFF.pass);
  await outsider.page.getByRole("button", { name: "Sign in" }).click();
  await expect(outsider.page.getByText("Incorrect email or password.")).toBeVisible();
  await outsider.ctx.close();

  // Plain staff cannot reach the team screen. An admin can.
  await signIn(page);
  await typeCode(page, await latestCode(STAFF.email));
  await page.waitForURL(/\/staff\/providers/);
  await page.goto("/staff/team");
  await expect(page).toHaveURL(/\/staff\/providers$/);
  await testRun(`UPDATE "user" SET role='admin' WHERE email=?`, STAFF.email);
  await page.goto("/staff/team");

  const hire = `mfa.hire.${run}@example.com`;
  await page.getByLabel("Name").fill("New Hire");
  await page.getByLabel("Email").fill(hire);
  await page.getByRole("button", { name: "Invite" }).click();
  const notice = await page.getByText(/Invitation ready/).innerText();
  const link = notice.match(/\/staff\/join\/[\w-]+/)![0];

  const joiner = await fresh(browser);
  await joiner.page.goto(link);
  await joiner.page.getByLabel("Password", { exact: true }).fill("a-long-hire-password");
  await joiner.page.getByLabel("Confirm Password").fill("a-long-hire-password");
  await joiner.page.getByRole("button", { name: "Finish setup" }).click();
  await joiner.page.waitForURL(/\/staff\/sign-in$/);
  await joiner.ctx.close();

  // Used once, and gone.
  const again = await fresh(browser);
  await again.page.goto(link);
  await expect(again.page.getByText("This invitation can't be used")).toBeVisible();
  await again.ctx.close();

  await page.goto("/staff/team");
  const row = page.getByRole("listitem").filter({ hasText: hire });
  await expect(row).toBeVisible();
  page.once("dialog", (d) => d.accept());
  await row.getByRole("button", { name: "Remove" }).click();
  await expect(page.getByRole("listitem").filter({ hasText: hire })).toHaveCount(0);
});

test("staff take a request over the phone, with who called on record", async ({ page }) => {
  await signIn(page);
  await typeCode(page, await latestCode(STAFF.email));
  await page.waitForURL(/\/staff\/providers/);
  await page.getByRole("link", { name: "Assisted requests" }).click();
  await page.getByRole("button", { name: "Create request" }).click();
  await expect(page.getByText("Enter who called")).toBeVisible();

  await page.getByLabel("Who called").fill("Alie Kamara");
  await page.getByLabel("Number to call back").fill("076 111 222");
  await page.getByLabel("Who they are to the farmer").fill("Her son");
  await page.getByLabel("Farmer's name").fill("Fatmata Kamara");
  await page.getByLabel("Who may accept a quote").fill("Fatmata Kamara");
  await page.getByLabel("Service").selectOption("ploughing");
  await page.getByLabel("Land size (acres)").fill("4");
  await page.getByLabel("Land access").selectOption("easy");
  await page.getByLabel("Land clearance").selectOption("cleared");
  await page.getByLabel("District").selectOption("Bombali");
  await page.getByLabel("Village/town").fill("Assisted Village");
  await page.getByLabel("Preferred start date").fill(new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10));
  await page.getByRole("button", { name: "Create request" }).click();
  await page.waitForURL(/\/staff\/requests\/[\w-]+$/);
  await expect(page.getByText("Alie Kamara (Her son)")).toBeVisible();

  await page.getByLabel("What happened on the call").fill("Told her a quote is coming");
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Told her a quote is coming")).toBeVisible();
});
