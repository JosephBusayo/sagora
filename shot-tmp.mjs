// Renders the farmer home screen with real data and screenshots it, so the implementation can
// be compared against the Figma frame side by side rather than read in source.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const PORT = Number(process.env.PORT ?? 3300);
const BASE = `http://localhost:${PORT}`;
const OUT = "/tmp/claude-0/-home-claude/e3314e33-cd6b-5e0b-a667-2e6feb1d8c84/scratchpad";
const OUTBOX = path.join(process.cwd(), "data", "dev-outbox.jsonl");

const F = { name: "Joseph Jayeoba", phone: "076 808 909", email: `joseph.${Date.now()}@example.com`, pass: "harvest-rice-26" };

const mails = (email) =>
  fs.existsSync(OUTBOX)
    ? fs.readFileSync(OUTBOX, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)).filter((m) => m.to === email)
    : [];
async function code(email) {
  for (let i = 0; i < 80; i++) {
    const m = mails(email).filter((x) => /code is \d{7}/.test(x.text));
    if (m.length) return m[m.length - 1].text.match(/code is (\d{7})/)[1];
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error("no code");
}
const inDays = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);

const browser = await chromium.launch({
  executablePath: fs.existsSync("/opt/pw-browsers/chromium-1243/chrome-linux64/chrome")
    ? "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome"
    : undefined,
});
const ctx = await browser.newContext({ viewport: { width: 1728, height: 1117 }, baseURL: BASE });
const page = await ctx.newPage();

await page.goto("/farmer/sign-up", { waitUntil: "networkidle" });
await page.getByLabel("First and last name").fill(F.name);
await page.getByLabel("Your phone number").fill(F.phone);
await page.getByLabel("Email").fill(F.email);
await page.getByLabel("Password", { exact: true }).fill(F.pass);
await page.getByRole("button", { name: "Create account" }).click();
await page.waitForURL(/verify-email/);
await page.getByLabel("Digit 1 of 7").click();
await page.keyboard.type(await code(F.email));
await page.getByRole("button", { name: "Verify" }).click();
await page.waitForURL(/\/farmer\/home$/, { timeout: 10000 });

// Empty state first — a brand-new farmer sees this.
await page.waitForLoadState("networkidle");
await page.screenshot({ path: `${OUT}/home-empty.png`, fullPage: true });

// Then three requests, so the table matches the design's populated frame.
for (const [i, village] of ["Mabanta Village", "Kagbo", "Makeni"].entries()) {
  await page.goto("/farmer/book", { waitUntil: "networkidle" });
  await page.getByLabel("What work do you need?").selectOption("ploughing");
  await page.getByLabel("Farm size (acres)").fill("5");
  await page.getByLabel("Preferred date").fill(inDays(30 + i));
  await page.getByLabel("District").selectOption("Bombali");
  await page.getByLabel("Community or village").fill(village);
  await page.getByRole("button", { name: "Send request" }).click();
  await page.getByText(/Request SG-\d+ sent/).waitFor({ timeout: 10000 });
}

await page.goto("/farmer/home");
await page.waitForLoadState("networkidle");
await page.screenshot({ path: `${OUT}/home-full.png`, fullPage: true });
await page.screenshot({ path: `${OUT}/home-top.png`, clip: { x: 0, y: 0, width: 1728, height: 700 } });

console.log("screenshots written");
await ctx.close();
await browser.close();
process.exit(0);
