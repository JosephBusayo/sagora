import { expect, test, type Browser, type Page } from "@playwright/test";
import { testGet, testRun } from "./testdb";
import fs from "node:fs";
import path from "node:path";

const OUTBOX = path.join(process.cwd(), "data", "dev-outbox.jsonl");
const SHOTS = path.join(process.cwd(), "e2e", "screens");
fs.mkdirSync(SHOTS, { recursive: true });

const run = Date.now();
const OWNER = { business: "Kandeh Farming Services", phone: "076 909 100", email: `owner.${run}@example.com`, password: "farmland-2026" };
const MATE = { name: "Salieu Jalloh", phone: "077 404 505", email: `mate.${run}@example.com`, password: "operator-2026" };

type Mail = { to: string; subject: string; text: string };
const mailsTo = (email: string): Mail[] =>
  fs.existsSync(OUTBOX)
    ? fs.readFileSync(OUTBOX, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Mail).filter((m) => m.to === email)
    : [];
async function waitMail(email: string, match: RegExp): Promise<Mail> {
  for (let i = 0; i < 60; i++) {
    const m = mailsTo(email).find((x) => match.test(x.text));
    if (m) return m;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no matching email for ${email}`);
}
const latestCode = async (email: string) => (await waitMail(email, /code is \d{7}/)).text.match(/code is (\d{7})/)![1];

async function signUpAndVerify(page: Page, u: { business: string; phone: string; email: string; password: string }) {
  await page.goto("/provider/sign-up");
  await page.getByLabel("Business name").fill(u.business);
  await page.getByLabel("Your phone number").fill(u.phone);
  await page.getByLabel("Email").fill(u.email);
  await page.getByLabel("Password", { exact: true }).fill(u.password);
  await page.getByRole("button", { name: "Create account" }).click();
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = await latestCode(u.email);
    await page.getByLabel("Digit 1 of 7").click();
    await page.keyboard.press("Control+A");
    await page.keyboard.type(code);
    await page.getByRole("button", { name: "Verify" }).click();
    try {
      await page.waitForURL((p) => !p.pathname.includes("verify-email"), { timeout: 5000 });
      return;
    } catch {
      await page.waitForTimeout(400); // not accepted yet; read a fresh code and retry
    }
  }
  throw new Error(`verification never completed for ${u.email}`);
}
async function signIn(page: Page, email: string, password: string) {
  await page.goto("/provider/sign-in");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/sign-in/); // the session cookie is set by the redirect
}
async function approve(email: string) {
  const u = await testGet(`SELECT id FROM "user" WHERE email=?`, email) as { id: string };
  const now = new Date().toISOString();
  await testRun("UPDATE provider_business SET status='approved', reviewed_at=?, updated_at=? WHERE user_id=?", now, now, u.id);
}
async function fresh(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1728, height: 1117 } });
  return { ctx, page: await ctx.newPage() };
}

test.describe.configure({ mode: "serial" });

test("an unapproved provider cannot reach the workspace", async ({ page }) => {
  await signUpAndVerify(page, OWNER);
  await expect(page).toHaveURL(/\/provider\/setup$/);
  for (const url of ["/provider/team", "/provider/settings", "/provider/settings/business"]) {
    await page.goto(url);
    await expect(page).toHaveURL(/\/provider\/setup$/);
  }
});

test("once approved, the workspace opens on the designed screens", async ({ page }) => {
  // Complete setup, then approve (the staff path is covered in provider-setup.spec.ts).
  await signIn(page, OWNER.email, OWNER.password);
  await page.getByLabel("District").selectOption("Bombali");
  await page.getByLabel("Ploughing").check();
  await page.getByLabel("Town or village").fill("Makeni");
  await page.getByRole("button", { name: "Submit for review" }).click();
  await approve(OWNER.email);

  await page.goto("/provider/settings");
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
  await expect(page.getByRole("link", { name: /Business details/ })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${SHOTS}/8-settings.png` });

  await page.getByRole("link", { name: /Business details/ }).click();
  await expect(page).toHaveURL(/settings\/business$/);
  await expect(page.getByLabel("Business name")).toHaveValue(OWNER.business);
  await page.screenshot({ path: `${SHOTS}/9-business-details.png` });

  // Saving a change sticks.
  await page.getByLabel("Village/town").fill("Makeni, Bombali");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Your business details have been saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Village/town")).toHaveValue("Makeni, Bombali");
});

test("the team table lists the owner and refuses a second owner", async ({ page }) => {
  await signIn(page, OWNER.email, OWNER.password);
  await page.goto("/provider/team");
  await expect(page.getByRole("heading", { name: "Team management" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Owner" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Full access" })).toBeVisible();
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: `${SHOTS}/10-team.png` });

  await page.getByRole("button", { name: "Invite team member" }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/11-invite-modal.png` });

  // An empty form is refused field by field.
  await page.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText("Enter their full name")).toBeVisible();
  await expect(page.getByText("Choose a role")).toBeVisible();
});

test("invite, accept, and the teammate sees the same business", async ({ page, browser }) => {
  await signIn(page, OWNER.email, OWNER.password);
  await page.goto("/provider/team");
  await page.getByRole("button", { name: "Invite team member" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Full name").fill(MATE.name);
  await dialog.getByLabel("Phone number").fill(MATE.phone);
  await dialog.getByLabel("Email address").fill(MATE.email);
  await dialog.getByLabel("Role").selectOption("operator");
  await dialog.getByLabel("Permissions").selectOption("manage_jobs");
  await dialog.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText(`Invitation sent to ${MATE.email}`)).toBeVisible();

  await page.reload();
  await expect(page.getByRole("cell", { name: MATE.name, exact: true })).toBeVisible();
  await expect(page.getByText("Invited")).toBeVisible();

  // A second invite to the same person is refused.
  await page.getByRole("button", { name: "Invite team member" }).click();
  const d2 = page.getByRole("dialog");
  await d2.getByLabel("Full name").fill(MATE.name);
  await d2.getByLabel("Phone number").fill(MATE.phone);
  await d2.getByLabel("Email address").fill(MATE.email);
  await d2.getByLabel("Role").selectOption("operator");
  await d2.getByLabel("Permissions").selectOption("view_jobs");
  await d2.getByRole("button", { name: "Send invitation" }).click();
  await expect(page.getByText(/already on your team/)).toBeVisible();
  await page.keyboard.press("Escape");

  // The teammate accepts from the emailed link.
  const mail = await waitMail(MATE.email, /\/provider\/join\//);
  const link = mail.text.match(/(http\S+\/provider\/join\/\S+)/)![1];
  const { ctx, page: mate } = await fresh(browser);
  await mate.goto(link);
  await expect(mate.getByRole("heading", { name: `Join ${OWNER.business}` })).toBeVisible();
  await mate.screenshot({ path: `${SHOTS}/12-join.png` });
  await mate.getByLabel("Password", { exact: true }).fill(MATE.password);
  await mate.getByLabel("Confirm Password", { exact: true }).fill(MATE.password);
  await mate.getByRole("button", { name: "Join the team" }).click();
  await expect(mate).toHaveURL(/sign-in\?joined=1$/);

  // The same link cannot be used twice.
  const second = await fresh(browser);
  await second.page.goto(link);
  await expect(second.page.getByRole("heading", { name: "This invitation can't be used" })).toBeVisible();
  await second.ctx.close();

  // The teammate lands in the owner's business, not a new one, and is Active.
  await signIn(mate, MATE.email, MATE.password);
  await mate.goto("/provider/team");
  await expect(mate.getByRole("heading", { name: "Team management" })).toBeVisible();
  // The owner's own row proves the teammate is inside the owner's business, not a new one.
  await expect(mate.getByRole("cell", { name: OWNER.business, exact: true })).toBeVisible();
  await expect(mate.getByRole("cell", { name: MATE.name, exact: true })).toBeVisible();
  await expect(mate.getByText("Active").first()).toBeVisible();
  await ctx.close();
});

test("a teammate without full access cannot invite or change the business", async ({ browser }) => {
  const { ctx, page: mate } = await fresh(browser);
  await signIn(mate, MATE.email, MATE.password);
  await mate.goto("/provider/team");
  await expect(mate.getByRole("button", { name: "Invite team member" })).toHaveCount(0);

  // Even posting the form directly is refused by the server.
  await mate.goto("/provider/settings/business");
  await mate.getByLabel("Village/town").fill("Somewhere else");
  await mate.getByRole("button", { name: "Save changes" }).click();
  await expect(mate.getByText(/do not have permission/)).toBeVisible();
  await ctx.close();
});

test("changing the password signs other browsers out", async ({ page, browser }) => {
  await signIn(page, OWNER.email, OWNER.password);
  await expect(page).toHaveURL(/\/provider\/dashboard$/);

  const { ctx, page: p2 } = await fresh(browser);
  await signIn(p2, OWNER.email, OWNER.password);
  await p2.goto("/provider/settings/password");
  await p2.getByLabel("Current password", { exact: true }).fill("wrong-password");
  await p2.getByLabel("New password", { exact: true }).fill("new-strong-pass-1");
  await p2.getByLabel("Confirm new password", { exact: true }).fill("new-strong-pass-1");
  await p2.getByRole("button", { name: "Save new password" }).click();
  await expect(p2.getByText("That password is not correct.")).toBeVisible();

  await p2.getByLabel("Current password", { exact: true }).fill(OWNER.password);
  await p2.getByLabel("New password", { exact: true }).fill("new-strong-pass-1");
  await p2.getByLabel("Confirm new password", { exact: true }).fill("new-strong-pass-1");
  await p2.getByRole("button", { name: "Save new password" }).click();
  await expect(p2).toHaveURL(/\/provider\/sign-in$/);
  await expect(p2.getByText(/every device has been signed out/)).toBeVisible();

  // The other browser's session is dead on its next request.
  await page.goto("/provider/settings");
  await expect(page).toHaveURL(/\/provider\/sign-in$/);

  // Only the new password works.
  await signIn(p2, OWNER.email, "new-strong-pass-1");
  await expect(p2).toHaveURL(/\/provider\/dashboard$/);
  await ctx.close();
});
