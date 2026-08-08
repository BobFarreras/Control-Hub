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
 * Which stack to drive is decided by where the suite was pointed.
 *
 * `pnpm check:e2e` runs against the verify stack on 3002/4002, so that a full authenticated run
 * does not sign out whoever is working at 3001. Next refuses a second `dev` on the same port and
 * output directory, so the web app has a script per stack and the port picks it; the API reads
 * its port from `API_PORT` and needs no second script, only the right health URL.
 */
const webCommand =
  new URL(baseURL).port === "3002" ? "pnpm --filter @control-hub/web dev:verify" : "pnpm --filter @control-hub/web dev";

/**
 * Reusing a server that is already up is a convenience for a developer running one spec, and a
 * trap for a gate that exists to predict CI.
 *
 * A `next dev` that has been up for an hour is not the thing CI runs against. One that had been
 * open all afternoon answered the whole suite with a 500 -- its render worker had died hours
 * earlier -- and the run failed on the web server never becoming ready. CI never sees that,
 * because CI starts both processes a minute before the first test. So `pnpm check:e2e` sets
 * `E2E_OWN_SERVERS` and starts its own, exactly as `CI` does.
 */
const ownServers = Boolean(process.env.CI ?? process.env.E2E_OWN_SERVERS);

/**
 * Server components talk to the API directly, so an authenticated page renders nothing without
 * it. The unauthenticated suite never reaches one and does not pay for starting it.
 */
const apiServer = {
  command: "pnpm --filter @control-hub/api dev",
  url: `${process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000"}/health/ready`,
  reuseExistingServer: !ownServers,
  timeout: 120_000
};

const webServer = {
  command: webCommand,
  url: `${baseURL}/ca`,
  reuseExistingServer: !ownServers,
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
  /**
   * The one budget nobody had chosen: Playwright's default five seconds for an assertion.
   *
   * An action gets fifteen seconds and a navigation thirty, but `expect(heading).toBeVisible()`
   * straight after following a link got five -- and on a development server the first visit to a
   * route compiles it before it renders anything. The project detail screen missed that window on
   * a cold server and passed on the retry, which is a test failing on how warm the machine was.
   * Matched to the action budget so all three say the same thing about how long a screen may take.
   */
  expect: { timeout: 15_000 },
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
