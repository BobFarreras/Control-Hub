import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Locale } from "@control-hub/i18n";

export async function requireSession(locale: Locale) {
  const cookieStore = await cookies();
  const cookieHeader = cookieStore.getAll().map(({ name, value }) => `${name}=${value}`).join("; ");
  if (!cookieHeader) redirect(`/${locale}/login`);
  try {
    const apiUrl = process.env.API_INTERNAL_URL ?? "http://127.0.0.1:4000";
    const response = await fetch(`${apiUrl}/api/auth/get-session`, { headers: { cookie: cookieHeader }, cache: "no-store" });
    if (!response.ok || !(await response.json())) redirect(`/${locale}/login`);
  } catch {
    redirect(`/${locale}/login`);
  }
}
