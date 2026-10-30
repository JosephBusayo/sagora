import { chromium } from "playwright";
import fs from "node:fs";
const browser = await chromium.launch({ executablePath: fs.existsSync("/opt/pw-browsers/chromium-1243/chrome-linux64/chrome") ? "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" : undefined });
const page = await (await browser.newContext({ viewport: { width: 1728, height: 1117 } })).newPage();
await page.goto("http://localhost:3301/farmer/sign-up", { waitUntil: "networkidle" });
await page.getByLabel("First and last name").fill("Joseph Jayeoba");
await page.getByLabel("Your phone number").fill("076 808 909");
await page.getByLabel("Email").fill(`j.${Date.now()}@example.com`);
await page.getByLabel("Password", { exact: true }).fill("harvest-rice-26");
const btn = page.getByRole("button", { name: "Create account" });
const box = await btn.boundingBox();
console.log("button box:", box);
const what = await page.evaluate(({x,y}) => {
  const el = document.elementFromPoint(x, y);
  const path = []; let n = el;
  while (n && path.length < 5) { path.push(`${n.tagName}.${n.className || ""}`.slice(0,70)); n = n.parentElement; }
  return path;
}, { x: box.x + box.width/2, y: box.y + box.height/2 });
console.log("element at button centre:", what);
try { await btn.click({ timeout: 10000 }); console.log("clicked ok, url:", page.url()); }
catch (e) { console.log("click failed:", String(e).split("\n")[0]);
  console.log("pointer-events:", await btn.evaluate((el)=>getComputedStyle(el).pointerEvents));
  console.log("ancestor animations:", await page.evaluate(()=>document.getAnimations().map(a=>a.animationName||a.constructor.name).slice(0,5)));
}
await page.waitForTimeout(1500); console.log("url after:", page.url());
await browser.close(); process.exit(0);
