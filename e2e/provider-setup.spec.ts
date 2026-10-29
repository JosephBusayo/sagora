import { expect, test, type Browser, type Page } from "@playwright/test";
import { testRun } from "./testdb";
import fs from "node:fs";
import path from "node:path";

const OUTBOX = path.join(process.cwd(), "data", "dev-outbox.jsonl");
const SHOTS = path.join(process.cwd(), "e2e", "screens");
fs.mkdirSync(SHOTS, { recursive: true });
const run = Date.now();
const P = { business: "Conteh Ploughing", phone: "078 222 333", email: `conteh.${run}@example.com`, password: "farmland-2026" };
const S = { business: "Sagora Coordinator", phone: "079 111 222", email: `staff.${run}@example.com`, password: "coordinator-77" };

type Mail = { to: string; subject: string; text: string };
const mailsTo = (email: string): Mail[] =>
  fs.existsSync(OUTBOX)
    ? fs.readFileSync(OUTBOX, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Mail).filter((m) => m.to === email)
    : [];
async function latestCode(email: string): Promise<string> {
  for (let i = 0; i < 50; i++) {
    const m = mailsTo(email);
    if (m.length) return m[m.length - 1].text.match(/code is (\d{7})/)![1];
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no email for ${email}`);
}
/** Types the emailed code and waits for the verification to actually go through. */
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
      await page.waitForTimeout(400); // the code was not accepted yet; read it again and retry
    }
  }
  throw new Error(`verification never completed for ${email}`);
}

async function registerAndVerify(page: Page, u: typeof P) {
  await page.goto("/provider/sign-up");
  await page.getByLabel("Business name").fill(u.business);
  await page.getByLabel("Your phone number").fill(u.phone);
  await page.getByLabel("Email").fill(u.email);
  await page.getByLabel("Password", { exact: true }).fill(u.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/verify-email$/);
  await enterCode(page, u.email);
}
/** Staff screens need a second factor: a code emailed to the staff account itself. */
async function passStaffCheck(page: Page, email: string, landing: string) {
  await page.goto(landing);
  if (!/\/staff\/verify$/.test(page.url())) return;
  for (let attempt = 0; attempt < 3; attempt++) {
    const c = await latestCode(email);
    await page.getByLabel("Digit 1 of 7").click();
    await page.keyboard.press("Control+A");
    await page.keyboard.type(c);
    await page.getByRole("button", { name: "Verify" }).click();
    try {
      await page.waitForURL((u) => !u.pathname.includes("/staff/verify"), { timeout: 5000 });
      await page.goto(landing);
      return;
    } catch { await page.waitForTimeout(400); }
  }
  throw new Error(`staff verification never completed for ${email}`);
}

async function fresh(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1728, height: 1117 } });
  return { ctx, page: await ctx.newPage() };
}

test.describe.configure({ mode: "serial" });

test("a new provider lands on setup, pre-filled, and can save for later", async ({ page }) => {
  await registerAndVerify(page, P);
  await expect(page).toHaveURL(/\/provider\/setup$/);
  await expect(page.getByRole("heading", { name: "Set up your business" })).toBeVisible();
  await expect(page.getByLabel("Business name")).toHaveValue(P.business);
  await expect(page.getByLabel("Business phone number")).toHaveValue("78222333");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${SHOTS}/6-setup.png`, fullPage: true });

  await page.getByLabel("Town or village").fill("Makeni");
  await page.getByRole("button", { name: "Save for later" }).click();
  await expect(page.getByText("Saved. You can come back")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Town or village")).toHaveValue("Makeni");
});

test("submitting an incomplete form is refused with clear messages", async ({ page }) => {
  await page.goto("/provider/sign-in");
  await page.getByLabel("Email").fill(P.email);
  await page.getByLabel("Password", { exact: true }).fill(P.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/setup$/);
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByText("Choose your district")).toBeVisible();
  await expect(page.getByText("Choose at least one service")).toBeVisible();
});

test("provider submits, sees a specific waiting state, and can no longer edit", async ({ page }) => {
  await page.goto("/provider/sign-in");
  await page.getByLabel("Email").fill(P.email);
  await page.getByLabel("Password", { exact: true }).fill(P.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByLabel("District").selectOption("Bombali");
  await page.getByLabel("Ploughing").check();
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByRole("heading", { name: "Waiting for Sagora to review your business" })).toBeVisible();
  await expect(page.getByLabel("Business name")).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/7-setup-submitted.png`, fullPage: true });
});

test("a provider cannot open the staff screen", async ({ page }) => {
  await page.goto("/provider/sign-in");
  await page.getByLabel("Email").fill(P.email);
  await page.getByLabel("Password", { exact: true }).fill(P.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.goto("/staff/providers");
  await expect(page).toHaveURL(/\/provider\/sign-in$/);
  const anon = await page.context().browser()!.newContext();
  const p = await anon.newPage();
  await p.goto("http://localhost:3100/staff/providers");
  await expect(p).toHaveURL(/\/provider\/sign-in$/);
  await anon.close();
});

test("staff asks for changes, provider fixes and resubmits, staff approves", async ({ page, browser }) => {
  // Make a second verified account and promote it to staff, as an operator would.
  const s = await fresh(browser);
  await registerAndVerify(s.page, S);
  await testRun(`UPDATE "user" SET role='staff' WHERE email=?`, S.email);
  await s.page.goto("/provider/sign-in");
  await s.page.getByLabel("Email").fill(S.email);
  await s.page.getByLabel("Password", { exact: true }).fill(S.password);
  await s.page.getByRole("button", { name: "Sign in" }).click();
  await passStaffCheck(s.page, S.email, "/staff/providers");
  await expect(s.page.getByRole("heading", { name: "Providers waiting for review" })).toBeVisible();
  await s.page.waitForLoadState("networkidle"); // let the review form hydrate before clicking
  const card = s.page.locator("section").filter({ hasText: P.email }); // email is unique per run
  await expect(card).toBeVisible();

  // Asking for changes without a reason does nothing.
  await card.getByRole("button", { name: "Ask for changes" }).click();
  await expect(card.getByText("Say what needs to change")).toBeVisible();

  await card.getByLabel(/Note to the provider/).fill("Please add your village name.");
  await card.getByRole("button", { name: "Ask for changes" }).click();
  // The business leaves the queue as soon as it is sent back.
  await expect(s.page.locator("section").filter({ hasText: P.email })).toHaveCount(0);
  await s.page.goto("/staff/providers"); // and it stays gone on a fresh load
  await expect(s.page.locator("section").filter({ hasText: P.email })).toHaveCount(0);
  expect(mailsTo(P.email).some((m) => m.text.includes("Please add your village name."))).toBe(true);

  // Provider sees the note and resubmits.
  await page.goto("/provider/sign-in");
  await page.getByLabel("Email").fill(P.email);
  await page.getByLabel("Password", { exact: true }).fill(P.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Please add your village name.")).toBeVisible();
  await page.getByLabel("Town or village").fill("Makeni, Bombali");
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.getByRole("heading", { name: "Waiting for Sagora to review your business" })).toBeVisible();

  // Staff approves.
  await s.page.goto("/staff/providers");
  const again = s.page.locator("section").filter({ hasText: P.email });
  await expect(again).toBeVisible();
  await s.page.waitForLoadState("networkidle");
  await again.getByRole("button", { name: "Approve" }).click();
  await expect(s.page.locator("section").filter({ hasText: P.email })).toHaveCount(0);
  await s.page.goto("/staff/providers");
  await expect(s.page.locator("section").filter({ hasText: P.email })).toHaveCount(0);
  // An approved provider no longer sees the setup screen: they go into the workspace.
  await page.reload();
  await expect(page).toHaveURL(/\/provider\/dashboard$/);
  await expect(page.getByRole("link", { name: "Team" })).toBeVisible();
  await s.ctx.close();
});
