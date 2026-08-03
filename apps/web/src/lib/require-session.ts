import { redirect } from "next/navigation";
import type { Locale } from "@control-hub/i18n";
import { apiFetch, hasSessionCookie } from "./api";

export async function requireSession(locale: Locale) {
  if (!(await hasSessionCookie())) redirect(`/${locale}/login`);
  let authenticated = false;
  try {
    const response = await apiFetch("/api/auth/get-session");
    authenticated = response.ok && Boolean(await response.json());
  } catch {
    authenticated = false;
  }
  if (!authenticated) redirect(`/${locale}/login`);
}
