import { cookies, headers } from "next/headers";

export const apiBaseUrl = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";

/**
 * Server components reach the API directly instead of going through the Next.js proxy,
 * so nothing adds the forwarding headers for them. Without those headers every server
 * side call arrives with the web container as its source address, which collapses rate
 * limiting and audit records onto a single client for the whole installation.
 */
export async function apiRequestHeaders(): Promise<Record<string, string>> {
  const [cookieStore, incoming] = await Promise.all([cookies(), headers()]);
  const cookie = cookieStore
    .getAll()
    .map(({ name, value }) => `${name}=${value}`)
    .join("; ");
  const forwardedFor = incoming.get("x-forwarded-for");
  const userAgent = incoming.get("user-agent");
  return {
    cookie,
    ...(forwardedFor ? { "x-forwarded-for": forwardedFor } : {}),
    ...(userAgent ? { "user-agent": userAgent } : {})
  };
}

export async function apiFetch(path: string, init: RequestInit = {}) {
  const forwarded = await apiRequestHeaders();
  return fetch(`${apiBaseUrl}${path}`, {
    cache: "no-store",
    ...init,
    headers: { ...forwarded, ...(init.headers as Record<string, string> | undefined) }
  });
}

/**
 * The single place where an API payload is given a type. `Response.json()` hands back `any`,
 * and letting that spread through the pages is how a renamed field turns into `undefined` on
 * screen instead of a build failure. The assertion is not validation: it records which contract
 * in `./api-types` the caller expects, so a change on the API side has one place to be answered.
 */
export async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

/**
 * A failed load that says what the API actually answered.
 *
 * `throw new Error("PROJECT_LOAD_ERROR")` writes one word to the server log and nothing else:
 * not the status, not the API's own code, not the request id that would find the matching line
 * on the other side. A CI run that failed on exactly that line cost three sessions, because the
 * log said the page could not load and refused to say why. The status alone separates "the
 * session was rejected" from "the budget ran out" from "the API broke", which are three
 * different investigations.
 *
 * Only ever called on a response that is already known to be an error, so reading the body is
 * not on any path that serves a page.
 */
export async function loadFailure(code: string, response: Response): Promise<Error> {
  const payload = (await response.json().catch(() => null)) as { code?: string; requestId?: string } | null;
  const detail = [`status=${response.status}`, payload?.code && `code=${payload.code}`, payload?.requestId]
    .filter(Boolean)
    .join(" ");
  return new Error(`${code} ${detail}`);
}

export async function hasSessionCookie() {
  const cookieStore = await cookies();
  return cookieStore.getAll().length > 0;
}
