import { expect, test, type Browser, type Page } from "@playwright/test";
import { testAll, testGet, testRun } from "./testdb";
import fs from "node:fs";
import path from "node:path";

const OUTBOX = path.join(process.cwd(), "data", "dev-outbox.jsonl");
const SHOTS = path.join(process.cwd(), "e2e", "screens");
fs.mkdirSync(SHOTS, { recursive: true });

const run = Date.now();
const FARMER = { name: "Kadiatu Turay", phone: "076 505 606", email: `kadiatu.${run}@example.com`, password: "ploughing-now-26" };
const A = { business: "Turay Tractors", phone: "077 111 000", email: `atractors.${run}@example.com`, password: "quote-one-2026" };
const B = { business: "Sankoh Ploughing", phone: "077 222 000", email: `bploughing.${run}@example.com`, password: "quote-two-2026" };

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

async function makeProvider(browser: Browser, p: typeof A) {
  const { ctx, page } = await fresh(browser);
  await page.goto("/provider/sign-up");
  await page.getByLabel("Business name").fill(p.business);
  await page.getByLabel("Your phone number").fill(p.phone);
  await page.getByLabel("Email").fill(p.email);
  await page.getByLabel("Password", { exact: true }).fill(p.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await enterCode(page, p.email);
  await page.getByLabel("District").selectOption("Bombali");
  await page.getByLabel("Ploughing").check();
  await page.getByLabel("Town or village").fill("Makeni");
  await page.getByRole("button", { name: "Submit for review" }).click();
  const u = await testGet(`SELECT id FROM "user" WHERE email=?`, p.email) as { id: string };
  const now = new Date().toISOString();
  await testRun("UPDATE provider_business SET status='approved', reviewed_at=?, updated_at=? WHERE user_id=?", now, now, u.id);
  await ctx.close();
}
async function signIn(page: Page, email: string, password: string) {
  await page.goto("/provider/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/sign-in/);
}
async function signInFarmer(page: Page) {
  await page.goto("/farmer/sign-in");
  await page.getByLabel("Email").fill(FARMER.email);
  await page.getByLabel("Password", { exact: true }).fill(FARMER.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/sign-in/);
}
/** Opens the request on the provider's Requests screen and fills the quote tab. */
async function quote(page: Page, reference: string, opts: { amount: string; includes: string; start: number; until: number }) {
  await page.goto("/provider/requests");
  await page.getByRole("button", { name: `Open request ${reference}` }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "My quote" }).click();
  await dialog.getByLabel("Total price (Le)").fill(opts.amount);
  await dialog.getByLabel("What the price covers").fill(opts.includes);
  await dialog.getByLabel("Can start on").fill(inDays(opts.start));
  await dialog.getByLabel("Price holds until").fill(inDays(opts.until));
  await dialog.getByRole("button", { name: /Send a quote|Replace quote/ }).click();
}

let reference = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  await makeProvider(browser, A);
  await makeProvider(browser, B);

  const f = await fresh(browser);
  await f.page.goto("/farmer/sign-up");
  await f.page.getByLabel("First and last name").fill(FARMER.name);
  await f.page.getByLabel("Your phone number").fill(FARMER.phone);
  await f.page.getByLabel("Email").fill(FARMER.email);
  await f.page.getByLabel("Password", { exact: true }).fill(FARMER.password);
  await f.page.getByRole("button", { name: "Create account" }).click();
  await enterCode(f.page, FARMER.email);

  await f.page.goto("/farmer/book");
  await f.page.getByLabel("What work do you need?").selectOption("ploughing");
  await f.page.getByLabel("Land size").fill("6");
  await f.page.getByLabel("Easy access").check();
  await f.page.getByLabel("Cleared").check();
  await f.page.getByRole("button", { name: "Continue" }).click();
  await f.page.getByLabel("District").selectOption("Bombali");
  await f.page.getByLabel("Village/town").fill("Mabanta Village");
  await f.page.getByLabel("Preferred start date").fill(inDays(40));
  await f.page.getByRole("button", { name: "Send request" }).click();
  reference = (await f.page.getByText(/Request SG-\d+ sent/).innerText()).match(/SG-\d+/)![0];
  await f.ctx.close();
});

test("a quote is validated, then sent, and the farmer is told", async ({ page }) => {
  await signIn(page, A.email, A.password);
  await page.goto("/provider/requests");
  await page.getByRole("button", { name: `Open request ${reference}` }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "My quote" }).click();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${SHOTS}/19-quote-form.png` });

  // Empty form: our own messages, not the browser's.
  await dialog.getByRole("button", { name: "Send a quote" }).click();
  await expect(dialog.getByText("Enter the total price")).toBeVisible();
  await expect(dialog.getByText("Say what the price covers")).toBeVisible();

  // A price that holds until after the start date makes no sense.
  await dialog.getByLabel("Total price (Le)").fill("1,500.00");
  await dialog.getByLabel("What the price covers").fill("Tractor, plough and operator");
  await dialog.getByLabel("Can start on").fill(inDays(20));
  await dialog.getByLabel("Price holds until").fill(inDays(30));
  await dialog.getByRole("button", { name: "Send a quote" }).click();
  await expect(dialog.getByText("must hold until the start date")).toBeVisible();

  await dialog.getByLabel("Price holds until").fill(inDays(14));
  await dialog.getByRole("button", { name: "Send a quote" }).click();
  await expect(dialog.getByText("Quote sent to the farmer.")).toBeVisible();

  // The email is sent after the quote is saved, so it has to be waited for rather than read
  // the instant the screen confirms: against a remote database the send is still in flight.
  await expect
    .poll(() => mailsTo(FARMER.email).filter((m) => m.subject.includes(`New quote for ${reference}`)).length, { timeout: 10_000 })
    .toBeGreaterThan(0);
  const mail = mailsTo(FARMER.email).find((m) => m.subject.includes(`New quote for ${reference}`))!;
  expect(mail).toBeTruthy();
  expect(mail.text).toContain("Le 1,500.00");
  expect(mail.text).toContain("not a booking");
});

test("replacing a quote makes a new version and keeps the old one", async ({ page }) => {
  await signIn(page, A.email, A.password);
  await quote(page, reference, { amount: "1,350.00", includes: "Tractor, plough and operator", start: 20, until: 14 });
  await expect(page.getByText("Quote updated (version 2).")).toBeVisible();
  const rows = await testAll(
    "SELECT version, amount_minor, status FROM quote WHERE request_id=(SELECT id FROM service_request WHERE reference=?) ORDER BY version", reference) as { version: number; amount_minor: number; status: string }[];
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ version: 1, amount_minor: 150000, status: "superseded" });
  expect(rows[1]).toMatchObject({ version: 2, amount_minor: 135000, status: "sent" });

  await page.goto("/provider/quotes");
  await expect(page.getByRole("heading", { name: "My quotes" })).toBeVisible();
  await expect(page.getByText("Le 1,350.00")).toBeVisible();
  await expect(page.getByText("Le 1,500.00")).toHaveCount(0); // superseded versions are not listed
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${SHOTS}/20-my-quotes.png` });
});

test("the farmer compares both quotes and accepts one", async ({ page, browser }) => {
  // The second provider quotes too.
  const b = await fresh(browser);
  await signIn(b.page, B.email, B.password);
  await quote(b.page, reference, { amount: "1,200.50", includes: "Tractor and operator, plough provided by farmer", start: 25, until: 20 });
  await expect(b.page.getByText("Quote sent to the farmer.")).toBeVisible();
  await b.ctx.close();

  await signInFarmer(page);
  await page.goto("/farmer/requests");
  await page.getByRole("link", { name: reference }).click();
  await expect(page.getByRole("heading", { name: "Request details" })).toBeVisible();
  await expect(page.getByText(reference)).toBeVisible();
  await expect(page.getByText("Le 1,200.50")).toBeVisible();
  await expect(page.getByText("Le 1,350.00")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${SHOTS}/21-farmer-quotes.png`, fullPage: true });

  // Accept the cheaper one.
  const cheaper = page.locator("article").filter({ hasText: "Le 1,200.50" });
  await cheaper.getByRole("button", { name: "Accept quote" }).click();
  await expect(page.getByRole("status").filter({ hasText: "The price and terms are now fixed" })).toBeVisible();

  // The other provider's quote is now closed, and no second accept is offered.
  await expect(page.getByText("You chose another provider.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Accept quote" })).toHaveCount(0);
});

test("the accepted version is frozen, and the provider cannot change it", async ({ page }) => {
  const ag = await testGet(
    "SELECT amount_minor, version FROM agreement WHERE request_id=(SELECT id FROM service_request WHERE reference=?)", reference) as { amount_minor: number; version: number };
  expect(ag).toMatchObject({ amount_minor: 120050, version: 1 });

  // The winning provider sees it as accepted and gets no form.
  await signIn(page, B.email, B.password);
  await page.goto("/provider/requests");
  await page.getByRole("button", { name: `Open request ${reference}` }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "My quote" }).click();
  await expect(dialog.getByText("The farmer accepted this exact version")).toBeVisible();
  await expect(dialog.getByLabel("Total price (Le)")).toHaveCount(0);

  // The provider was emailed.
  expect(mailsTo(B.email).some((m) => m.subject.includes("was accepted"))).toBe(true);
});

test("the losing provider cannot quote again on a decided request", async ({ page }) => {
  await signIn(page, A.email, A.password);
  await page.goto("/provider/requests");
  await page.getByRole("button", { name: `Open request ${reference}` }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "My quote" }).click();
  await expect(dialog.getByText("The farmer chose another provider.")).toBeVisible();
});

test("an expired quote cannot be accepted", async ({ page, browser }) => {
  // A second request, quoted and then aged past its validity in the database.
  const f = await fresh(browser);
  await signInFarmer(f.page);
  await f.page.goto("/farmer/book");
  await f.page.getByLabel("What work do you need?").selectOption("ploughing");
  await f.page.getByLabel("Land size").fill("2");
  await f.page.getByLabel("Easy access").check();
  await f.page.getByLabel("Cleared").check();
  await f.page.getByRole("button", { name: "Continue" }).click();
  await f.page.getByLabel("District").selectOption("Bombali");
  await f.page.getByLabel("Village/town").fill("Kagbo");
  await f.page.getByLabel("Preferred start date").fill(inDays(45));
  await f.page.getByRole("button", { name: "Send request" }).click();
  const ref2 = (await f.page.getByText(/Request SG-\d+ sent/).innerText()).match(/SG-\d+/)![0];
  await f.ctx.close();

  await signIn(page, A.email, A.password);
  await quote(page, ref2, { amount: "900.00", includes: "Tractor and operator", start: 30, until: 10 });
  await expect(page.getByText("Quote sent to the farmer.")).toBeVisible();
  await testRun(
    "UPDATE quote SET valid_until='2020-01-01' WHERE request_id=(SELECT id FROM service_request WHERE reference=?)", ref2);

  const f2 = await fresh(browser);
  await signInFarmer(f2.page);
  await f2.page.goto("/farmer/requests");
  await f2.page.getByRole("link", { name: ref2 }).click();
  await expect(f2.page.getByText("This price has expired")).toBeVisible();
  await expect(f2.page.getByRole("button", { name: "Accept quote" })).toHaveCount(0);
  await f2.ctx.close();
});

test("one farmer cannot open another farmer's request", async ({ page, browser }) => {
  const other = await fresh(browser);
  const email = `nosy.${run}@example.com`;
  await other.page.goto("/farmer/sign-up");
  await other.page.getByLabel("First and last name").fill("Nosy Neighbour");
  await other.page.getByLabel("Your phone number").fill("076 999 888");
  await other.page.getByLabel("Email").fill(email);
  await other.page.getByLabel("Password", { exact: true }).fill("nosy-pass-2026");
  await other.page.getByRole("button", { name: "Create account" }).click();
  await enterCode(other.page, email);
  const r = await testGet("SELECT id FROM service_request WHERE reference=?", reference) as { id: string };
  await other.page.goto(`/farmer/requests/${r.id}`);
  await expect(other.page.getByRole("heading", { name: "We can't find that page" })).toBeVisible();
  await other.ctx.close();
  await page.goto("/farmer/sign-in");
});
