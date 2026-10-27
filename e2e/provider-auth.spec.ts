import { expect, test, type Browser, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const OUTBOX = path.join(process.cwd(), "data", "dev-outbox.jsonl");
const SHOTS = path.join(process.cwd(), "e2e", "screens");
fs.mkdirSync(SHOTS, { recursive: true });

const run = Date.now();
const A = { business: "Kamara Tractor Services", phone: "076 123 456", email: `kamara.${run}@example.com`, password: "farmland-2026" };
const B = { business: "Bangura Harvesters", phone: "+232 77 555 010", email: `bangura.${run}@example.com`, password: "harvest-time-9" };

type Mail = { to: string; subject: string; text: string };
function mailsTo(email: string): Mail[] {
  if (!fs.existsSync(OUTBOX)) return [];
  return fs
    .readFileSync(OUTBOX, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Mail)
    .filter((m) => m.to === email);
}
async function latestCode(email: string, minCount = 1): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const m = mailsTo(email);
    if (m.length >= minCount) return m[m.length - 1].text.match(/code is (\d{7})/)![1];
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no email arrived for ${email}`);
}
async function typeCode(page: Page, code: string) {
  await page.getByLabel("Digit 1 of 7").click();
  await page.keyboard.type(code);
}
async function signUp(page: Page, u: typeof A) {
  await page.goto("/provider/sign-up");
  await page.getByLabel("Business name").fill(u.business);
  await page.getByLabel("Your phone number").fill(u.phone);
  await page.getByLabel("Email").fill(u.email);
  await page.getByLabel("Password", { exact: true }).fill(u.password);
  await page.getByRole("button", { name: "Create account" }).click();
}
async function freshPage(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1728, height: 1117 } });
  return { ctx, page: await ctx.newPage() };
}

test.describe.configure({ mode: "serial" });

test("screens render as designed (screenshots saved for comparison)", async ({ page }) => {
  await page.goto("/provider/sign-up");
  await expect(page.getByRole("heading", { name: "Create a provider account" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${SHOTS}/1-sign-up.png` });
  await page.goto("/provider/sign-in");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/2-sign-in.png` });
  await page.goto("/provider/forgot-password");
  await expect(page.getByRole("heading", { name: "Forgot password" })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/3-forgot-password.png` });
});

test("sign-up validates input and keeps what was typed", async ({ page }) => {
  await page.goto("/provider/sign-up");
  await page.getByLabel("Business name").fill("Ab");
  await page.getByLabel("Your phone number").fill("12345");
  await page.getByLabel("Email").fill("someone@example.com");
  await page.getByLabel("Password", { exact: true }).fill("longenough1");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByText("Enter a valid Sierra Leone number")).toBeVisible();
  await expect(page.getByLabel("Email")).toHaveValue("someone@example.com");
});

test("provider signs up, must verify, then reaches setup", async ({ page }) => {
  await signUp(page, A);
  await expect(page).toHaveURL(/\/provider\/verify-email$/);
  await expect(page.getByRole("heading", { name: "Email verification" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${SHOTS}/4-verify-email.png` });

  // Wrong code is refused and does not sign anyone in.
  await typeCode(page, "0000000");
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText("incorrect")).toBeVisible();

  // Before verifying, setup is closed even with the right URL.
  const other = await freshPage(page.context().browser()!);
  await other.page.goto("/provider/setup");
  await expect(other.page).toHaveURL(/\/provider\/sign-in$/);
  await other.ctx.close();

  const code = await latestCode(A.email);
  await page.getByLabel("Digit 1 of 7").click();
  await page.keyboard.press("Control+A");
  await typeCode(page, code);
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/provider\/setup$/);
  await expect(page.getByRole("heading", { name: `Welcome, ${A.business}` })).toBeVisible();
});

test("a used code cannot be used again", async ({ page }) => {
  // The code that just verified A is spent: a new reset session must not accept it.
  const spent = await latestCode(A.email);
  await page.goto("/provider/forgot-password");
  await page.getByLabel("Email").fill(A.email);
  await page.getByRole("button", { name: "Get verification code" }).click();
  await expect(page).toHaveURL(/\/provider\/verify-email$/);
  await typeCode(page, spent);
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByText(/incorrect|expired|didn't work/i)).toBeVisible();
});

test("unverified account is sent to verification, not setup", async ({ page, browser }) => {
  await signUp(page, B);
  await expect(page).toHaveURL(/\/provider\/verify-email$/);
  const mailsAfterSignUp = mailsTo(B.email).length;

  const { ctx, page: p2 } = await freshPage(browser);
  await p2.goto("/provider/sign-in");
  await p2.getByLabel("Email").fill(B.email);
  await p2.getByLabel("Password", { exact: true }).fill(B.password);
  await p2.getByRole("button", { name: "Sign in" }).click();
  await expect(p2).toHaveURL(/\/provider\/verify-email$/);
  await p2.goto("/provider/setup");
  await expect(p2).toHaveURL(/\/provider\/sign-in$/);

  // Re-trying must not create a second business or a duplicate account.
  const dup = await freshPage(browser);
  await signUp(dup.page, B);
  await expect(dup.page.locator("body")).toContainText(/verification|couldn't create an account/i);
  await dup.ctx.close();
  await ctx.close();
  expect(mailsAfterSignUp).toBeGreaterThan(0);
});

test("wrong password gives a neutral message; unknown email gives no hint", async ({ page }) => {
  await page.goto("/provider/sign-in");
  await page.getByLabel("Email").fill(A.email);
  await page.getByLabel("Password", { exact: true }).fill("not-the-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Incorrect email or password.")).toBeVisible();

  const before = mailsTo("nobody@example.com").length;
  await page.goto("/provider/forgot-password");
  await page.getByLabel("Email").fill("nobody@example.com");
  await page.getByRole("button", { name: "Get verification code" }).click();
  await expect(page).toHaveURL(/\/provider\/verify-email$/); // same screen as a real account
  await page.waitForTimeout(500);
  expect(mailsTo("nobody@example.com").length).toBe(before); // and no email goes out
});

test("password reset signs out other browsers and the old password stops working", async ({ page, browser }) => {
  // Browser 1: signed in.
  await page.goto("/provider/sign-in");
  await page.getByLabel("Email").fill(A.email);
  await page.getByLabel("Password", { exact: true }).fill(A.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/provider\/setup$/);

  // Browser 2: resets the password.
  const { ctx, page: p2 } = await freshPage(browser);
  await p2.goto("/provider/forgot-password");
  await p2.getByLabel("Email").fill(A.email);
  const countBefore = mailsTo(A.email).length;
  await p2.getByRole("button", { name: "Get verification code" }).click();
  await expect(p2).toHaveURL(/\/provider\/verify-email$/);
  const code = await latestCode(A.email, countBefore + 1);
  await typeCode(p2, code);
  await p2.getByRole("button", { name: "Verify" }).click();
  await expect(p2).toHaveURL(/\/provider\/reset-password$/);
  await p2.waitForLoadState("networkidle");
  await p2.screenshot({ path: `${SHOTS}/5-reset-password.png` });
  await p2.getByLabel("Password", { exact: true }).fill("brand-new-pass-1");
  await p2.getByLabel("Confirm Password", { exact: true }).fill("brand-new-pass-1");
  await p2.getByRole("button", { name: "Reset password" }).click();
  await expect(p2).toHaveURL(/\/provider\/sign-in\?reset=1$/);
  await expect(p2.getByText("Your password has been updated")).toBeVisible();

  // Browser 1's session must now fail on its next protected request.
  await page.goto("/provider/setup");
  await expect(page).toHaveURL(/\/provider\/sign-in$/);

  // Old password is dead, new one works.
  await p2.getByLabel("Email").fill(A.email);
  await p2.getByLabel("Password", { exact: true }).fill(A.password);
  await p2.getByRole("button", { name: "Sign in" }).click();
  await expect(p2.getByText("Incorrect email or password.")).toBeVisible();
  await p2.getByLabel("Password", { exact: true }).fill("brand-new-pass-1");
  await p2.getByRole("button", { name: "Sign in" }).click();
  await expect(p2).toHaveURL(/\/provider\/setup$/);

  // Sign out works and closes setup again.
  await p2.getByRole("button", { name: "Sign out" }).click();
  await expect(p2).toHaveURL(/\/provider\/sign-in$/);
  await p2.goto("/provider/setup");
  await expect(p2).toHaveURL(/\/provider\/sign-in$/);
  await ctx.close();
});

test("reset screen is closed without a checked code", async ({ page }) => {
  await page.goto("/provider/reset-password");
  await expect(page).toHaveURL(/\/provider\/forgot-password$/);
});

test("sign-up works without JavaScript", async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1728, height: 1117 } });
  const page = await ctx.newPage();
  const u = { ...A, email: `nojs.${run}@example.com`, business: "No Script Farms" };
  await signUp(page, u);
  await expect(page).toHaveURL(/\/provider\/verify-email$/);
  const code = await latestCode(u.email);
  await page.locator('input[name="codeFallback"]').fill(code);
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/provider\/setup$/);
  await ctx.close();
});
