"use client";

import { KeyRound, Laptop, LogOut, ShieldCheck } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { getDictionary, isLocale } from "@control-hub/i18n";
import { AuthBoundary } from "@/components/auth-boundary";
import { authClient } from "@/lib/auth-client";

type Session = { id: string; token: string; userAgent?: string | null; ipAddress?: string | null; expiresAt: Date };

export default function SecurityPage() {
  const localeParam = String(useParams().locale); const locale = isLocale(localeParam) ? localeParam : "ca"; const t = getDictionary(locale).security; const router = useRouter();
  const session = authClient.useSession(); const [sessions, setSessions] = useState<Session[]>([]); const [totpUri, setTotpUri] = useState(""); const [backup, setBackup] = useState<string[]>([]); const [error, setError] = useState("");
  useEffect(() => { void authClient.listSessions().then((result) => { if (result.data) setSessions(result.data as Session[]); }); }, []);
  async function enable(event: FormEvent<HTMLFormElement>) { event.preventDefault(); setError(""); const password = String(new FormData(event.currentTarget).get("password")); const result = await authClient.twoFactor.enable({ password }); if (result.error) return setError(result.error.message ?? "TOTP"); setTotpUri(result.data.totpURI); setBackup(result.data.backupCodes); }
  async function signOut() { await authClient.signOut(); router.replace(`/${locale}/login`); }
  async function revoke(token: string) { const result = await authClient.revokeSession({ token }); if (!result.error) setSessions((current) => current.filter((item) => item.token !== token)); }
  async function addPasskey() { const result = await authClient.passkey.addPasskey({ name: "Control Hub" }); if (result.error) setError(result.error.message ?? "WebAuthn"); }
  return <AuthBoundary><main className="security-page"><header className="security-header"><div><span>CONTROL HUB</span><h1>{t.title}</h1><p>{session.data?.user.email}</p></div><button className="secondary-button" onClick={signOut}><LogOut size={17} />{t.signOut}</button></header><section className="security-grid"><article className="security-panel"><ShieldCheck size={24} /><h2>{t.secondFactor}</h2><p>{t.mfaDescription}</p><form className="auth-form compact" onSubmit={enable}><label>{t.currentPassword}<input name="password" type="password" autoComplete="current-password" required /></label><button className="primary-button">{t.enableTotp}</button><button className="secondary-button" type="button" onClick={addPasskey}>{t.addPasskey}</button></form>{error && <p className="form-error">{error}</p>}{totpUri && <div className="secret-output"><strong>TOTP URI</strong><code>{totpUri}</code><strong>{t.backupCodes}</strong><code>{backup.join(" ")}</code></div>}</article><article className="security-panel"><Laptop size={24} /><h2>{t.sessions}</h2><div className="session-list">{sessions.map((item) => <div className="session-row" key={item.id}><KeyRound size={17} /><div><strong>{item.userAgent ?? t.unknownDevice}</strong><small>{item.ipAddress ?? t.unknownIp}</small></div><time>{new Date(item.expiresAt).toLocaleDateString(locale)}</time><button className="icon-button" title={t.revoke} aria-label={t.revoke} onClick={() => revoke(item.token)}><LogOut size={16} /></button></div>)}</div></article></section></main></AuthBoundary>;
}
