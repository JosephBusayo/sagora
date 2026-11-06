import { expect, test, type Browser, type Page } from "@playwright/test";
import { confirmChecks } from "./checks";
import { testGet, testRun } from "./testdb";
import fs from "node:fs";
import path from "node:path";

const OUTBOX = path.join(process.cwd(), "data", "dev-outbox.jsonl");
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
  return { ctx, page: await confirmChecks(await ctx.newPage()) };
}
const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

type Booking = { service: string; acres: string; unit?: string; district: string; village: string; days: number; notes?: string };

/** Everything up to the summary, without sending it. */
async function fillBooking(page: Page, opts: Booking) {
  await page.goto("/farmer/book");
  await page.getByLabel("What work do you need?").selectOption(opts.service);
  await page.getByLabel("Land size").fill(opts.acres);
  if (opts.unit) await page.getByLabel("Unit").selectOption(opts.unit);
  await page.getByLabel("Easy access").check();
  await page.getByLabel("Cleared").check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("District").selectOption(opts.district);
  await page.getByLabel("Chiefdom").selectOption({ index: 1 });
  await page.getByLabel("Village/town").fill(opts.village);
  await page.getByLabel("Preferred start date").fill(inDays(opts.days));
  if (opts.notes) await page.getByLabel("Additional notes").fill(opts.notes);
  await page.getByRole("button", { name: "Continue" }).click();
}

async function book(page: Page, opts: Booking) {
  await fillBooking(page, opts);
  await page.getByRole("button", { name: "Send request" }).click();
}

test.beforeEach(async ({ page }) => { await confirmChecks(page); });

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
  const u = await testGet(`SELECT id FROM "user" WHERE email=?`, PROVIDER.email) as { id: string };
  const now = new Date().toISOString();
  await testRun("UPDATE provider_business SET status='approved', reviewed_at=?, updated_at=? WHERE user_id=?", now, now, u.id);
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

  // The first step will not go on without its answers.
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Choose the work you need")).toBeVisible();
  await expect(page.getByText("Choose the land access")).toBeVisible();
  await expect(page.getByText("Choose the land clearance")).toBeVisible();

  await page.getByLabel("What work do you need?").selectOption("ploughing");
  await page.getByLabel("Land size").fill("5");
  await page.getByLabel("Moderate access").check();
  await page.getByLabel("Flat").check();
  await page.getByLabel("Vegetation remains").check();
  await page.getByRole("button", { name: "Continue" }).click();

  // The second step: nothing chosen yet.
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Choose your district")).toBeVisible();

  // A date in the past is refused.
  await page.getByLabel("Preferred start date").fill(inDays(-5));
  await page.getByLabel("District").selectOption("Bombali");
  await page.getByLabel("Chiefdom").selectOption({ index: 1 });
  await page.getByLabel("Village/town").fill("Mabanta Village");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Choose a date in the future")).toBeVisible();

  // A latest start date before the preferred one is refused.
  await page.getByLabel("Preferred start date").fill(inDays(20));
  await page.getByLabel("Latest start date").fill(inDays(10));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("must be on or after the preferred start date")).toBeVisible();
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
  // Sent after the request is saved, so it is waited for: reading the outbox the moment the
  // screen confirms only works when the database is a local file.
  await expect
    .poll(() => mailsTo(FARMER.email).filter((m) => m.text.includes(reference)).length, { timeout: 10_000 })
    .toBeGreaterThan(0);
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
  await expect(dialog.getByText("Easy access")).toBeVisible();
  await expect(dialog.getByText("Cleared")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/18-request-detail.png` });

  // Activity starts with the farmer's own request.
  await dialog.getByRole("tab", { name: "Activity" }).click();
  await expect(dialog.getByText("The farmer sent this request")).toBeVisible();
  await dialog.getByRole("tab", { name: "Request details" }).click();

  // Quoting opens in the My quote tab.
  await dialog.getByRole("button", { name: "Send a quote" }).click();
  await expect(dialog.getByLabel("Total price (Le)")).toBeVisible();
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

test("sending the same request again after a dropped connection does not make a second one", async ({ page }) => {
  await signInFarmer(page);
  const same = { service: "ploughing", acres: "4", district: "Bombali", village: "Retry Village", days: 31 };
  await book(page, same);
  const first = (await page.getByText(/Request SG-\d+ sent/).innerText()).match(/SG-\d+/)![0];
  await book(page, same);
  const second = (await page.getByText(/Request SG-\d+ sent/).innerText()).match(/SG-\d+/)![0];
  expect(second).toBe(first);
  const rows = await testGet(`SELECT COUNT(*) AS n FROM service_request WHERE village='Retry Village'`) as { n: number | string };
  expect(Number(rows.n)).toBe(1);
});

test("the same form sent twice makes one request, even when the second copy differs", async ({ page }) => {
  await signInFarmer(page);
  await fillBooking(page, { service: "ploughing", acres: "3", district: "Bombali", village: "Keyed Village", days: 32 });
  const sent = page.waitForRequest((r) => r.method() === "POST" && !!r.headers()["next-action"]);
  await page.getByRole("button", { name: "Send request" }).click();
  const first = await sent;
  await expect(page).toHaveURL(/new=SG-/);

  // The same send again, as a retry would, but with another village: the form's key, not its
  // content, is what makes it the same request.
  const body = first.postDataBuffer()!.toString("latin1").replace("Keyed Village", "Keyed Hamlet");
  const headers = { ...first.headers() };
  delete headers["content-length"];
  const again = await page.request.post(first.url(), { headers, data: Buffer.from(body, "latin1"), maxRedirects: 0 });
  expect(again.status()).toBeLessThan(500);
  const n = await testGet(`SELECT COUNT(*) AS n FROM service_request WHERE village LIKE 'Keyed %'`) as { n: number | string };
  expect(Number(n.n)).toBe(1);
});

test("a farmer can give the land size in hectares, and both units are shown", async ({ page }) => {
  await signInFarmer(page);
  await fillBooking(page, { service: "ploughing", acres: "2", unit: "hectares", district: "Bombali", village: "Hectare Village", days: 34 });
  await expect(page.getByText("4.94 acres (2 ha)")).toBeVisible();
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page).toHaveURL(/new=SG-/);
  const row = await testGet(`SELECT acres FROM service_request WHERE village='Hectare Village'`) as { acres: number };
  expect(Number(row.acres)).toBeCloseTo(4.9421, 4);
  await expect(page.getByText("4.94 acres (2 ha)").first()).toBeVisible();
});

test("a farmer can withdraw a request, and it leaves the provider list", async ({ page, browser }) => {
  await signInFarmer(page);
  await book(page, { service: "ploughing", acres: "3", district: "Bombali", village: "Yengema", days: 30 });
  const reference = (await page.getByText(/Request SG-\d+ sent/).innerText()).match(/SG-\d+/)![0];

  const p = await fresh(browser);
  await signInProvider(p.page);
  await p.page.goto("/provider/requests?district=Bombali");
  await expect(p.page.getByRole("cell", { name: reference, exact: true })).toBeVisible();

  await page.goto("/farmer/requests");
  await page.getByRole("link", { name: reference }).click();
  await page.getByRole("button", { name: "Withdraw request" }).click();
  await page.getByRole("dialog", { name: "Confirm" }).getByRole("button", { name: "Withdraw request" }).click();
  await page.goto("/farmer/requests");
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

test("a farmer edits a request nobody has quoted, in the design's two steps", async ({ page }) => {
  await signInFarmer(page);
  await book(page, { service: "ploughing", acres: "7", district: "Kono", village: "Edit Village", days: 33 });
  await page.getByRole("link", { name: /^SG-/ }).first().click();
  await page.getByRole("link", { name: "Edit request" }).click();
  await expect(page.getByRole("heading", { name: "Edit details" })).toBeVisible();
  await expect(page.getByLabel("Land size")).toHaveValue("7");
  await page.getByLabel("Land size").fill("9");
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByLabel("Village/town")).toHaveValue("Edit Village");
  await expect(page.getByLabel("Chiefdom")).not.toHaveValue(""); // the saved chiefdom comes back
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { name: "Check your request" })).toBeVisible();
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("heading", { name: "Request details" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "Request details" }).getByText("9 acres")).toBeVisible();
});

test("a request reaches only the providers covering its district and service", async ({ page }) => {
  await testRun("UPDATE provider_business SET district='Kono', services=? WHERE email=?", JSON.stringify(["ploughing"]), PROVIDER.email);
  await signInProvider(page);
  await page.goto("/provider/requests?window=");
  await expect(page.getByRole("cell", { name: "Bombali District" })).toHaveCount(0);
  await testRun("UPDATE provider_business SET district='', services='[]' WHERE email=?", PROVIDER.email);
});

test("a bad link is not a dead end", async ({ browser }) => {
  const b = await fresh(browser);
  await b.page.goto("/this-page-does-not-exist");
  await expect(b.page.getByRole("heading", { name: "We can't find that page" })).toBeVisible();
  await b.ctx.close();
});

test("the farmer checks a summary before the request is sent, with chiefdom, Dry and planting", async ({ page }) => {
  await signInFarmer(page);
  await page.goto("/farmer/book");
  await page.getByLabel("What work do you need?").selectOption("planting");
  // Planting asks for the crop, as harvesting does.
  await expect(page.getByLabel("Crop")).toBeVisible();
  await page.getByLabel("Crop").fill("Rice");
  await page.getByLabel("Land size").fill("6");
  await page.getByLabel("Easy access").check();
  await page.getByLabel("Dry").check();
  await page.getByLabel("Cleared").check();
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByLabel("District").selectOption("Pujehun");
  // The chiefdoms are the district's own.
  await expect(page.getByLabel("Chiefdom").locator("option", { hasText: "Kpaka" })).toHaveCount(1);
  await expect(page.getByLabel("Chiefdom").locator("option", { hasText: "Makari" })).toHaveCount(0);
  await page.getByLabel("Village/town").fill("Summary Village");
  await page.getByLabel("Preferred start date").fill(inDays(25));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Choose your chiefdom")).toBeVisible();
  await page.getByLabel("Chiefdom").selectOption("Kpaka");
  await page.getByRole("button", { name: "Continue" }).click();

  // Nothing is saved yet: the summary shows what will be sent.
  await expect(page.getByRole("heading", { name: "Check your request" })).toBeVisible();
  const summary = page.locator(".book__summary");
  await expect(summary).toContainText("Planting");
  await expect(summary).toContainText("Rice");
  await expect(summary).toContainText("Dry");
  await expect(summary).toContainText("Kpaka");
  let rows = await testGet(`SELECT COUNT(*) AS n FROM service_request WHERE village='Summary Village'`) as { n: number | string };
  expect(Number(rows.n)).toBe(0);

  // Edit details goes back with every answer kept.
  await page.getByRole("button", { name: "Edit details" }).click();
  await expect(page.getByLabel("Crop")).toHaveValue("Rice");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("Chiefdom")).toHaveValue("Kpaka");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page).toHaveURL(/\/farmer\/requests\?new=SG-/);

  rows = await testGet(`SELECT service, crop, land_condition, chiefdom FROM service_request WHERE village='Summary Village'`) as never;
  expect(rows).toMatchObject({ service: "planting", crop: "Rice", land_condition: "dry", chiefdom: "Kpaka" });
});

test("a request opens as a window over My requests, and closing it goes back to the list", async ({ page }) => {
  await signInFarmer(page);
  await page.goto("/farmer/requests");
  await page.locator(".table--requests").getByRole("link", { name: /^SG-/ }).first().click();
  const window = page.getByRole("dialog", { name: "Request details" });
  await expect(window).toBeVisible();
  await expect(window).toContainText("Pujehun");
  // The list stays behind it.
  await expect(page.getByRole("heading", { name: "My requests" })).toBeAttached();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL(/\/farmer\/requests$/);
  await expect(window).toHaveCount(0);
});

test("a form reads the answers back, and nothing is sent until they are confirmed", async ({ browser }) => {
  // A page of its own: the others confirm the window automatically.
  const ctx = await browser.newContext({ viewport: { width: 1728, height: 1117 } });
  const page = await ctx.newPage();
  await signInFarmer(page);
  await page.goto("/farmer/settings/account");
  const name = page.getByLabel("First and last name");
  const before = await name.inputValue();
  await name.fill("Checked Name");
  await page.getByRole("button", { name: "Save changes" }).click();

  const check = page.locator("dialog.check-first[open]");
  await expect(check.getByRole("heading", { name: "Check before sending" })).toBeVisible();
  await expect(check).toContainText("Checked Name");
  // Edit closes the window and sends nothing.
  await check.getByRole("button", { name: "Edit" }).click();
  await expect(check).toHaveCount(0);
  await page.reload();
  await expect(name).toHaveValue(before);

  await name.fill("Checked Name");
  await page.getByRole("button", { name: "Save changes" }).click();
  await check.getByRole("button", { name: "Confirm and send" }).click();
  await expect(page.getByRole("status").or(page.locator(".notice--success")).first()).toBeVisible();
  await page.reload();
  await expect(name).toHaveValue("Checked Name");
  await name.fill(before);
  await page.getByRole("button", { name: "Save changes" }).click();
  await check.getByRole("button", { name: "Confirm and send" }).click();
  await expect(check).toHaveCount(0);
  await ctx.close();
});
