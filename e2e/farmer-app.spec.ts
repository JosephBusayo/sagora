import { expect, test, type Browser, type Page } from "@playwright/test";
import { testGet, testRun } from "./testdb";
import fs from "node:fs";
import path from "node:path";

const OUTBOX = path.join(process.cwd(), "data", "dev-outbox.jsonl");
const SHOTS = path.join(process.cwd(), "e2e", "screens");
fs.mkdirSync(SHOTS, { recursive: true });

const run = Date.now();
const FARMER = { name: "Mariama Bangura", phone: "076 121 232", email: `app.farmer.${run}@example.com`, pass: "app-farmer-26" };
const PROV = { business: "Bangura Tractors", phone: "077 343 454", email: `app.prov.${run}@example.com`, pass: "app-prov-26" };

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

async function signIn(page: Page, who: { email: string; pass: string }, area: "provider" | "farmer") {
  await page.goto(`/${area}/sign-in`);
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password", { exact: true }).fill(who.pass);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/sign-in/);
}

let reference = "";

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000);

  const f = await fresh(browser);
  await f.page.goto("/farmer/sign-up");
  await f.page.getByLabel("First and last name").fill(FARMER.name);
  await f.page.getByLabel("Your phone number").fill(FARMER.phone);
  await f.page.getByLabel("Email").fill(FARMER.email);
  await f.page.getByLabel("Password", { exact: true }).fill(FARMER.pass);
  await f.page.getByRole("button", { name: "Create account" }).click();
  await enterCode(f.page, FARMER.email);
  await f.ctx.close();

  const p = await fresh(browser);
  await p.page.goto("/provider/sign-up");
  await p.page.getByLabel("Business name").fill(PROV.business);
  await p.page.getByLabel("Your phone number").fill(PROV.phone);
  await p.page.getByLabel("Email").fill(PROV.email);
  await p.page.getByLabel("Password", { exact: true }).fill(PROV.pass);
  await p.page.getByRole("button", { name: "Create account" }).click();
  await enterCode(p.page, PROV.email);
  await p.page.getByLabel("District").selectOption("Kenema");
  await p.page.getByLabel("Ploughing").check();
  await p.page.getByLabel("Town or village").fill("Kenema Town");
  await p.page.getByRole("button", { name: "Submit for review" }).click();
  const u = await testGet(`SELECT id FROM "user" WHERE email=?`, PROV.email) as { id: string };
  const now = new Date().toISOString();
  await testRun("UPDATE provider_business SET status='approved', reviewed_at=?, updated_at=? WHERE user_id=?", now, now, u.id);
  await p.ctx.close();
});

test("the farmer app lands on home with the designed sidebar", async ({ page }) => {
  await signIn(page, FARMER, "farmer");
  await expect(page).toHaveURL(/\/farmer\/home$/);

  const nav = page.getByRole("navigation", { name: "Main" });
  for (const label of ["Home", "Book a service", "My requests", "My bookings", "Payments", "Notifications"]) {
    await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
  // The provider's screens are not offered to a farmer.
  await expect(nav.getByRole("link", { name: "Equipment" })).toHaveCount(0);
  await expect(nav.getByRole("link", { name: "Team" })).toHaveCount(0);

  // The design greets by time of day above a dated line, so the heading is one of three.
  await expect(
    page.getByRole("heading", { name: new RegExp(`Good (morning|afternoon|evening), ${FARMER.name.split(" ")[0]}`) }),
  ).toBeVisible();
  await expect(page.getByText("How it works")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${SHOTS}/33-farmer-home.png`, fullPage: true });
});

test("the home screen says what the design says", async ({ page }) => {
  // This screen was once rewritten in our own words, which read fine and was not the product
  // the designer drew. These are the designer's strings, from the Figma frame, so a rewrite
  // has to be a deliberate decision rather than something nobody notices.
  await signIn(page, FARMER, "farmer");

  for (const line of [
    "Get farm work done with trusted service providers in your area",
    "Book ploughing service",
    "Prepare your land for planting",
    "Book harvesting service",
    "Harvest your crops efficiently",
    "Tell us what you need",
    "Choose service, farm size, location and preferred date",
    "Receive quotes",
    "Verified service providers in your area will send quotes",
    "Choose a provider",
    "Compare quotes and get work done",
    "Your recent requests",
  ]) {
    await expect(page.getByText(line, { exact: true }).first()).toBeVisible();
  }

  // Today's date, spelled out above the greeting.
  const today = new Date().toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Africa/Freetown",
  });
  await expect(page.getByText(today, { exact: true })).toBeVisible();

  // "How it works" comes before the requests table, as the design orders them: someone who has
  // never used this needs the explanation first, and their table is empty anyway.
  const order = await page.evaluate(() => {
    const text = document.body.innerText;
    return { how: text.indexOf("How it works"), recent: text.indexOf("Your recent requests") };
  });
  expect(order.how).toBeGreaterThan(-1);
  expect(order.how).toBeLessThan(order.recent);

  // The sidebar's Personal group, in full.
  const nav = page.getByRole("navigation", { name: "Main" });
  for (const label of ["General settings", "Help & support", "Account"]) {
    await expect(nav.getByRole("link", { name: label, exact: true })).toBeVisible();
  }
});

test("the home tiles pre-choose the service on the booking form", async ({ page }) => {
  await signIn(page, FARMER, "farmer");
  await page.getByRole("link", { name: /Book harvesting/ }).click();
  await expect(page).toHaveURL(/service=harvesting/);
  await expect(page.getByRole("heading", { name: "Harvesting service" })).toBeVisible();
  await expect(page.getByLabel("What work do you need?")).toHaveCount(0);

  // And the plain link does not pre-choose anything.
  await page.goto("/farmer/book");
  await expect(page.getByLabel("What work do you need?")).toHaveValue("");
});

test("a farmer books work and the provider quotes it", async ({ page, browser }) => {
  await signIn(page, FARMER, "farmer");
  await page.goto("/farmer/book");
  await page.getByLabel("What work do you need?").selectOption("ploughing");
  await page.getByLabel("Land size").fill("5");
  await page.getByLabel("Easy access").check();
  await page.getByLabel("Cleared").check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("District").selectOption("Kenema");
  await page.getByLabel("Village/town").fill("Dama Village");
  await page.getByLabel("Preferred start date").fill(inDays(25));
  await page.getByRole("button", { name: "Send request" }).click();
  reference = (await page.getByText(/Request SG-\d+ sent/).innerText()).match(/SG-\d+/)![0];

  const p = await fresh(browser);
  await signIn(p.page, PROV, "provider");
  await p.page.goto("/provider/requests");
  await p.page.getByRole("button", { name: `Open request ${reference}` }).click();
  const d = p.page.getByRole("dialog");
  await d.getByRole("tab", { name: "My quote" }).click();
  await d.getByLabel("Total price (Le)").fill("1,200.00");
  await d.getByLabel("What the price covers").fill("Tractor, plough and operator");
  await d.getByLabel("Can start on").fill(inDays(20));
  await d.getByLabel("Price holds until").fill(inDays(15));
  await d.getByRole("button", { name: "Send a quote" }).click();
  await expect(d.getByText("Quote sent to the farmer.")).toBeVisible();
  await p.ctx.close();
});

test("notifications list the real events, newest first", async ({ page }) => {
  await signIn(page, FARMER, "farmer");
  await page.goto("/farmer/notifications");
  await expect(page.getByRole("heading", { name: "Notifications" })).toBeVisible();

  const items = page.locator("li.notif");
  await expect(items.first()).toContainText("New quote");
  await expect(items.nth(1)).toContainText("Request sent");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${SHOTS}/34-farmer-notifications.png`, fullPage: true });
});

test("a one-time code never appears in the notification list", async ({ page }) => {
  await signIn(page, FARMER, "farmer");
  await page.goto("/farmer/notifications");
  const text = await page.locator("main").innerText();
  expect(text).not.toMatch(/code is \d{7}/);
  expect(text.toLowerCase()).not.toContain("verification");
});

test("one farmer never sees another person's notifications", async ({ page, browser }) => {
  // The provider's own feed has their events, not the farmer's, and nothing crosses over.
  const p = await fresh(browser);
  await signIn(p.page, PROV, "provider");
  await p.page.goto("/provider/notifications");
  const providerText = await p.page.locator("main").innerText();
  expect(providerText).not.toContain("Your Sagora request");
  await p.ctx.close();

  await signIn(page, FARMER, "farmer");
  await page.goto("/farmer/notifications");
  const farmerText = await page.locator("main").innerText();
  expect(farmerText).not.toContain("has quoted for your ploughing request SG-0000");
  expect(farmerText).toContain(reference);
});

test("marking as read empties the unread filter and clears the bell", async ({ page }) => {
  await signIn(page, FARMER, "farmer");
  await page.goto("/farmer/notifications?filter=unread");
  await expect(page.locator("li.notif")).not.toHaveCount(0);

  await page.getByRole("button", { name: "Mark all as read" }).click();
  await expect(page).toHaveURL(/filter=unread/);
  await expect(page.getByText("Nothing unread. You are up to date.")).toBeVisible();

  // The bell is counted from the same place, so it goes quiet too.
  await page.goto("/farmer/home");
  await expect(page.getByRole("link", { name: /Notifications, \d+ unread/ })).toHaveCount(0);
});

test("accepting a quote puts the job under bookings, in the right tab", async ({ page }) => {
  await signIn(page, FARMER, "farmer");
  await page.goto("/farmer/requests");
  await page.getByRole("link", { name: reference }).click();
  await page.getByRole("button", { name: "Accept quote" }).click();
  await expect(page.getByRole("status").filter({ hasText: "now fixed" })).toBeVisible();

  await page.goto("/farmer/bookings");
  await expect(page.getByRole("heading", { name: "Bookings", exact: true })).toBeVisible();
  const card = page.locator("article.asset").filter({ hasText: reference });
  await expect(card).toBeVisible();
  await expect(card.getByText("Not scheduled yet")).toBeVisible();
  await expect(card.getByText("Not paid")).toBeVisible();
  await expect(card.getByText(PROV.business)).toBeVisible();

  // The other tabs are genuinely empty, not showing the same job four times.
  await page.goto("/farmer/bookings?tab=completed");
  await expect(page.getByText("Nothing finished yet", { exact: true })).toBeVisible();
  await page.goto("/farmer/bookings?tab=cancelled");
  await expect(page.getByText("Nothing cancelled", { exact: true })).toBeVisible();
  await page.goto("/farmer/bookings?tab=in_progress");
  await expect(page.getByText("No work under way", { exact: true })).toBeVisible();

  await page.goto("/farmer/bookings");
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${SHOTS}/35-farmer-bookings.png`, fullPage: true });
});

test("a farmer can change their own details but not their sign-in email", async ({ page }) => {
  await signIn(page, FARMER, "farmer");
  await page.goto("/farmer/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

  await page.locator("a.settings-row").filter({ hasText: "Account" }).click();
  await expect(page).toHaveURL(/\/farmer\/settings\/account$/);
  await expect(page.getByLabel("Email address")).toHaveAttribute("readonly", "");

  await page.getByLabel("First and last name").fill("Mariama B Bangura");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toContainText("saved");

  // The new name shows in the top bar, which reads it from the session. The design shows the
  // first name and the last initial there, so the full name lives in the title attribute.
  await page.goto("/farmer/home");
  await expect(page.getByText("Mariama B", { exact: true })).toBeVisible();
  await expect(page.getByTitle("Mariama B Bangura")).toBeVisible();
});

test("a farmer cannot reach the provider's screens through the farmer app", async ({ page }) => {
  await signIn(page, FARMER, "farmer");
  for (const url of ["/provider/dashboard", "/provider/equipment", "/provider/payments"]) {
    await page.goto(url);
    await expect(page).toHaveURL(/\/farmer\/home$/);
  }
});

test("the provider dashboard counts the real work waiting", async ({ page }) => {
  await signIn(page, PROV, "provider");
  await page.goto("/provider/dashboard");
  // The design greets by name and time of day here too, with the business named in the sidebar
  // rather than as the page title.
  await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening),/ })).toBeVisible();
  await expect(page.getByText("Here\u2019s what\u2019s happening with your business today")).toBeVisible();

  // The accepted quote became an unscheduled job: that is one job needing the provider.
  const jobs = page.locator("a.money-tile").filter({ hasText: "Jobs needing you" });
  await expect(jobs).toContainText("1");
  await expect(page.getByText("Needs attention")).toBeVisible();
  await expect(page.locator("section.panel").filter({ hasText: "Work to do" })).toContainText(reference);

  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${SHOTS}/36-provider-dashboard.png`, fullPage: true });
});
