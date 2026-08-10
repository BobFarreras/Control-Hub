"use client";

import { getDictionary, isLocale } from "@control-hub/i18n";
import { ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { eventHandler } from "@/lib/handlers";

type Invitation = { tenantName: string; email: string; role: "administrator" | "technical"; expiresAt: string };

export default function AcceptInvitationPage() {
  const localeParam = String(useParams().locale);
  const locale = isLocale(localeParam) ? localeParam : "ca";
  const t = getDictionary(locale);
  const token = useSearchParams().get("token") ?? "";
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [lookupError, setLookupError] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [busy, setBusy] = useState(false);
  // A missing token is knowable while rendering; only the lookup needs an effect.
  const error = token ? lookupError : t.invitations.invalid;
  useEffect(() => {
    if (!token) return;
    void fetch(`/api/v1/public/invitations?token=${encodeURIComponent(token)}`).then(async (response) => {
      const payload = (await response.json().catch(() => ({}))) as { invitation?: Invitation };
      if (!response.ok || !payload.invitation) setLookupError(t.invitations.invalid);
      else setInvitation(payload.invitation);
    });
  }, [token, t.invitations.invalid]);
  async function accept(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setLookupError("");
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/v1/public/invitations/accept", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token, name: data.get("name"), password: data.get("password") })
    });
    setBusy(false);
    if (!response.ok) return setLookupError(t.invitations.acceptError);
    setAccepted(true);
  }
  return (
    <main className="auth-page">
      <section className="auth-identity">
        <span className="auth-brand">CONTROL HUB</span>
        <div>
          <p>SECURE ACCESS</p>
          <h1>{t.invitations.acceptTitle}</h1>
          <p>{invitation?.tenantName ?? t.auth.subtitle}</p>
        </div>
      </section>
      <section className="auth-form-panel">
        {accepted ? (
          <div className="auth-form">
            <ShieldCheck size={30} />
            <h2>{t.invitations.accepted}</h2>
            <p>{t.invitations.verifyEmail}</p>
            <Link className="primary-button" href={`/${locale}/login`}>
              {t.auth.signIn}
            </Link>
          </div>
        ) : (
          <form className="auth-form" onSubmit={eventHandler(accept, () => setLookupError(t.invitations.acceptError))}>
            <ShieldCheck size={30} />
            <h2>{invitation?.email ?? t.invitations.acceptTitle}</h2>
            <label>
              {t.invitations.name}
              <input name="name" minLength={2} maxLength={120} autoComplete="name" required disabled={!invitation} />
            </label>
            <label>
              {t.auth.password}
              <input
                name="password"
                type="password"
                minLength={12}
                maxLength={128}
                autoComplete="new-password"
                required
                disabled={!invitation}
              />
            </label>
            <button className="primary-button" disabled={busy || !invitation}>
              {t.invitations.accept}
            </button>
            {error && <p className="form-error">{error}</p>}
          </form>
        )}
      </section>
    </main>
  );
}
