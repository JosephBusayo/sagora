import type { Page } from "@playwright/test";

/**
 * Forms read the answers back in a "Check before sending" window and send only once it is
 * confirmed. Most tests are about what happens after sending, so this confirms it for them as
 * soon as it opens, from inside the page: a test that next reads an email rather than the page
 * would otherwise wait for a send that never happens. The window itself is tested on its own,
 * in a page without this, in requests.spec.ts.
 */
export const AUTO_CONFIRM = () => {
  const confirm = (dialog: Element) => {
    const buttons = dialog.querySelectorAll<HTMLButtonElement>(".request-card__actions .button");
    buttons[buttons.length - 1]?.click();
  };
  new MutationObserver((changes) => {
    for (const c of changes) {
      const el = c.target as Element;
      if (c.attributeName === "open" && el.matches?.("dialog.check-first[open]")) setTimeout(() => confirm(el), 0);
    }
  }).observe(document, { subtree: true, attributes: true, attributeFilter: ["open"] });
};

export async function confirmChecks(page: Page): Promise<Page> {
  await page.addInitScript(AUTO_CONFIRM);
  return page;
}
