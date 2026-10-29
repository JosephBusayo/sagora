import { expect, test, type Browser, type Page } from "@playwright/test";
import { testAll, testGet, testRun } from "./testdb";
import fs from "node:fs";
import path from "node:path";

const OUTBOX = path.join(process.cwd(), "data", "dev-outbox.jsonl");
const SHOTS = path.join(process.cwd(), "e2e", "screens");
fs.mkdirSync(SHOTS, { recursive: true });

const run = Date.now();
const P = { business: "Kamara Machinery", phone: "077 606 707", email: `machinery.${run}@example.com`, password: "equipment-2026" };
const MATE = { name: "Watcher Only", phone: "077 808 909", email: `watcher.${run}@example.com`, password: "view-only-2026" };

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
async function signIn(page: Page, email: string, password: string) {
  await page.goto("/provider/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/sign-in/);
}
async function addMachine(page: Page, opts: { kind: string; name: string; identifier?: string; notes?: string }) {
  await page.getByRole("button", { name: "Add equipment" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("What is it?").selectOption(opts.kind);
  await d.getByLabel("Name", { exact: true }).fill(opts.name);
  if (opts.identifier) await d.getByLabel("Registration or serial number").fill(opts.identifier);
  if (opts.notes) await d.getByLabel("Condition and notes").fill(opts.notes);
  await d.getByRole("button", { name: "Add machine" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0, { timeout: 6000 });
}
const card = (page: Page, name: string) => page.locator("article.asset").filter({ hasText: name });

test.describe.configure({ mode: "serial" });

test.beforeAll(async ({ browser }) => {
  const { ctx, page } = await fresh(browser);
  await page.goto("/provider/sign-up");
  await page.getByLabel("Business name").fill(P.business);
  await page.getByLabel("Your phone number").fill(P.phone);
  await page.getByLabel("Email").fill(P.email);
  await page.getByLabel("Password", { exact: true }).fill(P.password);
  await page.getByRole("button", { name: "Create account" }).click();
  await enterCode(page, P.email);
  await page.getByLabel("District").selectOption("Bombali");
  await page.getByLabel("Ploughing").check();
  await page.getByLabel("Town or village").fill("Makeni");
  await page.getByRole("button", { name: "Submit for review" }).click();
  const u = await testGet(`SELECT id FROM "user" WHERE email=?`, P.email) as { id: string };
  const now = new Date().toISOString();
  await testRun("UPDATE provider_business SET status='approved', reviewed_at=?, updated_at=? WHERE user_id=?", now, now, u.id);
  await ctx.close();
});

test("a machine is validated, then added", async ({ page }) => {
  await signIn(page, P.email, P.password);
  await page.goto("/provider/equipment");
  await expect(page.getByRole("heading", { name: "Equipment" })).toBeVisible();
  await expect(page.getByText("No machines on your register yet.")).toBeVisible();

  await page.getByRole("button", { name: "Add equipment" }).click();
  const d = page.getByRole("dialog");
  await d.getByRole("button", { name: "Add machine" }).click();
  await expect(d.getByText("Choose what kind of machine this is")).toBeVisible();
  await expect(d.getByText("Give this machine a name")).toBeVisible();

  await d.getByLabel("What is it?").selectOption("tractor");
  await d.getByLabel("Name", { exact: true }).fill("Massey Ferguson 375");
  await d.getByLabel("Registration or serial number").fill("AAA-111");
  await d.getByLabel("Condition and notes").fill("New clutch fitted in June.");
  await d.getByRole("button", { name: "Add machine" }).click();
  await expect(page.getByText("Massey Ferguson 375 added to your equipment.")).toBeVisible();

  await page.reload();
  await expect(card(page, "Massey Ferguson 375").getByText("Available")).toBeVisible();
  await expect(page.getByText("AAA-111")).toBeVisible();
});

test("two identical machines stay distinct", async ({ page }) => {
  await signIn(page, P.email, P.password);
  await page.goto("/provider/equipment");
  // The same name again: this is a second physical machine, not a duplicate to merge.
  await addMachine(page, { kind: "tractor", name: "Massey Ferguson 375", identifier: "BBB-222" });
  await page.reload();
  await expect(card(page, "Massey Ferguson 375")).toHaveCount(2);
  await expect(page.getByText("AAA-111")).toBeVisible();
  await expect(page.getByText("BBB-222")).toBeVisible();
  const rows = await testAll(
    "SELECT identifier FROM equipment WHERE name='Massey Ferguson 375' ORDER BY identifier",
  ) as { identifier: string }[];
  expect(rows.map((r) => r.identifier)).toEqual(["AAA-111", "BBB-222"]);
});

test("a blocking fault takes a machine out of service; a minor one does not", async ({ page }) => {
  await signIn(page, P.email, P.password);
  await page.goto("/provider/equipment");
  await addMachine(page, { kind: "plough", name: "Three furrow plough" });
  await page.reload();

  // Blocking fault on the plough.
  const plough = card(page, "Three furrow plough");
  await plough.getByRole("button", { name: /Actions for Three furrow plough/ }).click();
  await plough.getByRole("menuitem", { name: "Report a fault" }).click();
  let d = page.getByRole("dialog");
  await d.getByLabel("What is wrong?").fill("Hydraulic leak on the left arm");
  await d.getByRole("button", { name: "Record fault" }).click();
  await expect(d.getByText("now out of service")).toBeVisible();
  await page.reload();
  await expect(card(page, "Three furrow plough").getByText("Out of service")).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${SHOTS}/22-equipment.png`, fullPage: true });

  // Minor fault on a tractor: still available.
  await addMachine(page, { kind: "harvester", name: "Rice harvester" });
  await page.reload();
  const harvester = card(page, "Rice harvester");
  await harvester.getByRole("button", { name: /Actions for Rice harvester/ }).click();
  await harvester.getByRole("menuitem", { name: "Report a fault" }).click();
  d = page.getByRole("dialog");
  await d.getByRole("radio", { name: "Still usable" }).check();
  await d.getByLabel("What is wrong?").fill("Cracked mirror");
  await d.getByRole("button", { name: "Record fault" }).click();
  await expect(d.getByText("can still be used")).toBeVisible();
  await page.reload();
  const h = card(page, "Rice harvester");
  await expect(h.getByText("Available")).toBeVisible();
  await expect(h.getByText("Needs attention")).toBeVisible();
});

test("fixing a fault returns the machine to service and keeps the record", async ({ page }) => {
  await signIn(page, P.email, P.password);
  await page.goto("/provider/equipment");
  const plough = card(page, "Three furrow plough");
  await expect(plough.getByText("Out of service")).toBeVisible();
  await plough.getByRole("button", { name: "Mark fixed" }).click();
  await page.reload();
  await expect(card(page, "Three furrow plough").getByText("Available")).toBeVisible();

  // The fault is resolved, not deleted: the machine's history survives.
  const rows = await testAll(
    `SELECT f.description, f.resolved_at FROM equipment_fault f JOIN equipment e ON e.id=f.equipment_id
     WHERE e.name='Three furrow plough'`,
  ) as { description: string; resolved_at: string | null }[];
  expect(rows).toHaveLength(1);
  expect(rows[0].description).toContain("Hydraulic leak");
  expect(rows[0].resolved_at).not.toBeNull();
});

test("a retired machine stays readable but cannot be chosen", async ({ page }) => {
  await signIn(page, P.email, P.password);
  await page.goto("/provider/equipment");
  const harvester = card(page, "Rice harvester");
  await harvester.getByRole("button", { name: /Actions for Rice harvester/ }).click();
  await harvester.getByRole("menuitem", { name: "Retire" }).click();
  await page.reload();

  const retired = card(page, "Rice harvester");
  await expect(retired).toBeVisible();                   // still readable
  await expect(retired.getByText("Retired", { exact: true })).toBeVisible();
  await expect(retired.getByText("Available")).toHaveCount(0);

  // It is gone from what a job may be given, but the row is untouched.
  const row = await testGet("SELECT status FROM equipment WHERE name='Rice harvester'") as { status: string };
  expect(row.status).toBe("retired");

  // And it can come back.
  await retired.getByRole("button", { name: /Actions for Rice harvester/ }).click();
  await retired.getByRole("menuitem", { name: "Bring back into service" }).click();
  await page.reload();
  await expect(card(page, "Rice harvester").getByText("Available")).toBeVisible();
});

test("one provider cannot see or touch another provider's machines", async ({ browser }) => {
  // A second provider with their own register.
  const other = { business: "Sesay Hire", phone: "077 303 303", email: `sesay.${run}@example.com`, password: "other-provider-26" };
  const o = await fresh(browser);
  await o.page.goto("/provider/sign-up");
  await o.page.getByLabel("Business name").fill(other.business);
  await o.page.getByLabel("Your phone number").fill(other.phone);
  await o.page.getByLabel("Email").fill(other.email);
  await o.page.getByLabel("Password", { exact: true }).fill(other.password);
  await o.page.getByRole("button", { name: "Create account" }).click();
  await enterCode(o.page, other.email);
  await o.page.getByLabel("District").selectOption("Kono");
  await o.page.getByLabel("Ploughing").check();
  await o.page.getByLabel("Town or village").fill("Koidu");
  await o.page.getByRole("button", { name: "Submit for review" }).click();
  const u = await testGet(`SELECT id FROM "user" WHERE email=?`, other.email) as { id: string };
  const now = new Date().toISOString();
  await testRun("UPDATE provider_business SET status='approved', reviewed_at=?, updated_at=? WHERE user_id=?", now, now, u.id);

  await o.page.goto("/provider/equipment");
  await expect(o.page.getByText("No machines on your register yet.")).toBeVisible();
  await expect(o.page.getByText("Massey Ferguson 375")).toHaveCount(0);
  await o.ctx.close();
});

test("a view-only teammate sees the register but cannot change it", async ({ page, browser }) => {
  await signIn(page, P.email, P.password);
  await page.goto("/provider/team");
  await page.getByRole("button", { name: "Invite team member" }).click();
  const d = page.getByRole("dialog");
  await d.getByLabel("Full name").fill(MATE.name);
  await d.getByLabel("Phone number").fill(MATE.phone);
  await d.getByLabel("Email address").fill(MATE.email);
  await d.getByLabel("Role").selectOption("assistant");
  await d.getByLabel("Permissions").selectOption("view_jobs");
  await d.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText(`Invitation sent to ${MATE.email}`)).toBeVisible();

  const mail = mailsTo(MATE.email).find((m) => /\/provider\/join\//.test(m.text))!;
  const link = mail.text.match(/(http\S+\/provider\/join\/\S+)/)![1];
  const m = await fresh(browser);
  await m.page.goto(link);
  await m.page.getByLabel("Password", { exact: true }).fill(MATE.password);
  await m.page.getByLabel("Confirm Password", { exact: true }).fill(MATE.password);
  await m.page.getByRole("button", { name: "Join the team" }).click();

  await signIn(m.page, MATE.email, MATE.password);
  await m.page.goto("/provider/equipment");
  await expect(m.page.getByText("Massey Ferguson 375").first()).toBeVisible();   // can read
  await expect(m.page.getByRole("button", { name: "Add equipment" })).toHaveCount(0);
  await expect(m.page.getByRole("button", { name: /^Actions for/ })).toHaveCount(0);
  await m.ctx.close();
});
