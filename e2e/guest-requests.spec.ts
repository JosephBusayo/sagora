import { expect, test, type Browser, type Page } from "@playwright/test";
import { completeApplication, confirmChecks } from "./checks";
import { testGet, testRun } from "./testdb";
import fs from "node:fs";
import path from "node:path";

/**
 * Requests without an account (Karim, 7 Nov 2026): fill in the request, get a tracking code, come
 * back with the code and the phone number, change it, see quotes and accept one. Staff can replace
 * a lost code.
 */

const OUTBOX = path.join(process.cwd(), "data", "dev-outbox.jsonl");
const run = Date.now();
const digits = (n: number) => String(run).slice(-n);
const GUEST = { name: "Fatmata Sesay", phone: `076 ${digits(3)} ${String(run).slice(-6, -3)}` };
const PROVIDER = { business: "Bo Guest Ploughing", phone: "077 626 727", email: `guestprov.${run}@example.com`, password: "plough-guest-26" };
const STAFF = { business: "Guest Desk", phone: "078 626 727", email: `guest.staff.${run}@example.com`, password: "guest-desk-26" };

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
async function find(page: Page, code: string, phone: string) {
  await page.goto("/request/find");
  await page.getByLabel("Tracking code").fill(code);
  await page.getByLabel("Your phone number").fill(phone);
  await page.getByRole("button", { name: "Find my request" }).click();
}
const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

let code = "";
let reference = "";

test.beforeEach(async ({ page }) => { await confirmChecks(page); });
test.describe.configure({ mode: "serial", timeout: 120_000 });

test.beforeAll(async ({ browser }) => {
  const p = await fresh(browser);
  await signUp(p.page, PROVIDER);
  await p.page.getByLabel("District").selectOption("Bo");
  await p.page.getByLabel("Ploughing").check();
  await p.page.getByLabel("Town or village").fill("Bo town");
  await completeApplication(p.page);
  await p.page.getByRole("button", { name: "Submit for review" }).click();
  const u = await testGet(`SELECT id FROM "user" WHERE email=?`, PROVIDER.email) as { id: string };
  const now = new Date().toISOString();
  await testRun("UPDATE provider_business SET status='approved', reviewed_at=?, updated_at=? WHERE user_id=?", now, now, u.id);
  await p.ctx.close();

  const s = await fresh(browser);
  await signUp(s.page, STAFF);
  await s.ctx.close();
  await testRun(`UPDATE "user" SET role='admin' WHERE email=?`, STAFF.email);
});

test("a farmer with no account sends a request, gets a tracking code and can change it", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("link", { name: "Find it here" })).toHaveAttribute("href", "/request/find");
  await page.goto("/request");
  await page.getByLabel("What work do you need?").selectOption("ploughing");
  await page.getByLabel("Land size").fill("3");
  await page.getByLabel("Easy access").check();
  await page.getByLabel("Cleared").check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("District").selectOption("Bo");
  await page.getByLabel("Chiefdom").selectOption({ index: 1 });
  await page.getByLabel("Village/town").fill("Gerihun");
  await page.getByLabel("Preferred start date").fill(inDays(14));
  // Name and number are needed: they are the way back without an account.
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Enter your name")).toBeVisible();
  await page.getByLabel("Your name").fill(GUEST.name);
  await page.getByLabel("Your phone number").fill("12");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Enter a valid Sierra Leone number, for example 76 123 456")).toBeVisible();
  await page.getByLabel("Your phone number").fill(GUEST.phone);
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Check your request")).toBeVisible();
  await expect(page.getByText(GUEST.name)).toBeVisible();
  await page.getByRole("button", { name: "Send request" }).click();

  await page.waitForURL(/\/request\/track/);
  await expect(page.getByRole("heading", { name: "Your tracking code" })).toBeVisible();
  await expect(page.getByText("Write this code down. You need it to come back to this request.")).toBeVisible();
  code = (await page.getByTestId("tracking-code").textContent())!.trim();
  expect(code).toMatch(/^SAG-[A-HJKMNP-Z2-9]{5}$/);
  const row = await testGet("SELECT reference, farmer_id, contact_phone, tracking_hash FROM service_request WHERE contact_name=? ORDER BY created_at DESC", GUEST.name) as
    { reference: string; farmer_id: string | null; contact_phone: string; tracking_hash: string };
  reference = row.reference;
  expect(row.farmer_id).toBeNull();
  expect(row.contact_phone).toBe(`+232${GUEST.phone.replace(/\D/g, "").slice(-8)}`);
  // Only a keyed hash is kept: the code itself is nowhere in the database.
  expect(row.tracking_hash).not.toContain(code.slice(4));
  await expect(page.getByText(reference)).toBeVisible();

  // A reload keeps the request open on this phone.
  await page.reload();
  await expect(page.getByText(reference)).toBeVisible();

  await page.getByRole("link", { name: "Edit request" }).click();
  await page.waitForURL(/\/request\/track\/edit/);
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByLabel("Village/town").fill("Gerihun Junction");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByRole("button", { name: "Save changes" }).click();
  await page.waitForURL(/\/request\/track\?saved=1/);
  await expect(page.getByText("Your changes are saved.")).toBeVisible();
  await expect(page.getByText(/Gerihun Junction/)).toBeVisible();
});

test("the code and the phone number together bring the farmer back on another phone", async ({ browser }) => {
  const g = await fresh(browser);
  await g.page.goto("/request/track");
  await g.page.waitForURL(/\/request\/find/);

  await find(g.page, code, "076 000 001");
  await expect(g.page.getByText("We could not find a request with that tracking code and phone number. Check both and try again.")).toBeVisible();

  // Typed loosely, as people do: lower case, no dash, the number with its country code.
  await find(g.page, code.toLowerCase().replace("-", " "), `+232 ${GUEST.phone.slice(1)}`);
  await g.page.waitForURL(/\/request\/track$/);
  await expect(g.page.getByText(reference)).toBeVisible();
  // The code itself is only shown where it was made.
  await expect(g.page.getByTestId("tracking-code")).toHaveCount(0);

  await g.page.getByRole("button", { name: "Close this request on this phone" }).click();
  await g.page.waitForURL(/\/request\/find\?left=1/);
  await g.page.goto("/request/track");
  await g.page.waitForURL(/\/request\/find/);
  await g.ctx.close();
});

test("the farmer sees a provider's quote with their code and accepts it", async ({ browser }) => {
  const p = await fresh(browser);
  await signInProvider(p.page);
  await p.page.goto(`/provider/requests?open=${reference}`);
  const dialog = p.page.getByRole("dialog");
  if (!(await dialog.count())) await p.page.getByRole("button", { name: `Open request ${reference}` }).click();
  await dialog.getByRole("button", { name: "Send a quote" }).click();
  await dialog.getByLabel("Total price (Le)").fill("4,500.00");
  await dialog.getByLabel("What the price covers").fill("Tractor, plough and operator");
  await dialog.getByLabel("Can start on").fill(inDays(14));
  await dialog.getByLabel("Price holds until").fill(inDays(10));
  await dialog.getByRole("button", { name: "Send a quote" }).click();
  await expect(p.page.getByText("Quote sent to the farmer.")).toBeVisible();
  await p.ctx.close();

  const g = await fresh(browser);
  await find(g.page, code, GUEST.phone);
  await g.page.waitForURL(/\/request\/track$/);
  // Once quoted, the details are fixed.
  await expect(g.page.getByRole("link", { name: "Edit request" })).toHaveCount(0);
  await expect(g.page.getByText("Bo Guest Ploughing")).toBeVisible();
  await g.page.getByRole("button", { name: "Accept quote" }).click();
  await g.page.getByRole("dialog", { name: "Confirm" }).getByRole("button", { name: "Accept quote" }).click();
  await g.page.waitForURL(/accepted=1/);
  await expect(g.page.getByText("You accepted this quote. The price and terms are now fixed.", { exact: false })).toBeVisible();
  const agreed = await testGet("SELECT a.accepted_by FROM agreement a JOIN service_request r ON r.id=a.request_id WHERE r.reference=?", reference) as { accepted_by: string };
  expect(agreed.accepted_by).toMatch(/^guest:/);
  await g.ctx.close();
});

test("staff replace a lost code, and the old one stops working", async ({ page, browser }) => {
  await signInStaff(page);
  await page.goto(`/staff/requests?phone=${encodeURIComponent(GUEST.phone)}`);
  await expect(page.getByText(/sent from the website/)).toBeVisible();
  await page.getByRole("link", { name: reference }).click();
  await page.getByRole("button", { name: "New tracking code" }).click();
  await page.getByRole("dialog", { name: "Confirm" }).getByRole("button", { name: "Make a new code" }).click();
  const fresher = (await page.getByTestId("staff-tracking-code").textContent())!.trim();
  expect(fresher).toMatch(/^SAG-/);
  expect(fresher).not.toBe(code);

  const g = await fresh(browser);
  await find(g.page, code, GUEST.phone);
  await expect(g.page.getByText(/We could not find a request/)).toBeVisible();
  await find(g.page, fresher, GUEST.phone);
  await g.page.waitForURL(/\/request\/track$/);
  await expect(g.page.getByText(reference)).toBeVisible();
  await g.ctx.close();
});

test("guessing codes is cut off after five wrong tries for a number", async ({ page }) => {
  const phone = `077 ${digits(3)} 909`;
  for (let i = 0; i < 5; i++) {
    await find(page, `SAG-ZZZZ${i + 2}`, phone);
    await expect(page.getByText(/We could not find a request/)).toBeVisible();
  }
  await find(page, code, phone);
  await expect(page.getByText("Too many wrong tries. Wait 15 minutes and try again, or speak to us on WhatsApp.")).toBeVisible();
});
