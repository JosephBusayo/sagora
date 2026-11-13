import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";

const PORT = 3100;
// Use the Chromium that ships with the machine when present; otherwise Playwright's own.
const local = "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  // Five seconds is too tight for a laptop building pages on demand.
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  outputDir: "./e2e/.results",
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1728, height: 1117 },
    launchOptions: fs.existsSync(local) ? { executablePath: local } : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1728, height: 1117 } } }],
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/provider/sign-in`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      // DATABASE_URL set in the environment runs the whole suite on Postgres instead; the
      // sqlite file is then ignored, so both can be named without them fighting.
      ...(process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL } : {}),
      DATABASE_PATH: "data/test.db",
      BETTER_AUTH_URL: `http://localhost:${PORT}`,
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-123456",
      SAGORA_TEST_OUTBOX: "1", // test-only: write emails to data/dev-outbox.jsonl even under `next start`
      // A stand-in Monime (e2e/monime-stub.ts), started by the tests that pay online.
      SAGORA_WHATSAPP: "+232 00 000 000",
      MONIME_API_URL: "http://localhost:3499",
      MONIME_ACCESS_TOKEN: "mon_test_stub_token",
      MONIME_SPACE_ID: "spc-test",
      MONIME_WEBHOOK_SECRET: "test-webhook-secret",
      // A stand-in Gemini (e2e/gemini-stub.ts), started by the voice-note tests. The key only has
      // to be non-empty for the voice option to be offered at all; the stub does not check it.
      GEMINI_API_URL: "http://localhost:3498",
      GOOGLE_GENERATIVE_AI_API_KEY: "e2e-stub-key",
      AI_MODEL: "gemini-2.5-flash",
    },
  },
});
