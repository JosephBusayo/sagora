import { expect, test, type Page } from "@playwright/test";
import { confirmChecks, openForm } from "./checks";

/**
 * A half-filled quick request is kept in the browser. A farmer who looks at the voice note and
 * comes back, or reloads, or closes the tab and returns, finds what they had typed still there
 * instead of an empty form.
 */

test.beforeEach(async ({ page }) => { await confirmChecks(page); });

async function fillFirstStep(page: Page) {
  await page.getByLabel("What work do you need?").selectOption("harvesting");
  await page.getByLabel("Land size").fill("12");
  await page.getByLabel("Crop", { exact: true }).fill("Cassava");
  await page.getByLabel("Moderate access").check();
  await page.getByLabel("Cleared").check();
  await page.getByLabel("Ready now").check();
}

async function expectFirstStepKept(page: Page) {
  await expect(page.getByLabel("What work do you need?")).toHaveValue("harvesting");
  await expect(page.getByLabel("Land size")).toHaveValue("12");
  // Crop only exists once the service is known, so this also proves the service was put back
  // in a way the form itself noticed, not merely written into the page.
  await expect(page.getByLabel("Crop", { exact: true })).toHaveValue("Cassava");
  await expect(page.getByLabel("Moderate access")).toBeChecked();
  await expect(page.getByLabel("Ready now")).toBeChecked();
}

test("looking at the voice note and coming back does not empty the form", async ({ page }) => {
  await page.goto("/request");
  await openForm(page);
  await fillFirstStep(page);

  await page.getByRole("tab", { name: "Send a voice note" }).click();
  await expect(page.getByRole("button", { name: "Start recording" })).toBeVisible();
  await page.getByRole("tab", { name: "Fill a form" }).click();

  await expectFirstStepKept(page);
});

test("the form survives a reload, and the second step's answers with it", async ({ page }) => {
  await page.goto("/request");
  await openForm(page);
  await fillFirstStep(page);
  await page.getByRole("button", { name: "Continue" }).click();

  await page.getByLabel("District").selectOption("Bombali");
  await page.getByLabel("Chiefdom").selectOption("Biriwa");
  await page.getByLabel("Village/town").fill("Makonteh");
  await page.getByLabel("Your name").fill("Sahr Konteh");

  // As if the tab had been closed and opened again.
  await page.goto("/request");
  await openForm(page);
  await expectFirstStepKept(page);

  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("District")).toHaveValue("Bombali");
  // The chiefdoms are only listed once the district is known, so this one matters most.
  await expect(page.getByLabel("Chiefdom")).toHaveValue("Biriwa");
  await expect(page.getByLabel("Village/town")).toHaveValue("Makonteh");
  await expect(page.getByLabel("Your name")).toHaveValue("Sahr Konteh");
});

test("a sent request is not kept, so the next one starts clean", async ({ page }) => {
  await page.goto("/request");
  await openForm(page);
  await fillFirstStep(page);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByLabel("District").selectOption("Bombali");
  await page.getByLabel("Chiefdom").selectOption("Biriwa");
  await page.getByLabel("Village/town").fill("Makonteh");
  await page.getByLabel("Preferred start date").fill(new Date(Date.now() + 20 * 86400000).toISOString().slice(0, 10));
  await page.getByLabel("Your name").fill("Sahr Konteh");
  await page.getByLabel("Your phone number").fill("076 555 414");
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Send request" }).click();
  await page.waitForURL(/\/request\/track/);

  await page.goto("/request");
  await openForm(page);
  await expect(page.getByLabel("What work do you need?")).toHaveValue("");
  await expect(page.getByLabel("Land size")).toHaveValue("");
});
