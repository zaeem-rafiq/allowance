import { defineConfig, devices } from "@playwright/test";

// The browser tests always start their own server on port 3101 in test mode (KTD5): fakes
// for PayPal, the AI and the clock, an in-memory database, and its own build folder. A
// server already running there is never reused, so a real-keys server cannot be tested by
// mistake. One worker, because the tests share that one server's fakes and clock.
export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  forbidOnly: !!process.env.CI,
  workers: 1,
  use: { baseURL: "http://localhost:3101" },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: "npx next dev -p 3101",
    port: 3101,
    reuseExistingServer: false,
    timeout: 180_000,
    env: { ALLOWANCE_TEST_MODE: "1", ALLOWANCE_DIST_DIR: ".next-test" },
  },
});
