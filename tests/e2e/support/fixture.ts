import { readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";
import { generateTotp, millisecondsLeftInPeriod, secretFromTotpUri } from "./totp";

/**
 * What `apps/api/src/seed-e2e.ts` left behind for the suite: the throwaway account and the
 * rows the assertions name. It is read from disk rather than passed through the environment
 * so the TOTP secret never appears in a process listing or a CI log line.
 */
export type Fixture = {
  email: string;
  password: string;
  totpUri: string;
  tenantId: string;
  membershipId: string;
  ownerName: string;
  tickets: Record<"breached" | "within" | "conversation", string>;
  subjects: Record<"breached" | "within" | "conversation", string>;
  internalNote: string;
  customerReply: string;
  commerce: { customer: string; product: string; plan: string };
};

export const credentialsPath = process.env.E2E_CREDENTIALS_FILE
  ? isAbsolute(process.env.E2E_CREDENTIALS_FILE)
    ? process.env.E2E_CREDENTIALS_FILE
    : resolve(process.env.E2E_CREDENTIALS_FILE)
  : resolve(".e2e/credentials.json");

export const storageStatePath = resolve(".e2e/storage-state.json");

/** True when the fixture has been seeded, which is what gates the authenticated project. */
export function fixtureAvailable(): boolean {
  try {
    readFileSync(credentialsPath, "utf8");
    return true;
  } catch {
    return false;
  }
}

export function readFixture(): Fixture {
  try {
    return JSON.parse(readFileSync(credentialsPath, "utf8")) as Fixture;
  } catch (cause) {
    throw new Error(
      `No end to end fixture at ${credentialsPath}. Run the seed described in DEVELOPMENT.md before the authenticated suite.`,
      { cause }
    );
  }
}

/**
 * A code that will still be current when the form is submitted.
 *
 * Generating one with a moment left in its window and then waiting on a page transition is the
 * classic way to make a second factor look broken. Rolling into the next window costs a few
 * seconds once and removes a whole class of flake.
 */
export async function currentTotp(totpUri: string, page: Page): Promise<string> {
  const secret = secretFromTotpUri(totpUri);
  const remaining = millisecondsLeftInPeriod(30);
  if (remaining < 5_000) await page.waitForTimeout(remaining + 250);
  return generateTotp(secret);
}

/**
 * The Catalan strings the sign-in form renders, kept here so a wording change breaks in one
 * place. They are copied rather than imported because `@control-hub/i18n` is a workspace
 * package and this suite runs from the repository root, outside any app's dependency graph.
 */
export const labels = {
  email: "Correu electronic",
  password: "Contrasenya",
  signIn: "Iniciar sessio",
  otp: "Codi de verificacio",
  verify: "Verificar",
  error: "No s'ha pogut iniciar la sessio."
} as const;

/**
 * Waits until React has wired this particular control, not merely rendered it.
 *
 * Every interactive screen here is server rendered and then hydrated. Between those two
 * moments the markup is complete and visible, so Playwright's own waiting is satisfied, but no
 * handler is attached yet: a click on the sign-in button or a change on the status dropdown is
 * simply lost, and the test fails describing a product that does nothing. That is exactly what
 * it looked like before this existed, and it came and went with how busy the machine was.
 *
 * The probe is the `__reactProps$…` key React attaches to a DOM node when it hydrates it.
 * Reaching into a React internal is a liberty a test may take and product code may not; the
 * alternative is a fixed sleep, which is slower and still occasionally wrong.
 */
export async function waitForHydration(locator: Locator): Promise<void> {
  await locator.waitFor({ state: "visible" });
  await expect
    .poll(
      async () =>
        locator.evaluate((node) => Object.keys(node).some((key) => key.startsWith("__reactProps$"))).catch(() => false),
      { timeout: 30_000, message: "the control never hydrated, so no handler would have run" }
    )
    .toBe(true);
}

/**
 * Sign-in is driven in its two real steps rather than as one call, so a test can assert on
 * what happens between them. That gap is the point: it is where the product either demands a
 * second factor or does not, and nothing here works around the factor. The suite holds the
 * secret of one throwaway account and answers the challenge as a person with an authenticator
 * would.
 */
export async function submitCredentials(page: Page, fixture: Fixture, locale = "ca"): Promise<void> {
  await page.goto(`/${locale}/login`, { waitUntil: "domcontentloaded" });
  const submit = page.getByRole("button", { name: labels.signIn });
  await waitForHydration(submit);
  await page.getByLabel(labels.email).fill(fixture.email);
  await page.getByLabel(labels.password).fill(fixture.password);
  await submit.click();
  await page.getByLabel(labels.otp).waitFor({ state: "visible", timeout: 15_000 });
}

/** Answers the challenge. Pass `code` to drive a deliberately wrong one. */
export async function submitSecondFactor(page: Page, fixture: Fixture, code?: string): Promise<void> {
  const field = page.getByLabel(labels.otp);
  await field.fill(code ?? (await currentTotp(fixture.totpUri, page)));
  await page.getByRole("button", { name: labels.verify }).click();
}

export async function signIn(page: Page, fixture: Fixture, locale = "ca"): Promise<void> {
  await submitCredentials(page, fixture, locale);
  await submitSecondFactor(page, fixture);
  await page.waitForURL(new RegExp(`/${locale}(\\?.*)?$`), { timeout: 20_000 });
}
