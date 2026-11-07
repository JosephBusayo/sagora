import { expect, test, type Browser, type Page } from "@playwright/test";
import { completeApplication, confirmChecks } from "./checks";
import { testGet, testRun } from "./testdb";
import fs from "node:fs";
import path from "node:path";

/**
 * Karim's use cases built in this round: the WhatsApp contact, harvest details the farmer does not
 * know (UC06), inspections before a quote (UC08), repeat callers (UC07), and the coordinator's
 * follow-ups and report (UC14).
 */

const OUTBOX = path.join(process.cwd(), "data", "dev-outbox.jsonl");
const run = Date.now();
const FARMER = { name: "Isatu Conteh", phone: "076 515 616", email: `isatu.${run}@example.com`, password: "harvest-time-26" };
const PROVIDER = { business: "Tonkolili Harvesters", phone: "077 515 616", email: `tonko.${run}@example.com`, password: "combine-26" };
const STAFF = { business: "UC Coordinator", phone: "078 515 616", email: `uc.staff.${run}@example.com`, password: "follow-up-26" };

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
  const ctx = await browser.newContext({ viewport: { width: 1728, height: 1117 } });
  return { ctx, page: await confirmChecks(await ctx.newPage()) };
}
async function signUp(page: Page, who: typeof PROVIDER, door: "provider" | "farmer") {
  await page.goto(`/${door}/sign-up`);
  await page.getByLabel(door === "farmer" ? "First and last name" : "Business name").fill(door === "farmer" ? FARMER.name : who.business);
  await page.getByLabel("Your phone number").fill(who.phone);
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password", { exact: true }).fill(who.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await enterCode(page, who.email);
}
async function signIn(page: Page, who: { email: string; password: string }, door: "provider" | "farmer") {
  await page.goto(`/${door}/sign-in`);
  await page.getByLabel("Email").fill(who.email);
  await page.getByLabel("Password", { exact: true }).fill(who.password);
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
const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

let reference = "";

test.beforeEach(async ({ page }) => { await confirmChecks(page); });
test.describe.configure({ mode: "serial", timeout: 120_000 });

test.beforeAll(async ({ browser }) => {
  const f = await fresh(browser);
  await signUp(f.page, { ...FARMER, business: "" }, "farmer");
  await f.ctx.close();

  const p = await fresh(browser);
  await signUp(p.page, PROVIDER, "provider");
  await p.page.getByLabel("District").selectOption("Tonkolili");
  await p.page.getByLabel("Harvesting").check();
  await p.page.getByLabel("Town or village").fill("Magburaka");
  await completeApplication(p.page);
  await p.page.getByRole("button", { name: "Submit for review" }).click();
  await expect(p.page.getByText("Waiting for Sagora to review your business")).toBeVisible();
  const u = await testGet(`SELECT id FROM "user" WHERE email=?`, PROVIDER.email) as { id: string };
  const now = new Date().toISOString();
  await testRun("UPDATE provider_business SET status='approved', reviewed_at=?, updated_at=? WHERE user_id=?", now, now, u.id);
  await p.ctx.close();

  const s = await fresh(browser);
  await signUp(s.page, STAFF, "provider");
  await s.ctx.close();
  await testRun(`UPDATE "user" SET role='admin' WHERE email=?`, STAFF.email);
});

test("farmers see a WhatsApp button before they sign in", async ({ page }) => {
  for (const at of ["/", "/farmer/sign-in", "/farmer/sign-up"]) {
    await page.goto(at);
    const link = page.getByRole("link", { name: "Speak to us on WhatsApp" });
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", /^https:\/\/wa\.me\/23200000000\?text=/);
  }
});

test("a harvest request with details the farmer does not know reaches the provider flagged", async ({ page, browser }) => {
  await signIn(page, FARMER, "farmer");
  await page.goto("/farmer/book");
  await page.getByLabel("What work do you need?").selectOption("harvesting");
  // The harvest questions appear as soon as the work is picked.
  await expect(page.getByText("Is the crop ready to harvest?")).toBeVisible();
  await page.getByLabel("Land size").fill("5");
  await page.getByLabel("Unit").selectOption("hectares");
  await page.getByLabel("Crop", { exact: true }).fill("Rice");
  await page.getByLabel("Easy access").check();
  await page.getByLabel("Cleared").check();
  await page.getByLabel("Lowland").check();
  // Readiness is required for harvesting: Not sure is an answer, an empty one is not.
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Say how ready the crop is, or choose Not sure")).toBeVisible();
  await page.getByRole("group", { name: "Is the crop ready to harvest?" }).getByLabel("Not sure").check();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("District").selectOption("Tonkolili");
  await page.getByLabel("Chiefdom").selectOption({ index: 1 });
  await page.getByLabel("Village/town").fill("Mabonto");
  await page.getByLabel("Preferred start date").fill(inDays(12));
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByText("Upland or lowland")).toBeVisible();
  await expect(page.getByText("Lowland", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Send request" }).click();
  await page.waitForURL(/new=SG-/);
  reference = new URL(page.url()).searchParams.get("new")!;

  const p = await fresh(browser);
  await signIn(p.page, PROVIDER, "provider");
  await p.page.goto(`/provider/requests?open=${reference}`);
  const dialog = p.page.getByRole("dialog");
  if (!(await dialog.count())) await p.page.getByRole("button", { name: `Open request ${reference}` }).click();
  await expect(dialog.getByText("Ask the farmer before pricing:")).toBeVisible();
  await expect(dialog.getByText(/Variety, Planting date, Crop readiness/)).toBeVisible();
  await p.ctx.close();
});

test("a provider who needs to see the farm cannot quote until the inspection is recorded", async ({ page }) => {
  await signIn(page, PROVIDER, "provider");
  await page.goto(`/provider/requests?open=${reference}`);
  const dialog = page.getByRole("dialog");
  if (!(await dialog.count())) await page.getByRole("button", { name: `Open request ${reference}` }).click();
  await dialog.getByRole("button", { name: "Send a quote" }).click();
  await dialog.getByText("Farm inspection").click();
  await dialog.getByLabel("Do you need to see the farm before pricing?").selectOption("required");
  await dialog.getByRole("button", { name: "Save inspection" }).click();
  await expect(page.getByText("Inspection saved.").first()).toBeVisible();

  await dialog.getByLabel("Total price (Le)").fill("9,000.00");
  await dialog.getByLabel("What the price covers").fill("Harvester, operator and fuel");
  await dialog.getByLabel("Can start on").fill(inDays(12));
  await dialog.getByLabel("Price holds until").fill(inDays(10));
  await dialog.getByRole("button", { name: "Send a quote" }).click();
  await expect(dialog.getByText(/needs an inspection\. Book it and record what you find/)).toBeVisible();

  await dialog.getByLabel("Do you need to see the farm before pricing?").selectOption("completed");
  await dialog.getByLabel("Inspected on").fill(inDays(0));
  await dialog.getByLabel("What you found").fill("Water ankle deep at the south end; rice ready in 10 days");
  await dialog.getByRole("button", { name: "Save inspection" }).click();
  await expect(page.getByText("Inspection saved.").first()).toBeVisible();
  await dialog.getByRole("button", { name: "Send a quote" }).click();
  await expect(page.getByText("Quote sent to the farmer.")).toBeVisible();

  // The farmer sees what the inspection found, on the request itself.
  const row = await testGet("SELECT id FROM service_request WHERE reference=?", reference) as { id: string };
  const f = await page.context().browser()!.newContext();
  const fp = await confirmChecks(await f.newPage());
  await signIn(fp, FARMER, "farmer");
  await fp.goto(`/farmer/requests/${row.id}`);
  await expect(fp.getByText(/Done: Water ankle deep/)).toBeVisible();
  await f.close();
});

test("a second call from the same number joins the first request unless it is a different job", async ({ page }) => {
  await signInStaff(page);
  const phoneRequest = async () => {
    await page.goto("/staff/requests");
    await page.getByLabel("Who called").fill("Musa Kamara");
    await page.getByLabel("Number to call back").fill("076 999 111");
    await page.getByLabel("Who they are to the farmer").fill("The farmer");
    await page.getByLabel("Farmer's name").fill("Musa Kamara");
    await page.getByLabel("Who may accept a quote").fill("Musa Kamara");
    await page.getByLabel("Service").selectOption("harvesting");
    await page.getByLabel("Crop (for harvesting or planting)").fill("Rice");
    await page.getByLabel("Land size").fill("3");
    await page.getByLabel("Land access").selectOption("easy");
    await page.getByLabel("Land clearance").selectOption("cleared");
    await page.getByLabel("District").selectOption("Tonkolili");
    await page.getByLabel("Chiefdom").selectOption({ index: 1 });
    await page.getByLabel("Village/town").fill("Yele");
    await page.getByLabel("Preferred start date").fill(inDays(15));
  };
  await phoneRequest();
  await page.getByRole("button", { name: "Create request" }).click();
  await page.waitForURL(/\/staff\/requests\/[0-9a-f-]{36}$/);

  await phoneRequest();
  await page.getByRole("button", { name: "Create request" }).click();
  await expect(page.getByText(/This number already has an open request: SG-\d+/)).toBeVisible();

  // Searching by the number finds it, whatever shape it was typed in.
  await page.goto("/staff/requests?phone=%2B23276999111");
  await expect(page.getByRole("list", { name: "Open requests from this number" }).getByText(/SG-\d+/)).toHaveCount(1);

  await phoneRequest();
  await page.getByRole("button", { name: "Create request" }).click();
  await expect(page.getByText(/already has an open request/)).toBeVisible();
  await page.getByLabel("This is a different job").check();
  await page.getByRole("button", { name: "Create request" }).click();
  await page.waitForURL(/\/staff\/requests\/[0-9a-f-]{36}$/);
});

test("coordinators see what is waiting, give it an owner and a due date, and see the results apart", async ({ page }) => {
  await signInStaff(page);
  await page.goto("/staff/follow-ups");
  const missing = page.locator("#q-missing");
  await expect(missing.getByText(reference)).toBeVisible();
  const item = missing.locator(".queue__item").filter({ hasText: reference });
  await item.getByText("Add follow-up").click();
  await item.getByLabel("Next action").fill("Call the farmer about the variety");
  await item.getByLabel("Due").fill(inDays(1));
  await item.getByRole("button", { name: "Save follow-up" }).click();
  await expect(page.locator("#q-missing .queue__item").filter({ hasText: reference }).getByText(/Next: Call the farmer about the variety · Due/)).toBeVisible();

  await page.goto("/staff/report");
  await expect(page.getByRole("heading", { name: "Sagora report" })).toBeVisible();
  await expect(page.getByText("Sagora fees collected")).toBeVisible();
  await expect(page.getByText("Started, not finished")).toBeVisible();
  // Leaving the farmer out as a test account takes their requests out of the count.
  await page.getByLabel("Test emails, separated by commas").fill(FARMER.email);
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText(/^1 request is left out/)).toBeVisible();
  await page.getByLabel("Test emails, separated by commas").fill("");
  await page.getByRole("button", { name: "Save" }).click();
});
