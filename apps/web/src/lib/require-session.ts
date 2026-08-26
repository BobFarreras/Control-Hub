import type { Locale } from "@control-hub/i18n";
import { redirect } from "next/navigation";
import { apiFetch, hasSessionCookie } from "./api";
import { internalPath } from "./internal-path";

/**
 * Three answers, not two.
 *
 * The API says either "this session is valid", or "it is not", or nothing at all because it is
 * not reachable. Only the second one is a reason to send somebody to the login form.
 *
 * Treating the third as "not authenticated" is what made every restart of the API throw the user
 * out. In development `tsx watch` restarts it on every edit of a server file, so a navigation
 * that happened to land in that two second window ended at the login form with a session that
 * was still perfectly valid in PostgreSQL: four fresh session rows in thirty-five minutes, each
 * one a sign-in nobody needed to do.
 *
 * A transport failure is not an authentication failure. It fails loudly instead, so the page can
 * say the API is unreachable and the person can retry without losing their session.
 */
export class ApiUnreachableError extends Error {
  constructor(cause?: unknown) {
    super("API_UNREACHABLE", cause === undefined ? {} : { cause });
  }
}

/**
 * `returnTo` is where the sign-in form sends the person afterwards, when landing here at all was
 * not their idea.
 *
 * Every screen in the panel is reached from the panel, so for all of them the dashboard is the
 * right place to arrive. The consent screen is the exception: it is opened from a link an agent
 * composed, and dropping somebody on the dashboard after they authenticate loses the request they
 * were answering. It is validated as a path inside this panel and refused otherwise, because a
 * destination taken from an address is exactly how an open redirect is built.
 */
export async function requireSession(locale: Locale, returnTo?: string) {
  const next = internalPath(returnTo);
  const loginUrl = `/${locale}/login${next === null ? "" : `?next=${encodeURIComponent(next)}`}`;

  if (!(await hasSessionCookie())) redirect(loginUrl);

  let response: Response;
  try {
    response = await apiFetch("/api/auth/get-session");
  } catch (cause) {
    // Outside the redirect path on purpose: this is the API being down, not the session being
    // rejected, and the two must not lead to the same place.
    throw new ApiUnreachableError(cause);
  }

  // A 5xx is the same situation as a refused connection: the API could not answer, so it has not
  // said anything about the session. Only a negative answer it actually gave counts.
  if (response.status >= 500) throw new ApiUnreachableError();

  let authenticated: boolean;
  try {
    authenticated = response.ok && Boolean(await response.json());
  } catch (cause) {
    throw new ApiUnreachableError(cause);
  }

  // Outside the try on purpose: redirect() signals by throwing, and a catch around it would
  // swallow that signal.
  if (!authenticated) redirect(loginUrl);
}
