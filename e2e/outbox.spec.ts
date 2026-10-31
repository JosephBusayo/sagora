import { expect, test, type Browser, type Page } from "@playwright/test";
import { testAll, testGet, testRun } from "./testdb";
import fs from "node:fs";
import path from "node:path";

const OUTBOX = path.join(process.cwd(), "data", "dev-outbox.jsonl");
const SHOTS = path.join(process.cwd(), "e2e", "screens");
fs.mkdirSync(SHOTS, { recursive: true });

const run = Date.now();
const FARMER = { name: "Outbox Farmer", phone: "076 909 010", email: `outbox.farmer.${run}@example.com`, pass: "outbox-farm-26" };
const STAFF = { business: "Outbox Coordinator", phone: "079 707 606", email: `outbox.staff.${run}@example.com`, pass: "outbox-staff-26" };

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
  return { ctx, page: await ctx.newPage() };
}
const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

/** Staff screens need a second factor: a code emailed to the staff account itself. */
async function passStaffCheck(page: Page, email: string, landing: string) {
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

async function outboxRows(kindLike: string) {
  const rows = await testAll(
    "SELECT kind, status, attempts, recipient, dedupe_key FROM notification_outbox WHERE kind LIKE ? ORDER BY created_at", kindLike) as { kind: string; status: string; attempts: number; recipient: string; dedupe_key: string | null }[];
  return rows;
}

test.describe.configure({ mode: "serial" });

test("a notification is saved before it is sent, and recorded as sent", async ({ page }) => {
  await page.goto("/farmer/sign-up");
  await page.getByLabel("First and last name").fill(FARMER.name);
  await page.getByLabel("Your phone number").fill(FARMER.phone);
  await page.getByLabel("Email").fill(FARMER.email);
  await page.getByLabel("Password", { exact: true }).fill(FARMER.pass);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/verify-email/);

  // The verification email exists as an outbox row, not just a side effect.
  await latestCode(FARMER.email);
  const rows = (await outboxRows("otp.%")).filter((r) => r.recipient === FARMER.email);
  expect(rows.length).toBeGreaterThan(0);
  expect(rows[0].status).toBe("sent");
  expect(rows[0].attempts).toBe(1);

  await enterCode(page, FARMER.email);
  await expect(page).toHaveURL(/\/farmer\/home$/);
});

test("the same event queued twice only sends once", async ({ page }) => {
  await page.goto("/farmer/sign-in");
  await page.getByLabel("Email").fill(FARMER.email);
  await page.getByLabel("Password", { exact: true }).fill(FARMER.pass);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/sign-in/);

  await page.goto("/farmer/book");
  await page.getByLabel("What work do you need?").selectOption("ploughing");
  await page.getByLabel("Land size").fill("2");
  await page.getByLabel("Easy access").check();
  await page.getByLabel("Cleared").check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("District").selectOption("Bombali");
  await page.getByLabel("Village/town").fill("Outbox Village");
  await page.getByLabel("Preferred start date").fill(inDays(30));
  await page.getByRole("button", { name: "Send request" }).click();
  const reference = (await page.getByText(/Request SG-\d+ sent/).innerText()).match(/SG-\d+/)![0];

  // One row, with a dedupe key tied to the request.
  const rows = (await outboxRows("request.created")).filter((r) => r.recipient === FARMER.email);
  expect(rows).toHaveLength(1);
  expect(rows[0].dedupe_key).toBeTruthy();

  // Queue the identical event again: the unique dedupe key keeps it to one.
  let threw = false;
  try {
    await testRun(
      `INSERT INTO notification_outbox (id, recipient, subject, body, kind, dedupe_key, next_attempt_at, created_at)
       VALUES ('dup-test', ?, 'dup', 'dup', 'request.created', ?, ?, ?)`, FARMER.email, rows[0].dedupe_key, new Date().toISOString(), new Date().toISOString());
  } catch {
    threw = true;
  }
  expect(threw).toBe(true);
  expect(reference).toMatch(/SG-\d+/);
});

test("a failing send keeps the work, retries, and shows in the staff queue", async ({ page, browser }) => {
  // A message that cannot be delivered: the dev outbox writes anywhere, so simulate a failed
  // send by putting a row straight into the queue as already given up.
  const now = new Date().toISOString();
  await testRun(
    `INSERT INTO notification_outbox (id, recipient, subject, body, kind, status, attempts, last_error, next_attempt_at, created_at)
     VALUES (?,?,?,?,?,'failed',5,'Email provider rejected the message (500)',?,?)`, `fail-${run}`, "unreachable@example.com", "Quote ready", "body", "quote.sent", now, now);

  // Staff account, promoted.
  const s = await fresh(browser);
  await s.page.goto("/provider/sign-up");
  await s.page.getByLabel("Business name").fill(STAFF.business);
  await s.page.getByLabel("Your phone number").fill(STAFF.phone);
  await s.page.getByLabel("Email").fill(STAFF.email);
  await s.page.getByLabel("Password", { exact: true }).fill(STAFF.pass);
  await s.page.getByRole("button", { name: "Create account" }).click();
  await enterCode(s.page, STAFF.email);
  await testRun(`UPDATE "user" SET role='staff' WHERE email=?`, STAFF.email);

  await s.page.goto("/staff/sign-in");
  await s.page.getByLabel("Email").fill(STAFF.email);
  await s.page.getByLabel("Password", { exact: true }).fill(STAFF.pass);
  await s.page.getByRole("button", { name: "Sign in" }).click();
  await s.page.waitForURL(/\/staff\/verify$/);

  await passStaffCheck(s.page, STAFF.email, "/staff/outbox");
  await expect(s.page.getByRole("heading", { name: "Notification queue" })).toBeVisible();
  const row = s.page.getByRole("row").filter({ hasText: "unreachable@example.com" });
  await expect(row.getByText("Gave up")).toBeVisible();
  await expect(row.getByText(/rejected the message/)).toBeVisible();
  await s.page.waitForLoadState("networkidle");
  await s.page.screenshot({ path: `${SHOTS}/26-staff-outbox.png`, fullPage: true });

  // Staff can push it back into the queue; it sends this time.
  await row.getByRole("button", { name: "Try again" }).click();
  await expect(s.page.getByRole("row").filter({ hasText: "unreachable@example.com" })).toHaveCount(0);
  const after = await testGet("SELECT status FROM notification_outbox WHERE id=?", `fail-${run}`) as { status: string };
  expect(after.status).toBe("sent");
  await s.ctx.close();
  await page.goto("/farmer/sign-in");
});

test("only staff can see the notification queue", async ({ page }) => {
  await page.goto("/farmer/sign-in");
  await page.getByLabel("Email").fill(FARMER.email);
  await page.getByLabel("Password", { exact: true }).fill(FARMER.pass);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.goto("/staff/outbox");
  await expect(page).toHaveURL(/\/provider\/sign-in$/);
});
