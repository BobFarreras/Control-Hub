import { createHash, randomBytes } from "node:crypto";
import { expect, test as base, type APIRequestContext, type Page } from "@playwright/test";
import { currentTotp, labels, readFixture, waitForHydration } from "./support/fixture";

/**
 * The one flow this product has that a unit test cannot honestly stand in for.
 *
 * Everything else about MCP is proven where it belongs: the service against doubles, the routes
 * against an injected server, the isolation against a live database. What none of those touch is
 * the sequence a person actually walks -- an assistant nobody has ever seen registers itself, the
 * browser is sent to a screen it did not compose, a real sign-in with a real second factor happens
 * in the middle of it, and only then does a token exist that can read anything. Each half was
 * green while the whole was untried, and this is the test that tries it.
 *
 * The Catalan strings are copied rather than imported for the same reason `support/fixture.ts`
 * copies the sign-in labels: this suite runs from the repository root, outside any app's
 * dependency graph.
 */

/**
 * The assistant is not the browser, and this is where that stops being a figure of speech.
 *
 * Its calls carry no cookie and no `Origin`, which is what a desktop client sending an HTTP
 * request looks like. Borrowing the page's request context instead would send the signed-in
 * session's cookie with them, and the API refuses a cookie that arrives without an origin -- it
 * has no way to tell that request apart from another site making it. So the agent gets its own
 * context, which is also the truth about what is being tested.
 */
const test = base.extend<{ assistant: APIRequestContext }>({
  assistant: async ({ playwright }, use) => {
    // Emptied explicitly. A context created through the `playwright` fixture inherits the
    // project's `storageState`, so leaving this out hands the agent the signed-in session's
    // cookie -- and the API answers `ORIGIN_REQUIRED`, which is the right answer to the wrong
    // request.
    const context = await playwright.request.newContext({ storageState: { cookies: [], origins: [] } });
    await use(context);
    await context.dispose();
  }
});

const api = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4002";

/** A loopback address of the shape RFC 8252 tells a desktop assistant to use. */
const callback = "http://127.0.0.1:51763/callback";

const words = {
  consentTitle: "Un agent vol connectar-se",
  approve: "Autoritza",
  deny: "Rebutja",
  selfRegistered: "Aquesta aplicació s'ha registrat sola",
  crmRead: "Clients, contactes i oportunitats",
  supportRead: "Tiquets de suport i el seu estat",
  pageTitle: "Agents MCP",
  registeredPanel: "Agents registrats",
  consentsPanel: "Consentiments"
} as const;

const base64url = (value: Buffer) => value.toString("base64url");

/** RFC 7636 S256, computed here so the exchange has to present the matching verifier. */
function pkce() {
  const verifier = base64url(randomBytes(32));
  return { verifier, challenge: base64url(createHash("sha256").update(verifier).digest()) };
}

/**
 * What the resource says it is called, rather than a string this test decided -- and the gate for
 * the whole file.
 *
 * The surface is behind the `mcp` flag, so an environment that has not turned it on serves no
 * discovery document at all. Skipping there is the same choice the rest of this suite makes about
 * a database nobody seeded: a wall of failures about a flag is not a finding. The flag is not on
 * in the workflow that runs this suite, which is a gap in coverage and not in the product; it is
 * written down in `docs/development/multi-agent-workspaces.md`.
 */
async function resourceIdentifier(request: APIRequestContext): Promise<string> {
  const response = await request.get(`${api}/.well-known/oauth-protected-resource`);
  test.skip(response.status() === 404, "the mcp flag is off in this environment, so there is no surface to authorize");
  expect(response.status()).toBe(200);
  return ((await response.json()) as { resource: string }).resource;
}

/** RFC 7591, unauthenticated, exactly as an assistant nobody has heard of would arrive. */
async function registerItself(request: APIRequestContext, name: string): Promise<string> {
  const response = await request.post(`${api}/api/v1/mcp/oauth/register`, {
    data: { client_name: name, redirect_uris: [callback], scope: "crm.read support.read" }
  });
  // The body is in the message because a refusal here is about the request, and a bare status
  // code sends the next reader looking through the server instead of reading the answer.
  expect(response.status(), await response.text()).toBe(201);
  const payload = (await response.json()) as { client_id: string; client_secret?: string };
  // The property the constraint in `0058` exists for, asserted where a reader will see it.
  expect(payload.client_secret).toBeUndefined();
  return payload.client_id;
}

function authorizeUrl(clientId: string, challenge: string, resource: string, state: string): string {
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: callback,
    scope: "crm.read support.read",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource,
    state
  });
  return `${api}/api/v1/mcp/oauth/authorize?${query.toString()}`;
}

/**
 * Answers the loopback address the assistant registered, because nothing is listening on it.
 *
 * A desktop client opens that port itself. Fulfilling the request keeps the redirect real -- the
 * browser still follows it, and the address it lands on is the one the server chose -- without
 * this test having to be a server.
 */
async function answerTheLoopback(page: Page): Promise<void> {
  await page.route("http://127.0.0.1:51763/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<p>callback</p>" })
  );
}

test.describe("authorizing an assistant that registered itself", () => {
  // Signed out on purpose. The freshness rule is measured from when the session was created, so a
  // banked one would make this test pass or fail on how long the suite had been running; and
  // arriving signed out is what actually happens when an agent sends somebody here.
  //
  // The language is declared because the entry point negotiates it from the browser: the API sends
  // an agent to an address with no locale in it, and this suite asserts on Catalan.
  test.use({ storageState: { cookies: [], origins: [] }, locale: "ca" });

  test("signs in with the second factor, approves, and the token reads what was granted", async ({
    page,
    assistant
  }) => {
    // Four screens, a second factor and three calls the assistant makes for itself, and on a
    // development server the first visit to each route compiles it. The default budget is for a
    // test that drives one screen; this one failed on a cold server and passed on a warm one,
    // which is a test measuring the machine rather than the product.
    test.setTimeout(120_000);

    const fixture = readFixture();
    const { verifier, challenge } = pkce();
    const state = base64url(randomBytes(9));
    const resource = await resourceIdentifier(assistant);
    const clientName = `Assistant ${base64url(randomBytes(4))}`;
    const clientId = await registerItself(assistant, clientName);

    await answerTheLoopback(page);
    await page.goto(authorizeUrl(clientId, challenge, resource, state), { waitUntil: "domcontentloaded" });

    // Sent to sign in, carrying the request rather than losing it. Landing on the dashboard here
    // would mean the person has to make the agent ask again.
    await expect(page).toHaveURL(/\/ca\/login\?next=/);
    const submit = page.getByRole("button", { name: labels.signIn });
    await waitForHydration(submit);
    await page.getByLabel(labels.email).fill(fixture.email);
    await page.getByLabel(labels.password).fill(fixture.password);
    await submit.click();

    // The assertion that matters most in this file. If enforcement ever regressed and a password
    // alone were enough, the consent screen would already be here.
    await expect(page.getByLabel(labels.otp)).toBeVisible();
    await expect(page).not.toHaveURL(/\/mcp\/consent/);

    await page.getByLabel(labels.otp).fill(await currentTotp(fixture.totpUri, page));
    await page.getByRole("button", { name: labels.verify }).click();

    await page.waitForURL(/\/ca\/mcp\/consent\?/, { timeout: 30_000 });
    await expect(page.getByRole("heading", { name: words.consentTitle })).toBeVisible();

    // Registered itself, so nobody in the organisation vetted it, so the screen says so.
    await expect(page.getByRole("note")).toContainText(words.selfRegistered);
    await expect(page.getByText(clientName, { exact: true })).toBeVisible();
    await expect(page.getByText(callback, { exact: true })).toBeVisible();
    await expect(page.getByText(words.crmRead)).toBeVisible();
    await expect(page.getByText(words.supportRead)).toBeVisible();

    const approve = page.getByRole("button", { name: words.approve });
    await waitForHydration(approve);
    await approve.click();

    await page.waitForURL(/^http:\/\/127\.0\.0\.1:51763\/callback\?/, { timeout: 30_000 });
    const returned = new URL(page.url()).searchParams;
    expect(returned.get("state")).toBe(state);
    expect(returned.get("error")).toBeNull();
    const code = returned.get("code");
    expect(code).toBeTruthy();

    // The exchange is the assistant's, not the browser's: a fresh context with no cookies, which
    // is the only thing PKCE and the code have to stand on.
    const token = await assistant.post(`${api}/api/v1/mcp/oauth/token`, {
      form: {
        grant_type: "authorization_code",
        client_id: clientId,
        code: code!,
        code_verifier: verifier,
        redirect_uri: callback,
        resource
      }
    });
    expect(token.status()).toBe(200);
    const issued = (await token.json()) as { access_token: string; token_type: string; scope: string };
    expect(issued.token_type).toBe("Bearer");
    expect(issued.access_token.startsWith("chm_at_")).toBe(true);
    expect(issued.scope.split(" ").sort()).toEqual(["crm.read", "mcp:tools.list", "support.read"]);

    // A code is good once. Replaying it is the attack the whole exchange is shaped against.
    const replay = await assistant.post(`${api}/api/v1/mcp/oauth/token`, {
      form: {
        grant_type: "authorization_code",
        client_id: clientId,
        code: code!,
        code_verifier: verifier,
        redirect_uri: callback,
        resource
      }
    });
    expect(replay.status()).toBe(400);

    const tools = await assistant.post(`${api}/mcp`, {
      headers: { authorization: `Bearer ${issued.access_token}` },
      data: { jsonrpc: "2.0", id: 1, method: "tools/list" }
    });
    expect(tools.status()).toBe(200);
    const listed = (await tools.json()) as { result?: { tools?: { name: string }[] } };
    expect(listed.result?.tools?.length ?? 0).toBeGreaterThan(0);

    // And the claim, seen where an administrator would see it: the client was nobody's until this
    // person approved it, and now it is listed in their own tenant, with the consent beside it.
    await page.goto("/ca/mcp", { waitUntil: "domcontentloaded" });
    await expect(page.getByRole("heading", { name: words.pageTitle })).toBeVisible();
    const panel = (title: string) =>
      page.getByRole("article").filter({ has: page.getByRole("heading", { name: title }) });
    await expect(panel(words.registeredPanel).getByText(clientName, { exact: true })).toBeVisible();
    await expect(panel(words.consentsPanel).getByText(clientName, { exact: true })).toBeVisible();
  });
});

test.describe("refusing an assistant", () => {
  // Deliberately the banked session rather than a fresh one: refusing does not demand freshness,
  // and somebody who wants to say no should be able to say it from the session they have.
  test.use({ locale: "ca" });

  test("says no from an ordinary session and the client is told", async ({ page, assistant }) => {
    test.setTimeout(60_000);

    const { challenge } = pkce();
    const state = base64url(randomBytes(9));
    const resource = await resourceIdentifier(assistant);
    const clientId = await registerItself(assistant, `Unwanted ${base64url(randomBytes(4))}`);

    await answerTheLoopback(page);
    await page.goto(authorizeUrl(clientId, challenge, resource, state), { waitUntil: "domcontentloaded" });
    await page.waitForURL(/\/ca\/mcp\/consent\?/, { timeout: 30_000 });

    const deny = page.getByRole("button", { name: words.deny });
    await waitForHydration(deny);
    await deny.click();

    await page.waitForURL(/^http:\/\/127\.0\.0\.1:51763\/callback\?/, { timeout: 30_000 });
    const returned = new URL(page.url()).searchParams;
    expect(returned.get("error")).toBe("access_denied");
    expect(returned.get("state")).toBe(state);
    expect(returned.get("code")).toBeNull();
  });
});
