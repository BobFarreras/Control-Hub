import type { Locale } from "@control-hub/i18n";
import { redirect } from "next/navigation";
import { apiFetch, hasSessionCookie } from "./api";

export async function requireSession(locale: Locale) {
  if (!(await hasSessionCookie())) redirect(`/${locale}/login`);
  let authenticated: boolean;
  try {
    const response = await apiFetch("/api/auth/get-session");
    authenticated = response.ok && Boolean(await response.json());
  } catch {
    authenticated = false;
  }
  // Outside the try on purpose: redirect() signals by throwing, and a catch around it would
  // swallow that signal.
  if (!authenticated) redirect(`/${locale}/login`);
}
