import { defineConfig, devices } from "@playwright/test";
import { fixtureAvailable, storageStatePath } from "./tests/e2e/support/fixture";

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3001";

/**
 * The authenticated projects only exist once `pnpm db:seed:e2e` has written its fixture. A
 * developer who has not seeded a test database still gets the unauthenticated suite instead of
 * a wall of failures about a missing account, while CI always seeds and so always runs them.
 */
const authenticated = fixtureAvailable();

/**
 * Server components talk to the API directly, so an authenticated page renders nothing without
 * it. The unauthenticated suite never reaches one and does not pay for starting it.
 */
const apiServer = {
  command: "pnpm --filter @control-hub/api dev",
  url: "http://127.0.0.1:4000/health/ready",
  reuseExistingServer: !process.env.CI,
  timeout: 120_000
};

const webServer = {
  command: "pnpm --filter @control-hub/web dev",
  url: `${baseURL}/ca`,
  reuseExistingServer: !process.env.CI,
  timeout: 120_000
};

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: process.env.CI ? 2 : 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  /**
   * A stuck element fails in fifteen seconds, not in the test's whole budget.
   *
   * Without these, a locator that will never resolve -- a select rendered with no options, a
   * control behind a flag that is off -- burns the full two or three minute test timeout, and
   * then does it twice more on retry. One broken test cost nine minutes of a run and the log said
   * only "waiting for locator". The test timeout still exists for tests that legitimately drive
   * several screens; this caps the wait for any single action inside them.
   */
  use: { baseURL, trace: "on-first-retry", actionTimeout: 15_000, navigationTimeout: 30_000 },
  projects: [
    {
      name: "desktop-chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: ["**/*.authenticated.spec.ts", "**/*.setup.ts"]
    },
    {
      name: "mobile-chromium",
      use: { ...devices["Pixel 7"] },
      testIgnore: ["**/*.authenticated.spec.ts", "**/*.setup.ts"]
    },
    ...(authenticated
      ? [
          // Signs in once through the real second factor and banks the session, so the screens
          // under test spend their time on the screens rather than on the login form.
          { name: "setup", use: { ...devices["Desktop Chrome"] }, testMatch: /.*\.setup\.ts/ },
          {
            name: "authenticated",
            use: { ...devices["Desktop Chrome"], storageState: storageStatePath },
            testMatch: /.*\.authenticated\.spec\.ts/,
            dependencies: ["setup"]
          }
        ]
      : [])
  ],
  webServer: authenticated ? [apiServer, webServer] : [webServer]
});
