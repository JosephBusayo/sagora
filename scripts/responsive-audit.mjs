// Opens each page at each width and measures what a person would see go wrong. Measured rather
// than eyeballed, so a new screen cannot quietly bring back a sideways scroll.

/** Small phone, Android, iPhone, large iPhone, tablet, small laptop, desktop. */
export const WIDTHS = [320, 360, 390, 430, 768, 1024, 1440];
const PHONE = 480;
/** Apple's minimum tap size. */
const TAP = 44;

function inspect({ phone, tap }) {
  const vw = document.documentElement.clientWidth;
  const out = { sideways: document.documentElement.scrollWidth - vw, offscreen: [], clipped: [], small: [], zooms: [] };
  const name = (el) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]} "${(el.textContent || el.getAttribute("aria-label") || el.getAttribute("placeholder") || "").trim().slice(0, 30)}"`;

  const scrolls = (el) => {
    for (let p = el.parentElement; p; p = p.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(p).overflowX) && p.scrollWidth > p.clientWidth) return true;
    }
    return false;
  };

  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden" || cs.position === "fixed") continue;
    if (el.closest(".sr-only") || el.closest("[aria-hidden='true']")) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if ((r.right > vw + 1 || r.left < -1) && !scrolls(el)) out.offscreen.push(name(el));

    if (el.matches("button, a.button, .pill, .tab, .chip") && el.scrollWidth > el.clientWidth + 1) out.clipped.push(name(el));

    if (phone && el.matches("a, button, input, select, textarea, label.chip, summary, label.nav__burger") && !el.matches("input[type=hidden]")) {
      const inline = el.tagName === "A" && cs.display === "inline";
      if (!inline && !el.matches("input[type=radio], input[type=checkbox]") && r.height < tap) out.small.push(`${name(el)} ${Math.round(r.height)}px`);
      // iOS zooms the whole page when a focused field is under 16px.
      if (el.matches("input:not([type=radio]):not([type=checkbox]), select, textarea") && parseFloat(cs.fontSize) < 16) out.zooms.push(name(el));
    }
  }
  return out;
}

/** Measures one signed-in browser across its pages. Results land in `report`. */
export async function audit(page, urls, report) {
  const original = page.viewportSize();
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 800 });
    for (const url of urls) {
      await page.goto(url);
      await page.waitForLoadState("networkidle").catch(() => {});
      const found = await page.evaluate(inspect, { phone: width <= PHONE, tap: TAP });
      report.push({ url, width, ...found });
    }
  }
  if (original) await page.setViewportSize(original);
}

/** The problems that fail a run. Tap sizes and font sizes are reported separately. */
export function summarise(report) {
  const failing = report.filter((r) => r.sideways > 0 || r.offscreen.length > 0 || r.clipped.length > 0);
  return {
    failing,
    small: report.reduce((n, r) => n + r.small.length, 0),
    zooms: report.reduce((n, r) => n + r.zooms.length, 0),
  };
}
