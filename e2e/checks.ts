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

/**
 * The parts of a provider application every submission needs (UC02): an ID document and the
 * business's terms. Safe to run twice: a second run adds no second document.
 */
export async function completeApplication(page: Page): Promise<void> {
  if ((await page.locator(".doc-list a").count()) === 0) {
    await page.locator(".doc-upload input[type=file]").setInputFiles({
      name: "id.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"),
    });
    await page.getByRole("link", { name: "ID of the person in charge: id.pdf" }).waitFor();
  }
  await page.getByLabel("What kind of business is this?").selectOption("individual");
  await page.getByLabel("Person who can offer and allocate your equipment").fill("Test Owner");
  await page.getByLabel("Their role").fill("Owner");
  await page.getByLabel("How do you price work?").selectOption("per_acre");
  await page.getByLabel("What your price includes").fill("Operator and fuel");
  await page.getByLabel("Deposit you ask for").fill("No deposit");
  await page.getByLabel("If the work is cancelled").fill("Full refund up to 2 days before");
}

/**
 * /request opens on "Send a voice note" when a transcription key is configured, so the form is
 * one tab away. Clicks that tab when it is there, and does nothing when it is not.
 */
export async function openForm(page: Page): Promise<void> {
  const tab = page.getByRole("tab", { name: "Fill a form" });
  if (await tab.isVisible().catch(() => false)) await tab.click();
}
