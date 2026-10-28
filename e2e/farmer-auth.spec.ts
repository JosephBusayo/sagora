import { expect, test, type Browser, type Page } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

const OUTBOX = path.join(process.cwd(), "data", "dev-outbox.jsonl");
const DB = path.join(process.cwd(), "data", "test.db");
const SHOTS = path.join(process.cwd(), "e2e", "screens");
fs.mkdirSync(SHOTS, { recursive: true });

const run = Date.now();
const F = { name: "Aminata Sesay", phone: "076 808 909", email: `aminata.${run}@example.com`, password: "harvest-rice-26" };
const P = { business: "Sesay Tractors", phone: "077 101 202", email: `provider.${run}@example.com`, password: "ploughing-26" };

type Mail = { to: string; subject: string; text: string };
const mailsTo = (email: string): Mail[] =>
  fs.existsSync(OUTBOX)
    ? fs.readFileSync(OUTBOX, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Mail).filter((m) => m.to === email)
    : [];
async function latestCode(email: string, min = 1): Promise<string> {
  for (let i = 0; i < 60; i++) {
    const m = mailsTo(email);
    if (m.length >= min) return m[m.length - 1].text.match(/code is (\d{7})/)![1];
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no email for ${email}`);
}
async function enterCode(page: Page, email: string, min = 1) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = await latestCode(email, min);
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
const roleOf = (email: string) => {
  const db = new DatabaseSync(DB);
  const r = db.prepare("SELECT role FROM user WHERE email=?").get(email) as { role: string } | undefined;
  db.close();
  return r?.role;
};

test.describe.configure({ mode: "serial" });

test("farmer screens render, and ask for a name rather than a business", async ({ page }) => {
  await page.goto("/farmer/sign-up");
  await expect(page.getByRole("heading", { name: "Create an account" })).toBeVisible();
  await expect(page.getByLabel("First and last name")).toBeVisible();
  await expect(page.getByLabel("Business name")).toHaveCount(0);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${SHOTS}/13-farmer-sign-up.png` });

  await page.goto("/farmer/sign-in");
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Create an account" })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/14-farmer-sign-in.png` });
});

test("farmer signs up, verifies, and reaches the farmer home as a farmer account", async ({ page }) => {
  await page.goto("/farmer/sign-up");
  await page.getByLabel("First and last name").fill(F.name);
  await page.getByLabel("Your phone number").fill(F.phone);
  await page.getByLabel("Email").fill(F.email);
  await page.getByLabel("Password", { exact: true }).fill(F.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/farmer\/verify-email$/);

  await enterCode(page, F.email);
  await expect(page).toHaveURL(/\/farmer\/home$/);
  await expect(page.getByRole("heading", { name: "Welcome, Aminata" })).toBeVisible();
  expect(roleOf(F.email)).toBe("farmer");
});

test("a farmer cannot reach the provider workspace or the staff screen", async ({ page }) => {
  await page.goto("/farmer/sign-in");
  await page.getByLabel("Email").fill(F.email);
  await page.getByLabel("Password", { exact: true }).fill(F.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/farmer\/home$/);

  for (const url of ["/provider/setup", "/provider/team", "/provider/settings"]) {
    await page.goto(url);
    await expect(page).toHaveURL(/\/farmer\/home$/);
  }
  await page.goto("/staff/providers");
  await expect(page).toHaveURL(/\/provider\/sign-in$/);
});

test("a provider signing in on the farmer screen lands in the provider app, not the farmer one", async ({ page, browser }) => {
  // Make a provider account through the provider screens.
  const { ctx, page: p } = await fresh(browser);
  await p.goto("/provider/sign-up");
  await p.getByLabel("Business name").fill(P.business);
  await p.getByLabel("Your phone number").fill(P.phone);
  await p.getByLabel("Email").fill(P.email);
  await p.getByLabel("Password", { exact: true }).fill(P.password);
  await p.getByRole("button", { name: "Create account" }).click();
  await enterCode(p, P.email);
  await expect(p).toHaveURL(/\/provider\/setup$/);
  await ctx.close();

  // The same account, signing in on the farmer screen, goes to the provider side.
  await page.goto("/farmer/sign-in");
  await page.getByLabel("Email").fill(P.email);
  await page.getByLabel("Password", { exact: true }).fill(P.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/provider\/setup$/);

  // And the farmer home stays closed to them.
  await page.goto("/farmer/home");
  await expect(page).toHaveURL(/\/provider\/setup$/);
});

test("farmer home is closed without a verified session", async ({ page }) => {
  await page.goto("/farmer/home");
  await expect(page).toHaveURL(/\/farmer\/sign-in$/);
});

test("farmer password reset returns to the farmer sign-in, not the provider one", async ({ page }) => {
  await page.goto("/farmer/forgot-password");
  await page.getByLabel("Email").fill(F.email);
  const before = mailsTo(F.email).length;
  await page.getByRole("button", { name: "Get verification code" }).click();
  await expect(page).toHaveURL(/\/farmer\/verify-email$/);

  const code = await latestCode(F.email, before + 1);
  await page.getByLabel("Digit 1 of 7").click();
  await page.keyboard.type(code);
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/farmer\/reset-password$/);

  await page.getByLabel("Password", { exact: true }).fill("new-farmer-pass-1");
  await page.getByLabel("Confirm Password", { exact: true }).fill("new-farmer-pass-1");
  await page.getByRole("button", { name: "Reset password" }).click();
  await expect(page).toHaveURL(/\/farmer\/sign-in\?reset=1$/);

  await page.getByLabel("Email").fill(F.email);
  await page.getByLabel("Password", { exact: true }).fill("new-farmer-pass-1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/farmer\/home$/);
});

test("farmer sign-up works without JavaScript", async ({ browser }) => {
  const ctx = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1728, height: 1117 } });
  const page = await ctx.newPage();
  const u = { ...F, email: `nojs.farmer.${run}@example.com`, name: "Fatmata Kamara" };
  await page.goto("/farmer/sign-up");
  await page.getByLabel("First and last name").fill(u.name);
  await page.getByLabel("Your phone number").fill(u.phone);
  await page.getByLabel("Email").fill(u.email);
  await page.getByLabel("Password", { exact: true }).fill(u.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/farmer\/verify-email$/);
  const code = await latestCode(u.email);
  await page.locator('input[name="codeFallback"]').fill(code);
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page).toHaveURL(/\/farmer\/home$/);
  await ctx.close();
});
