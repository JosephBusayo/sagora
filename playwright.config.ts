import { defineConfig, devices } from "@playwright/test";
import fs from "node:fs";

const PORT = 3100;
// Use the Chromium that ships with the machine when present; otherwise Playwright's own.
const local = "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
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
      DATABASE_PATH: "data/test.db",
      BETTER_AUTH_URL: `http://localhost:${PORT}`,
      BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-123456",
      SAGORA_TEST_OUTBOX: "1", // test-only: write emails to data/dev-outbox.jsonl even under `next start`
    },
  },
});
