"use client";

import { Command, KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { getDictionary, isLocale } from "@control-hub/i18n";

export default function LoginPage() {
  const localeParam = String(useParams().locale); const locale = isLocale(localeParam) ? localeParam : "ca";
  const t = getDictionary(locale).auth; const router = useRouter();
  const [step, setStep] = useState<"credentials" | "otp">("credentials"); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); const data = new FormData(event.currentTarget);
    const result = await authClient.signIn.email({ email: String(data.get("email")), password: String(data.get("password")), rememberMe: true });
    setBusy(false); if (result.error) return setError(t.error);
    if (result.data && "twoFactorRedirect" in result.data && result.data.twoFactorRedirect) return setStep("otp");
    router.replace(`/${locale}`); router.refresh();
  }
  async function verify(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); const code = String(new FormData(event.currentTarget).get("code"));
    const result = await authClient.twoFactor.verifyTotp({ code, trustDevice: false }); setBusy(false);
    if (result.error) return setError(t.error); router.replace(`/${locale}`); router.refresh();
  }
  return <main className="auth-page"><section className="auth-identity"><div className="auth-brand"><Command size={24} /><strong>Control Hub</strong></div><div><span className="auth-kicker">CONTROL HUB</span><h1>{t.title}</h1><p>{t.subtitle}</p></div><div className="auth-trust"><ShieldCheck size={18} /> TOTP / WebAuthn</div></section><section className="auth-form-panel"><form className="auth-form" onSubmit={step === "credentials" ? submit : verify}><KeyRound size={28} /><h2>{step === "credentials" ? t.signIn : t.verify}</h2>{step === "credentials" ? <><label>{t.email}<input name="email" type="email" autoComplete="username" required /></label><label>{t.password}<input name="password" type="password" autoComplete="current-password" minLength={12} required /></label></> : <label>{t.otp}<input name="code" inputMode="numeric" autoComplete="one-time-code" minLength={6} maxLength={6} required autoFocus /></label>}{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button" disabled={busy}>{busy ? <LoaderCircle className="spin" size={18} /> : step === "credentials" ? t.signIn : t.verify}</button>{step === "credentials" && <a className="text-link" href={`/${locale}/forgot-password`}>{t.forgot}</a>}</form></section></main>;
}
