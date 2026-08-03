"use client";

import { useParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { getDictionary, isLocale } from "@control-hub/i18n";

export default function ForgotPasswordPage() {
  const param = String(useParams().locale);
  const locale = isLocale(param) ? param : "ca";
  const t = getDictionary(locale).auth;
  const [sent, setSent] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const email = String(new FormData(event.currentTarget).get("email"));
    await authClient.requestPasswordReset({ email, redirectTo: `/${locale}/reset-password` });
    setSent(true);
  }
  return (
    <main className="simple-auth">
      <form className="auth-form" onSubmit={submit}>
        <h1>{t.resetTitle}</h1>
        {sent ? (
          <p>{t.sent}</p>
        ) : (
          <>
            <label>
              {t.email}
              <input name="email" type="email" required />
            </label>
            <button className="primary-button">{t.sendLink}</button>
          </>
        )}
      </form>
    </main>
  );
}
