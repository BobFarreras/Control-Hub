"use client";

import { getDictionary, isLocale } from "@control-hub/i18n";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { formValue } from "@/lib/form";
import { eventHandler } from "@/lib/handlers";

export default function ResetPasswordPage() {
  const params = String(useParams().locale);
  const locale = isLocale(params) ? params : "ca";
  const t = getDictionary(locale).auth;
  const token = useSearchParams().get("token");
  const router = useRouter();
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!token) return setError("Invalid token");
    const newPassword = formValue(new FormData(event.currentTarget), "password");
    const result = await authClient.resetPassword({ token, newPassword });
    if (result.error) return setError(result.error.message ?? "Invalid token");
    router.replace(`/${locale}/login`);
  }
  return (
    <main className="simple-auth">
      <form className="auth-form" onSubmit={eventHandler(submit, () => setError(t.error))}>
        <h1>{t.newPassword}</h1>
        <label>
          {t.newPassword}
          <input name="password" type="password" minLength={12} autoComplete="new-password" required />
        </label>
        {error && <p className="form-error">{error}</p>}
        <button className="primary-button">{t.updatePassword}</button>
      </form>
    </main>
  );
}
