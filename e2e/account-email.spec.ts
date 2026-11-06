import { expect, test, type Browser, type Page } from "@playwright/test";
import { confirmChecks } from "./checks";
import { testGet } from "./testdb";
import fs from "node:fs";
import path from "node:path";

const OUTBOX = path.join(process.cwd(), "data", "dev-outbox.jsonl");
const SHOTS = path.join(process.cwd(), "e2e", "screens");
fs.mkdirSync(SHOTS, { recursive: true });

const run = Date.now();
const F = { name: "Fatmata Kamara", phone: "076 404 505", email: `fatmata.${run}@example.com`, password: "cassava-26-field" };
const NEW_EMAIL = `fatmata.new.${run}@example.com`;
const OTHER = { name: "Isata Koroma", phone: "076 505 606", email: `isata.${run}@example.com`, password: "groundnut-26-row" };

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
async function fresh(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1728, height: 1117 } });
  return { ctx, page: await confirmChecks(await ctx.newPage()) };
}
async function signUp(browser: Browser, who: typeof F) {
  const f = await fresh(browser);
  await f.page.goto("/farmer/sign-up");
  await f.page.getByLabel("First and last name").fill(who.name);
  await f.page.getByLabel("Your phone number").fill(who.phone);
  await f.page.getByLabel("Email").fill(who.email);
  await f.page.getByLabel("Password", { exact: true }).fill(who.password);
  await f.page.getByRole("button", { name: "Create account" }).click();
  await typeCode(f.page, await latestCode(who.email));
  await f.page.waitForURL((u) => !u.pathname.includes("verify-email"));
  await f.ctx.close();
}
async function signIn(page: Page, email: string, password: string) {
  await page.goto("/farmer/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  await signUp(browser, F);
  await signUp(browser, OTHER);
});

test("a farmer changes their sign-in email with a code sent to the new address", async ({ page, browser }) => {
  await confirmChecks(page);
  await signIn(page, F.email, F.password);
  await expect(page).not.toHaveURL(/sign-in/);

  await page.goto("/farmer/settings/account");
  await page.getByRole("link", { name: "Change email" }).click();
  await expect(page).toHaveURL(/\/farmer\/settings\/email$/);
  await expect(page.getByLabel("Current email address")).toHaveValue(F.email);

  // The new address must be new, free and real, and the password must be theirs.
  await page.getByLabel("New email address").fill(F.email);
  await page.getByLabel("Current password").fill(F.password);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByText("This is already your email address")).toBeVisible();

  await page.getByLabel("New email address").fill(OTHER.email);
  await page.getByLabel("Current password").fill(F.password);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByText("Another Sagora account already uses this email address.")).toBeVisible();

  await page.getByLabel("New email address").fill(NEW_EMAIL);
  await page.getByLabel("Current password").fill("not-my-password");
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page.getByText("That password is not correct.")).toBeVisible();
  expect(mailsTo(NEW_EMAIL)).toHaveLength(0);

  await page.getByLabel("Current password").fill(F.password);
  await page.getByRole("button", { name: "Send code" }).click();
  await expect(page).toHaveURL(/step=code/);
  await expect(page.getByRole("heading", { name: "Check your new email" })).toBeVisible();
  await expect(page.getByText(`Enter the code we sent to ${NEW_EMAIL}`)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/60-change-email-code.png`, fullPage: true });

  // A wrong code changes nothing.
  await typeCode(page, "0000000");
  await expect(page.getByText(/code is incorrect|didn't work/)).toBeVisible();
  const before = await testGet(`SELECT email FROM "user" WHERE email=?`, F.email) as { email: string } | undefined;
  expect(before?.email).toBe(F.email);

  await typeCode(page, await latestCode(NEW_EMAIL));
  await expect(page).toHaveURL(/\/farmer\/settings\/account$/);
  await expect(page.locator("#farmer-email")).toHaveValue(NEW_EMAIL);

  // The old address is told, and only the new one signs in.
  expect(mailsTo(F.email).some((m) => m.subject === "Your Sagora email address was changed" && m.text.includes(NEW_EMAIL))).toBe(true);
  const other = await fresh(browser);
  await signIn(other.page, F.email, F.password);
  await expect(other.page).toHaveURL(/sign-in/);
  await signIn(other.page, NEW_EMAIL, F.password);
  await expect(other.page).not.toHaveURL(/sign-in/);
  await other.ctx.close();
});

test("the code screen without a change in progress goes back to the first step", async ({ page }) => {
  await confirmChecks(page);
  await signIn(page, OTHER.email, OTHER.password);
  await expect(page).not.toHaveURL(/sign-in/);
  await page.goto("/farmer/settings/email?step=code");
  await expect(page.getByRole("heading", { name: "Change email" })).toBeVisible();
  await expect(page.getByLabel("New email address")).toBeVisible();
});
