import { chromium } from "playwright";
import fs from "node:fs";
const browser = await chromium.launch({ executablePath: fs.existsSync("/opt/pw-browsers/chromium-1243/chrome-linux64/chrome") ? "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome" : undefined });
const page = await (await browser.newContext({ viewport: { width: 1728, height: 1117 } })).newPage();
const errs = [];
page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
page.on("pageerror", (e) => errs.push("pageerror: " + String(e)));
await page.goto("http://localhost:3301/farmer/sign-up", { waitUntil: "networkidle" });
const info = await page.evaluate(() => {
  const pick = (sel) => { const el = document.querySelector(sel); if (!el) return `${sel}: MISSING`;
    const r = el.getBoundingClientRect(); const cs = getComputedStyle(el);
    return `${sel}: ${Math.round(r.x)},${Math.round(r.y)} ${Math.round(r.width)}x${Math.round(r.height)} display=${cs.display} position=${cs.position} z=${cs.zIndex}`; };
  return [".auth", ".auth__main", ".auth__form-col", ".auth__panel", ".auth__form"].map(pick).join("\n");
});
console.log(info);
console.log("stylesheets:", await page.evaluate(() => document.styleSheets.length));
console.log("console errors:", errs.slice(0,3));
await browser.close(); process.exit(0);
