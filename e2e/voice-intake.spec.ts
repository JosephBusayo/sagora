import { expect, test, type Page } from "@playwright/test";
import { confirmChecks } from "./checks";
import { startGeminiStub } from "./gemini-stub";

/**
 * The voice-note route into a request (Figma 152:107 idle, 152:267 recording, 152:546 review).
 * The microphone and Gemini are both stood in for, so the three screens, and what the farmer is
 * shown when transcription fails, are all tested without a real recording or an API key.
 */

const gemini = startGeminiStub();

test.beforeAll(async () => { await gemini.start(); });
test.afterAll(async () => { await gemini.stop(); });
test.beforeEach(async ({ page }) => {
  gemini.set("ok");
  await confirmChecks(page);
  await stubMicrophone(page);
});
test.describe.configure({ mode: "serial", timeout: 120_000 });

/** A microphone that records nothing and hands back a few bytes of webm when stopped. */
async function stubMicrophone(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }) },
    });
    class FakeRecorder {
      state = "inactive";
      ondataavailable: ((e: { data: Blob }) => void) | null = null;
      onstop: (() => void) | null = null;
      static isTypeSupported() { return true; }
      start() { this.state = "recording"; }
      stop() {
        this.state = "inactive";
        // Four bytes is enough: nothing server-side looks inside the clip.
        this.ondataavailable?.({ data: new Blob([new Uint8Array([26, 69, 223, 163])], { type: "audio/webm" }) });
        this.onstop?.();
      }
    }
    Object.defineProperty(window, "MediaRecorder", { configurable: true, value: FakeRecorder });
  });
}

const record = async (page: Page) => {
  await page.getByRole("button", { name: "Start recording" }).click();
  await page.getByRole("button", { name: "End recording" }).click();
};

test("a voice note becomes a transcript, then the form it filled in", async ({ page }) => {
  await page.goto("/request");
  // The voice note is the choice the screen opens on.
  await expect(page.getByRole("tab", { name: "Send a voice note" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("button", { name: "Start recording" })).toBeVisible();
  await expect(page.getByText("Before you record, tell us:")).toBeVisible();

  await record(page);

  // The transcript comes back as the farmer's own words, with Record again / Send request.
  await expect(page.getByRole("heading", { name: "Your request" })).toBeVisible();
  await expect(page.getByText("Makonteh", { exact: false }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Record again" })).toBeVisible();

  // Sending reveals the form it filled in — the farmer still submits that themselves. The
  // service was heard, so the form opens past the step that asks for it, already on harvesting.
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page.getByRole("heading", { name: "Harvesting service" })).toBeVisible();
  await expect(page.getByLabel("Land size")).toHaveValue("494.21");
  await expect(page.getByLabel("Unit")).toHaveValue("acres");
  // Said out loud, so not typed again: the crop, and what no other field holds.
  await expect(page.getByLabel("Crop", { exact: true })).toHaveValue("rice");
  await expect(page.getByLabel("Additional notes (optional)")).toHaveValue(/call me back|called back/i);

  // The land questions were never spoken, so they are still the farmer's to answer — the form
  // will not go on without them, which is the point of listing them on the review screen.
  await page.getByLabel("Easy access").check();
  await page.getByLabel("Cleared").check();
  await page.getByLabel("Ready now").check();

  // Step 2 carries the place and the date, resolved from "second week October".
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByLabel("District")).toHaveValue("Bombali");
  await expect(page.getByLabel("Village/town")).toHaveValue("Makonteh");
  await expect(page.getByLabel("Preferred start date")).toHaveValue("2027-10-11");
  // "Karene Chiefdom" is a neighbouring district, not a Bombali chiefdom, so it is not filled in.
  await expect(page.getByLabel("Chiefdom")).toHaveValue("");

  // What was never said is asked for by name rather than guessed at.
  await expect(page.locator(".voice-review__note")).toContainText("Your phone number");
  await expect(page.locator(".voice-review__note")).toContainText("Chiefdom");
  await expect(page.locator(".voice-review__note")).toContainText("Land access");

  // Thinking was switched off on the call, which is what kept it from running for minutes.
  expect(gemini.seen.at(-1)).toMatchObject({ model: "gemini-2.5-flash", thinkingOff: true, mime: "audio/webm" });
});

test("ending the recording replaces the mic and the prompt card with a processing screen", async ({ page }) => {
  // Held open so the screen between recording and the transcript can be looked at.
  gemini.set("stall");
  await page.goto("/request");
  await record(page);

  await expect(page.getByRole("heading", { name: "Listening to your recording" })).toBeVisible();
  // Nothing left to tap, and no instructions for a recording that has already been made.
  await expect(page.getByRole("button", { name: "Start recording" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "End recording" })).toHaveCount(0);
  await expect(page.getByText("Before you record, tell us:")).toHaveCount(0);
});

test("a refused transcription says so and offers the mic again, instead of a crash page", async ({ page }) => {
  gemini.set("refuse");
  await page.goto("/request");
  await record(page);

  await expect(page.getByText("We could not understand that recording", { exact: false })).toBeVisible();
  // The way back is on the same screen: record again, or switch to the form.
  await expect(page.getByRole("button", { name: "Start recording" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Something went wrong" })).toHaveCount(0);

  // The form is still there as the other way in.
  await page.getByRole("tab", { name: "Fill a form" }).click();
  await expect(page.getByLabel("What work do you need?")).toBeVisible();
});

test("a second recording is not answered by the first one's result", async ({ page }) => {
  gemini.set("refuse");
  await page.goto("/request");
  await record(page);
  await expect(page.getByText("We could not understand that recording", { exact: false })).toBeVisible();

  // With a result already on screen, the next recording must still show the wait.
  gemini.set("stall");
  await record(page);
  await expect(page.getByRole("heading", { name: "Listening to your recording" })).toBeVisible();
  await expect(page.getByText("We could not understand that recording", { exact: false })).toHaveCount(0);
});
