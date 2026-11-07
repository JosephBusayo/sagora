import { expect, test } from "@playwright/test";

// The landing page is the front door: every button on it must lead into the real app.

test("the home page is the landing page, and its buttons lead into the app", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Everything it takes to");
  await expect(page).toHaveTitle(/Agricultural services in Sierra Leone/);

  const hero = page.locator(".hero");
  await expect(hero.getByRole("link", { name: "Find a service provider" })).toHaveAttribute("href", "/request");
  await expect(hero.getByRole("link", { name: "Find it here" })).toHaveAttribute("href", "/request/find");
  const footer = page.locator("footer");
  await expect(footer.getByRole("link", { name: "Join as a provider" })).toHaveAttribute("href", "/provider/sign-up");
  await expect(footer.getByRole("link", { name: "Provider workspace" })).toHaveAttribute("href", "/provider/dashboard");
  // Not supplied yet, so not shown rather than a dead end.
  await expect(footer.getByText("Contact us")).toHaveCount(0);
  await expect(footer.getByText("Legal")).toHaveCount(0);

  // A signed-out visitor can ask for a service without an account.
  await hero.getByRole("link", { name: "Find a service provider" }).click();
  await page.waitForURL(/\/request$/);
  await expect(page.getByLabel("What work do you need?")).toBeVisible();
});

test("Sign in asks whether you are a farmer or a service provider", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  await page.locator(".nav__links").getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("link", { name: "As a farmer" })).toHaveAttribute("href", "/farmer/sign-in");
  await page.getByRole("link", { name: "As a service provider" }).click();
  await page.waitForURL(/\/provider\/sign-in$/);
});

test("on a phone, the menu offers the same sign-in choice", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.locator(".mnav__actions").getByRole("button", { name: "Sign in" }).click();
  await page.locator(".mnav").getByRole("link", { name: "As a farmer" }).click();
  await page.waitForURL(/\/farmer\/sign-in$/);
});

test("an unknown address shows the app's not-found page", async ({ page }) => {
  const res = await page.goto("/no-such-page");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "We can't find that page" })).toBeVisible();
});
