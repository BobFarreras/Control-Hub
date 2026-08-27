"use client";

import { getDictionary, isLocale } from "@control-hub/i18n";
import { Command, KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { formValue } from "@/lib/form";
import { eventHandler } from "@/lib/handlers";
import { internalPath } from "@/lib/internal-path";

/**
 * The form is a child so that `useSearchParams` sits behind a Suspense boundary.
 *
 * Reading the query string opts a client component out of being rendered ahead of time, and Next
 * refuses to build a page that does it without one. The boundary is the whole answer: there is
 * nothing to show while the address is read, so the fallback is nothing.
 */
export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const localeParam = String(useParams().locale);
  const locale = isLocale(localeParam) ? localeParam : "ca";
  const t = getDictionary(locale).auth;
  const router = useRouter();
  /**
   * Where to go once this is over.
   *
   * Almost always the dashboard, because almost always the person came from the panel. The one
   * exception is the consent screen, which is opened from a link an agent composed and which is
   * meaningless to arrive at without the request it was carrying. `internalPath` is what keeps
   * that from turning this form into an open redirect for anybody who can send a link.
   */
  const next = internalPath(useSearchParams().get("next"));
  const destination = next ?? `/${locale}`;
  const [step, setStep] = useState<"credentials" | "otp">("credentials");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    const result = await authClient.signIn.email({
      email: formValue(data, "email"),
      password: formValue(data, "password"),
      rememberMe: true
    });
    setBusy(false);
    if (result.error) return setError(t.error);
    if (result.data && "twoFactorRedirect" in result.data && result.data.twoFactorRedirect) return setStep("otp");
    router.replace(destination);
    router.refresh();
  }
  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const code = formValue(new FormData(event.currentTarget), "code");
    /**
     * The device is remembered for thirty days, the same window as the session.
     *
     * With `trustDevice: false` the code was demanded on every single sign-in, which taught the
     * only two people who use the panel to treat the second factor as a toll rather than as a
     * control. It is not weakened: enrolment stays mandatory, a device that has not been
     * trusted is still challenged, and the trust lives in a signed cookie that revoking the
     * session or resetting the password invalidates.
     */
    const result = await authClient.twoFactor.verifyTotp({ code, trustDevice: true });
    setBusy(false);
    if (result.error) return setError(t.error);
    router.replace(destination);
    router.refresh();
  }
  return (
    <main className="auth-page">
      <section className="auth-identity">
        <div className="auth-brand">
          <Command size={24} />
          <strong>Control Hub</strong>
        </div>
        <div>
          <span className="auth-kicker">CONTROL HUB</span>
          <h1>{t.title}</h1>
          <p>{t.subtitle}</p>
        </div>
        <div className="auth-trust">
          <ShieldCheck size={18} /> TOTP / WebAuthn
        </div>
      </section>
      <section className="auth-form-panel">
        <form
          className="auth-form"
          onSubmit={eventHandler(step === "credentials" ? submit : verify, () => setError(t.error))}
        >
          <KeyRound size={28} />
          <h2>{step === "credentials" ? t.signIn : t.verify}</h2>
          {step === "credentials" ? (
            <>
              <label>
                {t.email}
                <input name="email" type="email" autoComplete="username" required />
              </label>
              <label>
                {t.password}
                <input name="password" type="password" autoComplete="current-password" minLength={12} required />
              </label>
            </>
          ) : (
            <label>
              {t.otp}
              <input
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                minLength={6}
                maxLength={6}
                required
                autoFocus
              />
            </label>
          )}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary-button" disabled={busy}>
            {busy ? <LoaderCircle className="spin" size={18} /> : step === "credentials" ? t.signIn : t.verify}
          </button>
          {step === "credentials" && (
            <a className="text-link" href={`/${locale}/forgot-password`}>
              {t.forgot}
            </a>
          )}
        </form>
      </section>
    </main>
  );
}
