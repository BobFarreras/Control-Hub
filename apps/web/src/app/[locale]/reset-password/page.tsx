"use client";

import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { getDictionary, isLocale } from "@control-hub/i18n";

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
    const newPassword = String(new FormData(event.currentTarget).get("password"));
    const result = await authClient.resetPassword({ token, newPassword });
    if (result.error) return setError(result.error.message ?? "Invalid token");
    router.replace(`/${locale}/login`);
  }
  return (
    <main className="simple-auth">
      <form className="auth-form" onSubmit={submit}>
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
