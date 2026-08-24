/**
 * The link from an automation to the provider's own screen, built here and never received.
 *
 * A URL that came back from a provider is data, not a destination. n8n workflows carry
 * `webhookUrl` fields, node parameters full of addresses and whatever somebody typed into a
 * sticky note, and any of them would happily render as an anchor if the screen let it. So the
 * only thing that ever becomes a link is composed here out of two halves we control: the base an
 * operator configured on the connector instance, and the workflow id the provider gave us.
 *
 * Both halves are checked, and then the result is checked against the base again. Composing
 * safely and verifying afterwards are different guarantees: the first says we meant to build the
 * right thing, the second says we did. `null` means the screen draws the name as plain text,
 * which is the correct outcome and not a degraded one.
 *
 * Specification: `docs/specifications/infrastructure.md`, decision 5. Acceptance criterion 3.
 */

/** The schemes the n8n connector declares. Anything else never becomes an anchor. */
const allowedSchemes = new Set(["http:", "https:"]);

/**
 * What an n8n workflow id may look like. Deliberately narrower than what n8n might send: it ends
 * up in a URL path, so a slash, a dot pair, a query or an escape has to be refused rather than
 * encoded. Refusing costs one link; accepting costs the guarantee the whole file is for.
 */
const workflowIdPattern = /^[A-Za-z0-9_-]{1,200}$/;

const workflowPrefix = "workflow:";

/** The id inside a `workflow:<id>` external identifier, or null if it is not one we can use. */
export function workflowIdOf(externalId: string): string | null {
  if (!externalId.startsWith(workflowPrefix)) return null;
  const id = externalId.slice(workflowPrefix.length);
  return workflowIdPattern.test(id) ? id : null;
}

/** The configured base, parsed, or null when it is not something we would ever navigate to. */
function safeBase(baseUrl: string): URL | null {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    return null;
  }
  if (!allowedSchemes.has(url.protocol)) return null;
  // Credentials in a base would be sent on every click and would sit in the address bar and the
  // history of whoever clicked. There is no configuration where that is what somebody meant.
  if (url.username || url.password) return null;
  if (url.search || url.hash) return null;
  return url;
}

/**
 * The address of one automation on the provider, or null.
 *
 * The final check is `origin` against `origin` and a path that still starts where the configured
 * one did: it is what makes the answer independent of how the two halves were spelled.
 */
export function automationLink(baseUrl: string | null | undefined, externalId: string): string | null {
  if (!baseUrl) return null;
  const base = safeBase(baseUrl.trim());
  if (!base) return null;

  const id = workflowIdOf(externalId);
  if (!id) return null;

  const prefix = base.pathname.replace(/\/+$/, "");
  const link = new URL(`${prefix}/workflow/${id}`, base.origin);

  if (link.origin !== base.origin) return null;
  if (!link.pathname.startsWith(`${prefix}/`)) return null;
  if (link.username || link.password || link.search || link.hash) return null;
  return link.toString();
}

/**
 * What a production alias may look like: a bare hostname and nothing else.
 *
 * The alias is the provider's answer, which makes it data and not a destination, exactly like
 * everything else in this file. A label of one to sixty-three characters, at least two of them,
 * separated by dots -- no port, no path, no credentials, no space to hide a second host in. What
 * fails this renders as text, which is the right answer and not a degraded one.
 */
const hostnamePattern = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;

/**
 * The address of a deployed site, or null.
 *
 * Always `https`: a production alias that only answered on `http` is not a link worth offering,
 * and letting the scheme be decided anywhere else is how one becomes decidable by the provider.
 * As with an automation, the result is verified against what went in rather than merely composed
 * out of it.
 */
export function deployedSiteLink(domain: string | null | undefined): string | null {
  if (!domain) return null;
  const host = domain.trim().toLowerCase();
  if (!hostnamePattern.test(host)) return null;

  const link = new URL(`https://${host}/`);
  if (link.hostname !== host) return null;
  if (link.port || link.username || link.password || link.search || link.hash) return null;
  return link.toString();
}
